// Meat Thumb — oscillator engine (AudioWorklet)
//
// Per voice: up to 9 unison oscillators (PolyBLEP saw / pulse / triangle),
// spread in pitch and stereo, each with its own slow analog drift → sine
// wavefolder, plus a sub oscillator one or two octaves down → stereo filter (cutoff driven by
// its own envelope, key tracking and the global LFO) → amp envelope.
// Voices are summed, pushed through an asymmetric tanh drive for extra
// harmonics, then through the tempo delay into the Quantum Reverb.
//
// Every block, the mod matrix adds LFO 1/2, Qubit, Lorenz and Dice to the
// knob values it targets (see mod-matrix.js).

import { QuantumReverb } from './quantum-reverb.js';
import { Sequencer } from './sequencer.js';
import { TempoDelay } from './tempo-delay.js';
import { Envelope, envCoefs, ENV_RELEASE } from './envelope.js';
import { VoiceFilter, FILTER_LP24 } from './filter.js';
import { Lfo, LFO_SINE, LFO_DIVISIONS } from './lfo.js';
import { Wavefolder } from './folder.js';
import { Qubit, Lorenz, Dice, qubitRateHz, qubitMeasureHz } from './mod-sources.js';
import { MOD_DEST_BY_KEY, MOD_SLOTS } from './mod-matrix.js';

const MAX_VOICES = 8;
const MAX_UNISON = 9;
const DRIFT_RATE_HZ = 0.7; // how fast the analog wander moves
const METER_EVERY_BLOCKS = 8;

const WAVE_SAW = 0;
const WAVE_PULSE = 1;
const WAVE_TRI = 2;

const SUB_OFF = 0;
const SUB_SINE = 1;
const SUB_SQUARE = 2;

const FILTER_ENV_OCTAVES = 6; // filter env amount ±1 → ±6 octaves
const LFO_OCTAVES = 4; // LFO amount ±1 → ±4 octaves
const CUTOFF_OCTAVES = Math.log2(1000); // cutoff knob 0..1 spans 20Hz × 2^(0..~10)
const UNISON_LAYOUT_KEYS = new Set(['blend', 'width']);

// PolyBLEP residual: smooths the step discontinuity at phase wrap so the
// waveform doesn't alias into a fizzy mess at high notes.
function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// Transparent below 0.8, curves smoothly into a hard ceiling at 1.0.
function ceiling(x) {
  const a = Math.abs(x);
  if (a <= 0.8) return x;
  return Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
}

function midiToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

class Voice {
  constructor() {
    this.note = -1;
    this.velocity = 0;
    this.age = 0;
    this.ampEnv = new Envelope();
    this.filtEnv = new Envelope();
    this.filter = new VoiceFilter(sampleRate);
    this.folder = new Wavefolder();
    this.phase = new Float64Array(MAX_UNISON);
    this.inc = new Float64Array(MAX_UNISON);
    this.triState = new Float64Array(MAX_UNISON);
    this.drift = new Float64Array(MAX_UNISON); // current drift, in cents (-1..1 scaled later)
    this.driftTarget = new Float64Array(MAX_UNISON);
    this.subPhase = 0;
    this.subInc = 0;
    for (let i = 0; i < MAX_UNISON; i++) {
      this.drift[i] = Math.random() * 2 - 1;
      this.driftTarget[i] = Math.random() * 2 - 1;
    }
  }

  get active() {
    return this.ampEnv.active;
  }

  get releasing() {
    return this.ampEnv.stage === ENV_RELEASE;
  }
}

class MeatThumbProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = {
      wave: WAVE_SAW,
      pulseWidth: 0.5,
      unison: 7,
      detune: 0.35, // 0..1, mapped to cents on a curve
      blend: 0.6, // side voices level relative to center
      width: 0.8, // stereo spread
      drift: 0.3, // 0..1 analog pitch wander
      randomPhase: true,
      octave: 0,
      fine: 0, // cents
      subType: SUB_SINE,
      subOctave: -1,
      subLevel: 0.4,
      drive: 0.35,
      attack: 0.005,
      decay: 0.3,
      sustain: 0.85,
      release: 0.25,
      volume: 0.7,
      // Filter
      filterMode: FILTER_LP24,
      cutoff: 0.7, // 0..1 → 20Hz..20kHz (exponential)
      resonance: 0.2,
      filterEnvAmt: 0.25, // -1..1
      keyTrack: 0.5,
      fAttack: 0.005,
      fDecay: 0.4,
      fSustain: 0.3,
      fRelease: 0.3,
      // LFO → cutoff
      lfoShape: LFO_SINE,
      lfoRate: 2, // Hz, when free
      lfoSync: false,
      lfoDiv: 8, // index into LFO_DIVISIONS (1/8)
      lfoAmt: 0, // -1..1
      lfoRetrig: false,
      // Wavefolder + global pitch offset (semitones; mostly a mod target)
      fold: 0,
      foldSym: 0,
      pitch: 0,
      // Mod sources
      lfo2Shape: 1,
      lfo2Rate: 0.3,
      lfo2Sync: false,
      lfo2Div: 2, // 1 bar
      qubitRate: 0.5, // knob 0..1 → 0.02..10Hz Rabi frequency
      qubitMeasure: 0.25, // knob 0..1 → 0..200 measurements/s (cubic)
      qubitTilt: 0.8, // 0 = axis along z (frozen) … 1 = along x (full flips)
      lorenzSpeed: 0.35,
      diceSlew: 0.15,
    };
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice());
    this.ageCounter = 0;

    // Precomputed per-block unison layout.
    this.uniPos = new Float64Array(MAX_UNISON);
    this.uniGainL = new Float64Array(MAX_UNISON);
    this.uniGainR = new Float64Array(MAX_UNISON);
    this.layoutDirty = true;

    // DC blocker state (asymmetric drive leaves an offset behind).
    this.dcX = [0, 0];
    this.dcY = [0, 0];

    this.lfo = new Lfo(sampleRate);
    this.lfoBuf = new Float64Array(128);
    this.cutBuf = new Float64Array(128);
    this.cutoffSmooth = this.params.cutoff;

    // Mod matrix
    this.lfo2 = new Lfo(sampleRate);
    this.lfo2Buf = new Float64Array(128);
    this.qubit = new Qubit();
    this.lorenz = new Lorenz();
    this.dice = new Dice();
    this.modValues = new Float64Array(6); // index matches MOD_SOURCES
    this.slots = Array.from({ length: MOD_SLOTS }, () => ({ src: 0, dest: '', amt: 0 }));
    this.base = {}; // un-modulated knob values, by "target:name" key
    this.modOffsets = {};
    this.modulated = new Set();

    this.delay = new TempoDelay(sampleRate);
    this.reverb = new QuantumReverb(sampleRate);
    this.meterBlocks = 0;

    this.seq = new Sequencer(sampleRate, {
      noteOn: (note, vel) => this.noteOn(note, vel),
      noteOff: (note) => this.noteOff(note),
      step: (step, played) => {
        if (played) this.dice.roll();
        this.port.postMessage({ type: 'step', step, played });
      },
    });

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'param':
        this.setBase(msg.name, msg.value);
        this.layoutDirty = true;
        break;
      case 'delayParam':
        this.setBase(`delay:${msg.name}`, msg.value);
        break;
      case 'reverbParam':
        this.setBase(`reverb:${msg.name}`, msg.value);
        break;
      case 'modSlots':
        this.slots = msg.slots;
        break;
      case 'seqPlay':
        this.seq.start();
        if (this.params.lfoSync) this.lfo.reset(); // lock the LFOs to the bar
        if (this.params.lfo2Sync) this.lfo2.reset();
        break;
      case 'noteOn':
        this.noteOn(msg.note, msg.velocity ?? 1);
        break;
      case 'noteOff':
        this.noteOff(msg.note);
        break;
      case 'seq':
        this.seq.set(msg);
        break;
      case 'seqStop':
        this.seq.stop();
        this.port.postMessage({ type: 'step', step: -1 });
        break;
      case 'allOff':
        for (const v of this.voices) {
          v.ampEnv.noteOff();
          v.filtEnv.noteOff();
        }
        break;
    }
  }

  paramTarget(key) {
    if (key.startsWith('delay:')) return [this.delay.params, key.slice(6)];
    if (key.startsWith('reverb:')) return [this.reverb.params, key.slice(7)];
    return [this.params, key];
  }

  setBase(key, value) {
    this.base[key] = value;
    const [obj, name] = this.paramTarget(key);
    obj[name] = value;
  }

  // Advance the mod sources by one block and write base + offset into every
  // modulated knob (and restore knobs that just stopped being modulated).
  updateModulation(frames) {
    const p = this.params;
    const dt = frames / sampleRate;

    if (this.lfo2Buf.length < frames) this.lfo2Buf = new Float64Array(frames);
    const lfo2Hz = p.lfo2Sync ? this.seq.bpm / 60 / LFO_DIVISIONS[p.lfo2Div].beats : p.lfo2Rate;
    this.lfo2.render(this.lfo2Buf, 0, frames, lfo2Hz, p.lfo2Shape);
    this.qubit.advance(dt, qubitRateHz(p.qubitRate), qubitMeasureHz(p.qubitMeasure), p.qubitTilt);
    this.lorenz.advance(dt, p.lorenzSpeed);
    this.dice.advance(dt, p.diceSlew);

    const src = this.modValues;
    src[1] = this.lfo.value;
    src[2] = this.lfo2.value;
    src[3] = this.qubit.value;
    src[4] = this.lorenz.value;
    src[5] = this.dice.value;

    const offsets = this.modOffsets;
    for (const key in offsets) offsets[key] = 0;
    let any = false;
    for (const slot of this.slots) {
      const dest = MOD_DEST_BY_KEY[slot.dest];
      if (!slot.src || !dest || !slot.amt) continue;
      offsets[slot.dest] = (offsets[slot.dest] || 0) + slot.amt * src[slot.src] * (dest.max - dest.min) * 0.5;
      any = true;
    }
    if (!any && this.modulated.size === 0) return;

    const next = new Set();
    for (const key in offsets) {
      const off = offsets[key];
      if (!off && !this.modulated.has(key)) continue;
      const dest = MOD_DEST_BY_KEY[key];
      const [obj, name] = this.paramTarget(key);
      if (this.base[key] === undefined) this.base[key] = obj[name];
      obj[name] = Math.min(dest.max, Math.max(dest.min, this.base[key] + off));
      if (off) next.add(key);
      if (UNISON_LAYOUT_KEYS.has(key)) this.layoutDirty = true;
    }
    this.modulated = next;
  }

  noteOn(note, velocity) {
    if (!this.seq.playing) this.dice.roll();
    // Retrigger the same note if it's already sounding, otherwise take a free
    // voice, otherwise steal the quietest/oldest.
    let voice = this.voices.find((v) => v.active && v.note === note);
    if (!voice) voice = this.voices.find((v) => !v.active);
    if (!voice) {
      voice = this.voices.reduce((a, b) =>
        a.releasing && !b.releasing ? a : b.releasing && !a.releasing ? b : a.age < b.age ? a : b
      );
    }
    const wasIdle = !voice.active;
    voice.note = note;
    voice.velocity = velocity;
    voice.age = ++this.ageCounter;
    voice.ampEnv.noteOn();
    voice.filtEnv.noteOn();
    if (this.params.lfoRetrig) this.lfo.reset();
    if (wasIdle) {
      voice.filtEnv.reset();
      voice.filtEnv.noteOn();
      voice.filter.reset();
      voice.folder.reset();
      for (let i = 0; i < MAX_UNISON; i++) {
        voice.phase[i] = this.params.randomPhase ? Math.random() : 0;
        voice.triState[i] = 0;
      }
      voice.subPhase = 0;
    }
  }

  noteOff(note) {
    for (const v of this.voices) {
      if (v.active && v.note === note && !v.releasing) {
        v.ampEnv.noteOff();
        v.filtEnv.noteOff();
      }
    }
  }

  updateLayout() {
    const p = this.params;
    const n = Math.max(1, Math.min(MAX_UNISON, p.unison | 0));
    // Center voice at full level, side voices at `blend`. Normalize by power
    // so adding voices thickens the sound rather than just making it louder.
    let power = 0;
    for (let i = 0; i < n; i++) {
      const pos = n === 1 ? 0 : (2 * i) / (n - 1) - 1;
      this.uniPos[i] = pos;
      const isCenter = n === 1 || (n % 2 === 1 && i === (n - 1) / 2);
      const level = isCenter ? 1 : p.blend;
      power += level * level;
      // Alternate pan direction so neighbouring detunes land on opposite sides.
      const pan = (i % 2 === 0 ? pos : -pos) * p.width;
      const angle = ((pan + 1) * Math.PI) / 4;
      this.uniGainL[i] = level * Math.cos(angle);
      this.uniGainR[i] = level * Math.sin(angle);
    }
    const norm = 1 / Math.sqrt(Math.max(power, 1e-6));
    for (let i = 0; i < n; i++) {
      this.uniGainL[i] *= norm * Math.SQRT2;
      this.uniGainR[i] *= norm * Math.SQRT2;
    }
    this.unisonCount = n;
    this.layoutDirty = false;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] ?? out[0];
    const frames = left.length;
    left.fill(0);
    if (right !== left) right.fill(0);

    this.updateModulation(frames);
    if (this.layoutDirty) this.updateLayout();

    // Render in segments split at sequencer events, so notes land on the
    // exact sample rather than the next 128-sample block.
    let pos = 0;
    while (pos < frames) {
      let end = frames;
      if (this.seq.playing) {
        this.seq.fire();
        end = Math.min(frames, pos + this.seq.samplesToNextEvent());
      }
      this.renderVoices(left, right, pos, end);
      if (this.seq.playing) this.seq.advance(end - pos);
      pos = end;
    }

    this.postProcess(left, right, frames);
    return true;
  }

  renderVoices(left, right, start, end) {
    const frames = end - start;
    const p = this.params;
    const sr = sampleRate;
    const n = this.unisonCount;
    // Detune curve: gentle near zero, wide at the top (max ~±60 cents).
    const detuneCents = Math.pow(p.detune, 1.6) * 60;
    const driftCents = p.drift * 12;
    const driftCoef = 1 - Math.exp((-2 * Math.PI * DRIFT_RATE_HZ * frames) / sr);
    const pw = Math.min(0.95, Math.max(0.05, p.pulseWidth));
    const wave = p.wave;
    const subLevel = p.subType === SUB_OFF ? 0 : p.subLevel;

    const ampC = envCoefs(p.attack, p.decay, p.sustain, p.release, sr);
    const filtC = envCoefs(p.fAttack, p.fDecay, p.fSustain, p.fRelease, sr);

    // Global LFO for this segment.
    if (this.lfoBuf.length < end) this.lfoBuf = new Float64Array(end);
    const lfoHz = p.lfoSync
      ? this.seq.bpm / 60 / LFO_DIVISIONS[p.lfoDiv].beats
      : p.lfoRate;
    this.lfo.render(this.lfoBuf, start, end, lfoHz, p.lfoShape);
    const lfoBuf = this.lfoBuf;

    // Cutoff (knob + mod matrix) is smoothed per sample so block-rate
    // modulation can't zipper; the result is an octave exponent above 20Hz.
    if (this.cutBuf.length < end) this.cutBuf = new Float64Array(end);
    const cutBuf = this.cutBuf;
    const cutGlide = 1 - Math.exp(-1 / (0.003 * sr));
    let cs = this.cutoffSmooth;
    for (let s = start; s < end; s++) {
      cs += (p.cutoff - cs) * cutGlide;
      cutBuf[s] = cs * CUTOFF_OCTAVES;
    }
    this.cutoffSmooth = cs;
    const fold = p.fold;
    const foldSym = p.foldSym;
    const envOct = p.filterEnvAmt * FILTER_ENV_OCTAVES;
    const lfoOct = p.lfoAmt * LFO_OCTAVES;
    const mode = p.filterMode;
    const res = p.resonance;

    for (const v of this.voices) {
      if (!v.active) continue;

      // Per-block pitch: detune + drift for each unison oscillator.
      const baseHz = midiToHz(v.note + p.octave * 12 + p.pitch) * Math.pow(2, p.fine / 1200);
      for (let u = 0; u < n; u++) {
        if (Math.random() < 0.02) v.driftTarget[u] = Math.random() * 2 - 1;
        v.drift[u] += (v.driftTarget[u] - v.drift[u]) * driftCoef;
        const cents = this.uniPos[u] * detuneCents + v.drift[u] * driftCents;
        v.inc[u] = Math.min(0.45, (baseHz * Math.pow(2, cents / 1200)) / sr);
      }
      v.subInc = (baseHz * Math.pow(2, p.subOctave)) / sr;

      const vel = 0.35 + 0.65 * v.velocity;
      const keyOct = (p.keyTrack * (v.note + p.octave * 12 - 60)) / 12;
      const filter = v.filter;
      const folder = v.folder;

      for (let s = start; s < end; s++) {
        const amp = v.ampEnv.next(ampC);
        if (!v.ampEnv.active) break;
        const fenv = v.filtEnv.next(filtC);
        filter.setup(mode, 20 * Math.pow(2, cutBuf[s] + envOct * fenv + lfoOct * lfoBuf[s] + keyOct), res);

        let l = 0;
        let r = 0;
        for (let u = 0; u < n; u++) {
          const t = v.phase[u];
          const dt = v.inc[u];
          let x;
          if (wave === WAVE_SAW) {
            x = 2 * t - 1 - polyBlep(t, dt);
          } else {
            x = t < pw ? 1 : -1;
            x += polyBlep(t, dt);
            let t2 = t - pw;
            if (t2 < 0) t2 += 1;
            x -= polyBlep(t2, dt);
            if (wave === WAVE_TRI) {
              // Leaky-integrate the band-limited square into a triangle.
              v.triState[u] = dt * 4 * x + (1 - dt) * v.triState[u];
              x = v.triState[u];
            }
          }
          l += x * this.uniGainL[u];
          r += x * this.uniGainR[u];

          let next = t + dt;
          if (next >= 1) next -= 1;
          v.phase[u] = next;
        }

        l = folder.process(l, 0, fold, foldSym);
        r = folder.process(r, 1, fold, foldSym);

        if (subLevel > 0) {
          const sp = v.subPhase;
          let sub;
          if (p.subType === SUB_SINE) {
            sub = Math.sin(2 * Math.PI * sp);
          } else {
            sub = sp < 0.5 ? 1 : -1;
            sub += polyBlep(sp, v.subInc);
            let sp2 = sp - 0.5;
            if (sp2 < 0) sp2 += 1;
            sub -= polyBlep(sp2, v.subInc);
          }
          sub *= subLevel;
          l += sub;
          r += sub;
          let nsp = sp + v.subInc;
          if (nsp >= 1) nsp -= 1;
          v.subPhase = nsp;
        }

        const g = amp * vel * 0.25;
        left[s] += filter.process(l, 0) * g;
        right[s] += filter.process(r, 1) * g;
      }
    }
  }

  postProcess(left, right, frames) {
    const p = this.params;

    // Drive: asymmetric tanh adds even harmonics (the "meat").
    const drive = 1 + p.drive * 8;
    const bias = 0.15 * p.drive;
    const biasOffset = Math.tanh(bias);
    const makeup = 1.1 / Math.pow(drive, 0.3);
    const vol = p.volume;
    const dcR = 0.995;
    const channels = right !== left ? [left, right] : [left];
    for (let c = 0; c < channels.length; c++) {
      const buf = channels[c];
      let x1 = this.dcX[c];
      let y1 = this.dcY[c];
      for (let s = 0; s < frames; s++) {
        const x = (Math.tanh(buf[s] * drive + bias) - biasOffset) * makeup;
        y1 = x - x1 + dcR * y1;
        x1 = x;
        buf[s] = y1;
      }
      this.dcX[c] = x1;
      this.dcY[c] = y1;
    }

    if (right !== left) {
      this.delay.process(left, right, frames, this.seq.bpm);
      this.reverb.process(left, right, frames);
    }

    for (let s = 0; s < frames; s++) {
      left[s] = ceiling(left[s] * vol);
      if (right !== left) right[s] = ceiling(right[s] * vol);
    }

    if (++this.meterBlocks >= METER_EVERY_BLOCKS) {
      this.meterBlocks = 0;
      const q = this.qubit;
      this.port.postMessage({
        type: 'meter',
        ...this.reverb.takeMeter(),
        lfo: this.lfo.value,
        mods: Array.from(this.modValues).slice(1),
        bloch: [q.x, q.y, q.z],
        collapses: q.collapses,
        lorenz: [this.lorenz.x, this.lorenz.z],
      });
      q.collapses = 0;
    }
  }
}

registerProcessor('meat-thumb', MeatThumbProcessor);
