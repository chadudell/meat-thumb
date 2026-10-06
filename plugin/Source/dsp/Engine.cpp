// Meat Thumb — synth engine. Port of src/dsp/meat-thumb-processor.js
#include "Engine.h"

#include <cstring>

MT_DSP_BEGIN

namespace mt {

const ModDest kModDestinations[kNumModDestinations] = {
    {"pitch", "Pitch", "Osc", -12, 12},
    {"pulseWidth", "PW", "Osc", 0.05, 0.95},
    {"fold", "Fold", "Osc", 0, 1},
    {"foldSym", "Fold Sym", "Osc", -1, 1},
    {"drive", "Drive", "Osc", 0, 1},
    {"subLevel", "Sub Level", "Osc", 0, 1},
    {"detune", "Detune", "Unison", 0, 1},
    {"blend", "Blend", "Unison", 0, 1},
    {"width", "Width", "Unison", 0, 1},
    {"drift", "Drift", "Unison", 0, 1},
    {"cutoff", "Cutoff", "Filter", 0, 1},
    {"resonance", "Resonance", "Filter", 0, 1},
    {"filterEnvAmt", "Filter Env", "Filter", -1, 1},
    {"lfoAmt", "LFO 1 Amount", "LFO", -1, 1},
    {"lfoRate", "LFO 1 Rate", "LFO", 0.05, 30},
    {"volume", "Volume", "Amp", 0, 1},
    {"delay:mix", "Delay Mix", "Delay", 0, 1},
    {"delay:feedback", "Delay Feedback", "Delay", 0, 1.1},
    {"delay:tone", "Delay Tone", "Delay", 0, 1},
    {"delay:wow", "Delay Wow", "Delay", 0, 1},
    {"delay:timeMs", "Delay Time (free)", "Delay", 10, 2000},
    {"reverb:mix", "Reverb Mix", "Reverb", 0, 1},
    {"reverb:size", "Reverb Size", "Reverb", 0, 1},
    {"reverb:decay", "Reverb Decay", "Reverb", 0, 1},
    {"reverb:damp", "Reverb Damp", "Reverb", 0, 1},
    {"reverb:predelay", "Reverb Pre", "Reverb", 0, 0.5},
    {"reverb:mod", "Reverb Mod", "Reverb", 0, 1},
    {"reverb:shimmer", "Shimmer", "Reverb", 0, 1},
    {"reverb:quantum", "Quantum", "Reverb", 0, 1},
    {"reverb:gravity", "Gravity", "Reverb", 0, 1},
};

int modDestIndex(const char* key) {
  if (!key) return -1;
  for (int i = 0; i < kNumModDestinations; i++)
    if (!std::strcmp(kModDestinations[i].key, key)) return i;
  return -1;
}

namespace {

constexpr double DRIFT_RATE_HZ = 0.7;
constexpr int WAVE_SAW = 0, WAVE_TRI = 2;
constexpr int SUB_OFF = 0, SUB_SINE = 1;
constexpr double FILTER_ENV_OCTAVES = 6;
constexpr double LFO_OCTAVES = 4;
const double CUTOFF_OCTAVES = std::log2(1000.0);

// PolyBLEP residual.
inline double polyBlep(double t, double dt) {
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
inline double ceiling(double x) {
  const double a = std::fabs(x);
  if (a <= 0.8) return x;
  return jsSign(x) * (0.8 + 0.2 * std::tanh((a - 0.8) / 0.2));
}

inline double midiToHz(double note) { return 440 * jsPow(2, (note - 69) / 12); }

inline void atomicAdd(std::atomic<double>& a, double v) {
  double old = a.load(std::memory_order_relaxed);
  while (!a.compare_exchange_weak(old, old + v, std::memory_order_relaxed)) {
  }
}

} // namespace

Engine::Engine() {
  for (auto& m : mMods) m.store(0);
  for (auto& m : mBloch) m.store(0);
  for (auto& m : mLorenz) m.store(0);
  prepare(48000);
}

void Engine::prepare(double sampleRate) {
  sr = sampleRate;
  rng.seed(0x6d6561745468756dull);
  for (Voice& v : voices) v.filter.prepare(sr);
  lfo.prepare(sr, &rng);
  lfo2.prepare(sr, &rng);
  delay.prepare(sr, &rng);
  reverb.prepare(sr, &rng);
  SeqCallbacks cb;
  cb.ctx = this;
  cb.noteOn = &Engine::seqNoteOn;
  cb.noteOff = &Engine::seqNoteOff;
  cb.step = &Engine::seqStep;
  seq.prepare(sr, &rng, cb);
  reset();
}

void Engine::reset() {
  for (Voice& v : voices) {
    v.note = -1;
    v.velocity = 0;
    v.age = 0;
    v.ampEnv.reset();
    v.filtEnv.reset();
    v.filter.reset();
    v.folder.reset();
    for (int i = 0; i < MAX_UNISON; i++) {
      v.phase[i] = 0;
      v.inc[i] = 0;
      v.triState[i] = 0;
      v.drift[i] = rng() * 2 - 1;
      v.driftTarget[i] = rng() * 2 - 1;
    }
    v.subPhase = 0;
    v.subInc = 0;
  }
  ageCounter = 0;
  pitchBend = 0;
  dcX[0] = dcX[1] = dcY[0] = dcY[1] = 0;
  lfo.prepare(sr, &rng);
  lfo2.prepare(sr, &rng);
  cutoffSmooth = Params{}.cutoff; // JS: initialised from the default before any param message
  qubit = Qubit();
  lorenz = Lorenz();
  dice = Dice();
  for (double& m : modValues) m = 0;
  delay.reset();
  reverb.reset();
  seq.playing = false;
  seq.releaseAll(); // voices were just reset; noteOffs are harmless
  seq.current = 0;
  seq.untilStep = 0;
  cur = params;
  updateLayout();
  gridPos = 0;
  levelEnv = 0;
}

void Engine::setModSlots(const ModSlot* s) {
  for (int i = 0; i < kModSlots; i++) slots[i] = s[i];
}

void Engine::setPattern(const SeqPattern& p) { seq.setPattern(p); }

void Engine::setBpm(double bpm) { seq.bpm = bpm; }

void Engine::seqStart() {
  seq.start();
  if (params.lfoSync) lfo.reset(); // lock the LFOs to the bar
  if (params.lfo2Sync) lfo2.reset();
}

void Engine::seqStartAt(int step, double samplesUntilStep) {
  seq.startAt(step, samplesUntilStep);
  if (params.lfoSync) lfo.reset();
  if (params.lfo2Sync) lfo2.reset();
}

void Engine::seqStop() {
  seq.stop();
  if (onStep) onStep(-1, false);
}

void Engine::seqNoteOn(void* ctx, int note, double vel) { static_cast<Engine*>(ctx)->noteOn(note, vel); }
void Engine::seqNoteOff(void* ctx, int note) { static_cast<Engine*>(ctx)->noteOff(note); }
void Engine::seqStep(void* ctx, int step, bool played) {
  Engine* e = static_cast<Engine*>(ctx);
  if (played) e->dice.roll(e->rng);
  if (e->onStep) e->onStep(step, played);
}

void Engine::noteOn(int note, double velocity) {
  if (!seq.playing) dice.roll(rng);
  // Retrigger the same note if it's already sounding, otherwise take a free
  // voice, otherwise steal the quietest/oldest.
  Voice* voice = nullptr;
  for (Voice& v : voices)
    if (v.active() && v.note == note) {
      voice = &v;
      break;
    }
  if (!voice)
    for (Voice& v : voices)
      if (!v.active()) {
        voice = &v;
        break;
      }
  if (!voice) {
    Voice* a = &voices[0];
    for (int i = 1; i < MAX_VOICES; i++) {
      Voice* b = &voices[i];
      a = (a->releasing() && !b->releasing()) ? a : (b->releasing() && !a->releasing()) ? b : (a->age < b->age ? a : b);
    }
    voice = a;
  }
  const bool wasIdle = !voice->active();
  voice->note = note;
  voice->velocity = velocity;
  voice->age = ++ageCounter;
  voice->ampEnv.noteOn();
  voice->filtEnv.noteOn();
  if (params.lfoRetrig) lfo.reset();
  if (wasIdle) {
    voice->filtEnv.reset();
    voice->filtEnv.noteOn();
    voice->filter.reset();
    voice->folder.reset();
    for (int i = 0; i < MAX_UNISON; i++) {
      voice->phase[i] = params.randomPhase ? rng() : 0;
      voice->triState[i] = 0;
    }
    voice->subPhase = 0;
  }
}

void Engine::noteOff(int note) {
  for (Voice& v : voices) {
    if (v.active() && v.note == note && !v.releasing()) {
      v.ampEnv.noteOff();
      v.filtEnv.noteOff();
    }
  }
}

void Engine::allOff() {
  for (Voice& v : voices) {
    v.ampEnv.noteOff();
    v.filtEnv.noteOff();
  }
}

void Engine::applyEvent(const MidiEvent& e) {
  switch (e.type) {
    case MIDI_NOTE_ON:
      noteOn(e.note, e.velocity);
      break;
    case MIDI_NOTE_OFF:
      noteOff(e.note);
      break;
    case MIDI_ALL_OFF:
      allOff();
      break;
    case MIDI_PITCH_BEND:
      pitchBend = e.value;
      break;
    default:
      break;
  }
}

// Advance the mod sources by one chunk and compute the effective params:
// cur = clamp(base + sum of slot offsets) for every targeted knob.
void Engine::updateModulation(int frames) {
  const Params& p = params; // mod-source settings are never mod targets
  const double dt = frames / sr;

  const double lfo2Hz = p.lfo2Sync ? seq.bpm / 60 / lfoDivBeats(p.lfo2Div) : p.lfo2Rate;
  lfo2.render(lfo2Buf, 0, frames, lfo2Hz, p.lfo2Shape);
  qubit.advance(dt, qubitRateHz(p.qubitRate), qubitMeasureHz(p.qubitMeasure), p.qubitTilt, rng);
  lorenz.advance(dt, p.lorenzSpeed);
  dice.advance(dt, p.diceSlew);

  double* src = modValues;
  src[1] = lfo.value;
  src[2] = lfo2.value;
  src[3] = qubit.value();
  src[4] = lorenz.value();
  src[5] = dice.value();

  cur = params;
  double off[kNumModDestinations];
  bool hit[kNumModDestinations];
  for (int d = 0; d < kNumModDestinations; d++) {
    off[d] = 0;
    hit[d] = false;
  }
  for (const ModSlot& slot : slots) {
    if (slot.src <= 0 || slot.src >= kNumModSources) continue;
    if (slot.dest < 0 || slot.dest >= kNumModDestinations) continue;
    if (slot.amt == 0 || std::isnan(slot.amt)) continue;
    const ModDest& dest = kModDestinations[slot.dest];
    off[slot.dest] = off[slot.dest] + slot.amt * src[slot.src] * (dest.max - dest.min) * 0.5;
    hit[slot.dest] = true;
  }
  for (int d = 0; d < kNumModDestinations; d++) {
    if (!hit[d]) continue;
    const ModDest& dest = kModDestinations[d];
    double Params::*field = kModDestField[d];
    cur.*field = std::fmin(dest.max, std::fmax(dest.min, params.*field + off[d]));
  }
}

void Engine::updateLayout() {
  const Params& p = cur;
  const int u = p.unison;
  const int n = u < 1 ? 1 : (u > MAX_UNISON ? MAX_UNISON : u);
  double power = 0;
  for (int i = 0; i < n; i++) {
    const double pos = n == 1 ? 0 : static_cast<double>(2 * i) / (n - 1) - 1;
    uniPos[i] = pos;
    const bool isCenter = n == 1 || (n % 2 == 1 && i == (n - 1) / 2);
    const double level = isCenter ? 1 : p.blend;
    power += level * level;
    const double pan = (i % 2 == 0 ? pos : -pos) * p.width;
    const double angle = ((pan + 1) * kPi) / 4;
    uniGainL[i] = level * std::cos(angle);
    uniGainR[i] = level * std::sin(angle);
  }
  const double norm = 1 / std::sqrt(std::fmax(power, 1e-6));
  for (int i = 0; i < n; i++) {
    uniGainL[i] *= norm * kSqrt2;
    uniGainR[i] *= norm * kSqrt2;
  }
  unisonCount = n;
}

void Engine::process(float* L, float* R, int n, const MidiEvent* events, int numEvents) {
  int ev = 0;
  int done = 0;
  while (done < n) {
    // Block-rate work runs on a fixed 128-frame grid that persists across
    // process() calls, so the output does not depend on the host buffer size
    // (a 128-block may span two host buffers).
    if (gridPos == 0) {
      // Events at the block start land before the modulation update, like port
      // messages arriving between two AudioWorklet process() calls.
      while (ev < numEvents && events[ev].sampleOffset <= done) applyEvent(events[ev++]);
      updateModulation(BLOCK);
      updateLayout();
      beginFx();
    }
    const int frames = (n - done) < (BLOCK - gridPos) ? (n - done) : (BLOCK - gridPos);
    float* left = L + done;
    float* right = R + done;
    for (int s = 0; s < frames; s++) left[s] = right[s] = 0.f;

    // Render in segments split at sequencer and MIDI events.
    int pos = 0;
    while (pos < frames) {
      while (ev < numEvents && events[ev].sampleOffset <= done + pos) applyEvent(events[ev++]);
      int end = frames;
      if (seq.playing) {
        seq.fire();
        const int next = seq.samplesToNextEvent();
        if (next < end - pos) end = pos + next;
      }
      if (ev < numEvents && events[ev].sampleOffset < done + end) end = events[ev].sampleOffset - done;
      renderVoices(left, right, pos, end);
      if (seq.playing) seq.advance(end - pos);
      pos = end;
    }

    postProcess(left, right, frames, gridPos);
    gridPos = (gridPos + frames) % BLOCK;
    done += frames;
  }
  while (ev < numEvents) applyEvent(events[ev++]); // offsets >= n
  publishMeter(L, R, n);
}

void Engine::renderVoices(float* left, float* right, int start, int end) {
  const int frames = end - start;
  const Params& p = cur;
  const int n = unisonCount;
  const double detuneCents = jsPow(p.detune, 1.6) * 60;
  const double driftCents = p.drift * 12;
  const double driftCoef = 1 - std::exp((-2 * kPi * DRIFT_RATE_HZ * frames) / sr);
  const double pw = std::fmin(0.95, std::fmax(0.05, p.pulseWidth));
  const int wave = p.wave;
  const double subLevel = p.subType == SUB_OFF ? 0 : p.subLevel;

  const EnvCoefs ampC = envCoefs(p.attack, p.decay, p.sustain, p.release, sr);
  const EnvCoefs filtC = envCoefs(p.fAttack, p.fDecay, p.fSustain, p.fRelease, sr);

  const double lfoHz = p.lfoSync ? seq.bpm / 60 / lfoDivBeats(p.lfoDiv) : p.lfoRate;
  lfo.render(lfoBuf, start, end, lfoHz, p.lfoShape);

  const double cutGlide = 1 - std::exp(-1 / (0.003 * sr));
  double cs = cutoffSmooth;
  for (int s = start; s < end; s++) {
    cs += (p.cutoff - cs) * cutGlide;
    cutBuf[s] = cs * CUTOFF_OCTAVES;
  }
  cutoffSmooth = cs;
  const double fold = p.fold;
  const double foldSym = p.foldSym;
  const double envOct = p.filterEnvAmt * FILTER_ENV_OCTAVES;
  const double lfoOct = p.lfoAmt * LFO_OCTAVES;
  const int mode = p.filterMode;
  const double res = p.resonance;

  for (Voice& v : voices) {
    if (!v.active()) continue;

    const double baseHz = midiToHz(v.note + p.octave * 12 + p.pitch + pitchBend) * jsPow(2, p.fine / 1200);
    for (int u = 0; u < n; u++) {
      if (rng() < 0.02) v.driftTarget[u] = rng() * 2 - 1;
      v.drift[u] += (v.driftTarget[u] - v.drift[u]) * driftCoef;
      const double cents = uniPos[u] * detuneCents + v.drift[u] * driftCents;
      v.inc[u] = std::fmin(0.45, (baseHz * jsPow(2, cents / 1200)) / sr);
    }
    v.subInc = (baseHz * jsPow(2, p.subOctave)) / sr;

    const double vel = 0.35 + 0.65 * v.velocity;
    const double keyOct = (p.keyTrack * (v.note + p.octave * 12 - 60)) / 12;
    VoiceFilter& filter = v.filter;
    Wavefolder& folder = v.folder;

    for (int s = start; s < end; s++) {
      const double amp = v.ampEnv.next(ampC);
      if (!v.ampEnv.active()) break;
      const double fenv = v.filtEnv.next(filtC);
      filter.setup(mode, 20 * jsPow(2, cutBuf[s] + envOct * fenv + lfoOct * lfoBuf[s] + keyOct), res);

      double l = 0;
      double r = 0;
      for (int u = 0; u < n; u++) {
        const double t = v.phase[u];
        const double dt = v.inc[u];
        double x;
        if (wave == WAVE_SAW) {
          x = 2 * t - 1 - polyBlep(t, dt);
        } else {
          x = t < pw ? 1 : -1;
          x += polyBlep(t, dt);
          double t2 = t - pw;
          if (t2 < 0) t2 += 1;
          x -= polyBlep(t2, dt);
          if (wave == WAVE_TRI) {
            v.triState[u] = dt * 4 * x + (1 - dt) * v.triState[u];
            x = v.triState[u];
          }
        }
        l += x * uniGainL[u];
        r += x * uniGainR[u];

        double next = t + dt;
        if (next >= 1) next -= 1;
        v.phase[u] = next;
      }

      l = folder.process(l, 0, fold, foldSym);
      r = folder.process(r, 1, fold, foldSym);

      if (subLevel > 0) {
        const double sp = v.subPhase;
        double sub;
        if (p.subType == SUB_SINE) {
          sub = std::sin(2 * kPi * sp);
        } else {
          sub = sp < 0.5 ? 1 : -1;
          sub += polyBlep(sp, v.subInc);
          double sp2 = sp - 0.5;
          if (sp2 < 0) sp2 += 1;
          sub -= polyBlep(sp2, v.subInc);
        }
        sub *= subLevel;
        l += sub;
        r += sub;
        double nsp = sp + v.subInc;
        if (nsp >= 1) nsp -= 1;
        v.subPhase = nsp;
      }

      const double g = amp * vel * 0.25;
      // Output buffers are Float32 in the AudioWorklet: accumulate in float.
      left[s] = static_cast<float>(static_cast<double>(left[s]) + filter.process(l, 0) * g);
      right[s] = static_cast<float>(static_cast<double>(right[s]) + filter.process(r, 1) * g);
    }
  }
}

// Per-block (128-grid) part of the FX: copy the effective params and compute
// the delay/reverb block coefficients.
void Engine::beginFx() {
  const Params& p = cur;
  delay.params.mix = p.delay_mix;
  delay.params.sync = p.delay_sync;
  delay.params.div = p.delay_div;
  delay.params.timeMs = p.delay_timeMs;
  delay.params.feedback = p.delay_feedback;
  delay.params.mode = p.delay_mode;
  delay.params.tone = p.delay_tone;
  delay.params.wow = p.delay_wow;
  delay.params.duck = p.delay_duck;
  delay.beginBlock(seq.bpm);

  reverb.params.mix = p.reverb_mix;
  reverb.params.size = p.reverb_size;
  reverb.params.decay = p.reverb_decay;
  reverb.params.damp = p.reverb_damp;
  reverb.params.predelay = p.reverb_predelay;
  reverb.params.mod = p.reverb_mod;
  reverb.params.shimmer = p.reverb_shimmer;
  reverb.params.gravity = p.reverb_gravity;
  reverb.params.quantum = p.reverb_quantum;
  reverb.params.freeze = p.reverb_freeze;
  reverb.beginBlock(BLOCK);
}

void Engine::postProcess(float* left, float* right, int frames, int offset) {
  const Params& p = cur;

  // Drive: asymmetric tanh adds even harmonics (the "meat").
  const double drive = 1 + p.drive * 8;
  const double bias = 0.15 * p.drive;
  const double biasOffset = std::tanh(bias);
  const double makeup = 1.1 / jsPow(drive, 0.3);
  const double vol = p.volume;
  const double dcR = 0.995;
  float* channels[2] = {left, right};
  for (int c = 0; c < 2; c++) {
    float* buf = channels[c];
    double x1 = dcX[c];
    double y1 = dcY[c];
    for (int s = 0; s < frames; s++) {
      const double x = (std::tanh(buf[s] * drive + bias) - biasOffset) * makeup;
      y1 = x - x1 + dcR * y1;
      x1 = x;
      buf[s] = static_cast<float>(y1);
    }
    dcX[c] = x1;
    dcY[c] = y1;
  }

  delay.run(left, right, frames);
  reverb.run(left, right, frames, offset);

  for (int s = 0; s < frames; s++) {
    left[s] = static_cast<float>(ceiling(left[s] * vol));
    right[s] = static_cast<float>(ceiling(right[s] * vol));
  }
}

void Engine::publishMeter(const float* L, const float* R, int n) {
  atomicAdd(mEnergy, reverb.energy);
  mEnergyCount.fetch_add(reverb.energyCount, std::memory_order_relaxed);
  mJumps.fetch_add(reverb.jumps, std::memory_order_relaxed);
  mCollapses.fetch_add(qubit.collapses, std::memory_order_relaxed);
  reverb.energy = 0;
  reverb.energyCount = 0;
  reverb.jumps = 0;
  qubit.collapses = 0;
  mLfo.store(lfo.value, std::memory_order_relaxed);
  for (int i = 0; i < 5; i++) mMods[i].store(modValues[i + 1], std::memory_order_relaxed);
  mBloch[0].store(qubit.x, std::memory_order_relaxed);
  mBloch[1].store(qubit.y, std::memory_order_relaxed);
  mBloch[2].store(qubit.z, std::memory_order_relaxed);
  mLorenz[0].store(lorenz.x, std::memory_order_relaxed);
  mLorenz[1].store(lorenz.z, std::memory_order_relaxed);

  if (n > 0) {
    double e = 0;
    for (int s = 0; s < n; s++) e += static_cast<double>(L[s]) * L[s] + static_cast<double>(R[s]) * R[s];
    const double rms = std::sqrt(e / (2.0 * n));
    // Instant attack, ~300 ms release.
    const double rel = std::exp(-n / (0.3 * sr));
    levelEnv = rms > levelEnv ? rms : rms + (levelEnv - rms) * rel;
    mLevel.store(levelEnv, std::memory_order_relaxed);
  }
}

MeterData Engine::takeMeter() {
  MeterData m{};
  const double energy = mEnergy.exchange(0, std::memory_order_relaxed);
  const long long count = mEnergyCount.exchange(0, std::memory_order_relaxed);
  m.rms = count ? std::sqrt(energy / count) : 0;
  m.jumps = mJumps.exchange(0, std::memory_order_relaxed);
  m.collapses = mCollapses.exchange(0, std::memory_order_relaxed);
  m.lfo = mLfo.load(std::memory_order_relaxed);
  for (int i = 0; i < 5; i++) m.mods[i] = mMods[i].load(std::memory_order_relaxed);
  for (int i = 0; i < 3; i++) m.bloch[i] = mBloch[i].load(std::memory_order_relaxed);
  for (int i = 0; i < 2; i++) m.lorenz[i] = mLorenz[i].load(std::memory_order_relaxed);
  return m;
}

double Engine::outputLevel() const { return mLevel.load(std::memory_order_relaxed); }

} // namespace mt

MT_DSP_END
