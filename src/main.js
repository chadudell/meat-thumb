import { createKnob } from './ui/knob.js';
import { createSequencer } from './ui/sequencer.js';
import { LFO_DIVISIONS } from './dsp/lfo.js';
import { DELAY_DIVISIONS } from './dsp/tempo-delay.js';
import { qubitRateHz, qubitMeasureHz } from './dsp/mod-sources.js';
import { createModMatrix, createSourceDisplays } from './ui/mod-matrix.js';

// ---- Parameter definitions (UI side) ---------------------------------------

const pct = (v) => `${Math.round(v * 100)}%`;
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`);
const signedPct = (v) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
const secs = (v) => (v < 1 ? `${Math.round(v * 1000)}ms` : v < 10 ? `${v.toFixed(2)}s` : `${Math.round(v)}s`);

const KNOBS = {
  osc: [
    { name: 'pulseWidth', label: 'PW', min: 0.05, max: 0.95, value: 0.5, format: pct },
    { name: 'octave', label: 'Octave', min: -2, max: 2, value: 0, step: 1, format: (v) => (v > 0 ? `+${v}` : `${v}`) },
    { name: 'fine', label: 'Fine', min: -100, max: 100, value: 0, step: 1, format: (v) => `${v}c` },
    { name: 'drive', label: 'Drive', min: 0, max: 1, value: 0.35, format: pct },
    { name: 'fold', label: 'Fold', min: 0, max: 1, value: 0, format: (v) => (v < 0.005 ? 'off' : pct(v)) },
    { name: 'foldSym', label: 'Sym', min: -1, max: 1, value: 0, bipolar: true, format: signedPct },
  ],
  unison: [
    { name: 'unison', label: 'Voices', min: 1, max: 9, value: 7, step: 1, format: (v) => `${v}` },
    { name: 'detune', label: 'Detune', min: 0, max: 1, value: 0.35, format: pct },
    { name: 'blend', label: 'Blend', min: 0, max: 1, value: 0.6, format: pct },
    { name: 'width', label: 'Width', min: 0, max: 1, value: 0.8, format: pct },
    { name: 'drift', label: 'Drift', min: 0, max: 1, value: 0.3, format: pct },
  ],
  sub: [
    { name: 'subLevel', label: 'Level', min: 0, max: 1, value: 0.4, format: pct },
  ],
  amp: [
    { name: 'attack', label: 'Attack', min: 0.001, max: 2, value: 0.005, format: secs },
    { name: 'decay', label: 'Decay', min: 0.01, max: 3, value: 0.3, format: secs },
    { name: 'sustain', label: 'Sustain', min: 0, max: 1, value: 0.85, format: pct },
    { name: 'release', label: 'Release', min: 0.01, max: 4, value: 0.25, format: secs },
    { name: 'volume', label: 'Volume', min: 0, max: 1, value: 0.7, format: pct },
  ],
  filter: [
    { name: 'cutoff', label: 'Cutoff', min: 0, max: 1, value: 0.7, format: (v) => hz(20 * Math.pow(1000, v)) },
    { name: 'resonance', label: 'Res', min: 0, max: 1, value: 0.2, format: pct },
    { name: 'filterEnvAmt', label: 'Env', min: -1, max: 1, value: 0.25, bipolar: true, format: signedPct },
    { name: 'keyTrack', label: 'Key', min: 0, max: 1, value: 0.5, format: pct },
    { name: 'fAttack', label: 'F.Atk', min: 0.001, max: 2, value: 0.005, format: secs },
    { name: 'fDecay', label: 'F.Dec', min: 0.01, max: 3, value: 0.4, format: secs },
    { name: 'fSustain', label: 'F.Sus', min: 0, max: 1, value: 0.3, format: pct },
    { name: 'fRelease', label: 'F.Rel', min: 0.01, max: 4, value: 0.3, format: secs },
  ],
  lfo: [
    { name: 'lfoRate', label: 'Rate', min: 0.05, max: 30, value: 2, format: (v) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)}Hz` },
    { name: 'lfoDiv', label: 'Div', min: 0, max: LFO_DIVISIONS.length - 1, value: 8, step: 1, format: (v) => LFO_DIVISIONS[v].label },
    { name: 'lfoAmt', label: 'Amount', min: -1, max: 1, value: 0, bipolar: true, format: signedPct },
  ],
  lfo2: [
    { name: 'lfo2Rate', label: 'Rate', min: 0.02, max: 20, value: 0.3, format: (v) => `${v < 10 ? v.toFixed(2) : v.toFixed(1)}Hz` },
    { name: 'lfo2Div', label: 'Div', min: 0, max: LFO_DIVISIONS.length - 1, value: 2, step: 1, format: (v) => LFO_DIVISIONS[v].label },
  ],
  qubit: [
    { name: 'qubitRate', label: 'Rabi', min: 0, max: 1, value: 0.5, format: (v) => `${qubitRateHz(v).toFixed(qubitRateHz(v) < 1 ? 2 : 1)}Hz` },
    { name: 'qubitMeasure', label: 'Measure', min: 0, max: 1, value: 0.25, format: (v) => `${qubitMeasureHz(v).toFixed(qubitMeasureHz(v) < 10 ? 1 : 0)}/s` },
    { name: 'qubitTilt', label: 'Tilt', min: 0, max: 1, value: 0.8, format: (v) => `${Math.round(v * 90)}°` },
  ],
  lorenz: [
    { name: 'lorenzSpeed', label: 'Speed', min: 0, max: 1, value: 0.35, format: pct },
  ],
  dice: [
    { name: 'diceSlew', label: 'Slew', min: 0, max: 1, value: 0.15, format: (v) => secs(Math.max(0.001, v * v * 0.5)) },
  ],
  delay: [
    { name: 'timeMs', label: 'Time', min: 10, max: 2000, value: 350, format: (v) => `${Math.round(v)}ms` },
    { name: 'div', label: 'Div', min: 0, max: DELAY_DIVISIONS.length - 1, value: 5, step: 1, format: (v) => DELAY_DIVISIONS[v].label },
    { name: 'feedback', label: 'Feedback', min: 0, max: 1.1, value: 0.4, format: pct },
    { name: 'tone', label: 'Tone', min: 0, max: 1, value: 0.6, format: (v) => hz(500 * Math.pow(40, v)) },
    { name: 'wow', label: 'Wow', min: 0, max: 1, value: 0.15, format: pct },
    { name: 'duck', label: 'Duck', min: 0, max: 1, value: 0.3, format: pct },
    { name: 'mix', label: 'Mix', min: 0, max: 1, value: 0.2, format: pct },
  ],
  reverb: [
    { name: 'mix', label: 'Mix', min: 0, max: 1, value: 0.3, format: pct },
    { name: 'size', label: 'Size', min: 0, max: 1, value: 0.6, format: pct },
    { name: 'decay', label: 'Decay', min: 0, max: 1, value: 0.55, format: (v) => secs(0.3 * Math.pow(400, v)) },
    { name: 'damp', label: 'Damp', min: 0, max: 1, value: 0.4, format: pct },
    { name: 'predelay', label: 'Pre', min: 0, max: 0.5, value: 0.02, format: secs },
    { name: 'mod', label: 'Mod', min: 0, max: 1, value: 0.3, format: pct },
    { name: 'shimmer', label: 'Shimmer', min: 0, max: 1, value: 0, format: pct },
    { name: 'quantum', label: 'Quantum', min: 0, max: 1, value: 0.25, format: pct },
    { name: 'gravity', label: 'Gravity', min: 0, max: 1, value: 0, format: (v) => (v < 0.005 ? 'off' : secs(0.25 + 3.7 * v * v)) },
  ],
};
const GROUP_TARGET = { reverb: 'reverb', delay: 'delay' };
const MESSAGE_TYPE = { synth: 'param', reverb: 'reverbParam', delay: 'delayParam' };

// ---- Audio engine -----------------------------------------------------------

let ctx = null;
let node = null;
let analyser = null;
const params = {};

// Params are keyed "target:name" (e.g. "delay:mix") so modules can share names.
function setParam(key, value) {
  params[key] = value;
  const [target, name] = key.includes(':') ? key.split(':') : ['synth', key];
  node?.port.postMessage({ type: MESSAGE_TYPE[target], name, value });
}
const keyOf = (target, name) => (target && target !== 'synth' ? `${target}:${name}` : name);

async function startAudio() {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('src/dsp/meat-thumb-processor.js');
  node = new AudioWorkletNode(ctx, 'meat-thumb', { outputChannelCount: [2] });
  node.port.onmessage = ({ data }) => {
    if (data.type === 'meter') {
      onMeter(data);
      sources.update(data);
    } else if (data.type === 'step') {
      seq.onEngineStep(data.step);
      // Show the playhead when the step is heard, not when it's computed.
      const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
      setTimeout(() => seq.setStep(data.step, data.played), latency * 1000);
    }
  };
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  node.connect(analyser);
  analyser.connect(ctx.destination);
  for (const [name, value] of Object.entries(params)) setParam(name, value);
  seq.sendPattern();
  matrix.sendSlots();
  drawScope();
  drawHorizon();
}

const powerBtn = document.getElementById('power');
powerBtn.addEventListener('click', async () => {
  if (!ctx) {
    await startAudio();
  } else if (ctx.state === 'running') {
    node.port.postMessage({ type: 'allOff' });
    await ctx.suspend();
  } else {
    await ctx.resume();
  }
  const on = ctx.state === 'running';
  powerBtn.classList.toggle('on', on);
  powerBtn.setAttribute('aria-pressed', String(on));
});

async function ensureAudio() {
  if (!ctx) await startAudio();
  else if (ctx.state !== 'running') await ctx.resume();
  powerBtn.classList.add('on');
  powerBtn.setAttribute('aria-pressed', 'true');
}

const matrix = createModMatrix({
  host: document.getElementById('slots'),
  send: (msg) => node?.port.postMessage(msg),
});
const sources = createSourceDisplays({ getTilt: () => params.qubitTilt });

const seq = createSequencer({
  root: document.getElementById('seq-body'),
  send: (msg) => node?.port.postMessage(msg),
  ensureAudio,
});

// ---- Controls ---------------------------------------------------------------

const knobEls = {};
for (const [group, defs] of Object.entries(KNOBS)) {
  const host = document.querySelector(`.knobs[data-group="${group}"]`);
  for (const def of defs) {
    const key = keyOf(GROUP_TARGET[group], def.name);
    params[key] = def.value;
    const knob = createKnob({ ...def, onChange: (v) => setParam(key, v) });
    knobEls[key] = knob.el;
    host.appendChild(knob.el);
  }
}

for (const group of document.querySelectorAll('.select-group')) {
  const name = keyOf(group.dataset.target, group.dataset.param);
  const buttons = [...group.querySelectorAll('button')];
  params[name] = Number(group.querySelector('.on').dataset.value);
  for (const b of buttons) {
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.toggle('on', x === b));
      setParam(name, Number(b.dataset.value));
    });
  }
}

for (const sel of document.querySelectorAll('select[data-param]')) {
  params[sel.dataset.param] = Number(sel.value);
  sel.addEventListener('change', () => setParam(sel.dataset.param, Number(sel.value)));
}

for (const input of document.querySelectorAll('input[type=checkbox][data-param]')) {
  const key = keyOf(input.dataset.target, input.dataset.param);
  params[key] = input.checked;
  input.addEventListener('change', () => {
    setParam(key, input.checked);
    showSyncedKnobs();
  });
}

// Synced LFO/delay show a note division instead of Hz/ms.
function showSyncedKnobs() {
  knobEls.lfoRate.hidden = params.lfoSync;
  knobEls.lfoDiv.hidden = !params.lfoSync;
  knobEls.lfo2Rate.hidden = params.lfo2Sync;
  knobEls.lfo2Div.hidden = !params.lfo2Sync;
  knobEls['delay:timeMs'].hidden = params['delay:sync'];
  knobEls['delay:div'].hidden = !params['delay:sync'];
}
showSyncedKnobs();

const freezeBtn = document.getElementById('freeze');
params['reverb:freeze'] = false;
freezeBtn.addEventListener('click', () => {
  const on = !params['reverb:freeze'];
  setParam('reverb:freeze', on);
  freezeBtn.classList.toggle('on', on);
  freezeBtn.setAttribute('aria-pressed', String(on));
});

// ---- Notes ------------------------------------------------------------------

const held = new Set();

async function noteOn(note, velocity = 0.9) {
  await ensureAudio();
  if (ctx.state !== 'running') return;
  held.add(note);
  node.port.postMessage({ type: 'noteOn', note, velocity });
  keyEls.get(note)?.classList.add('down');
}

function noteOff(note) {
  held.delete(note);
  node?.port.postMessage({ type: 'noteOff', note });
  keyEls.get(note)?.classList.remove('down');
}

// On-screen keyboard: 3 octaves from C2.
const keyboard = document.getElementById('keyboard');
const keyEls = new Map();
const FIRST = 36;
const LAST = 72;
const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);
let whiteIndex = 0;
const whiteCount = [...Array(LAST - FIRST + 1).keys()].filter((i) => !isBlack(FIRST + i)).length;
keyboard.style.setProperty('--whites', whiteCount);
for (let n = FIRST; n <= LAST; n++) {
  const k = document.createElement('div');
  k.className = isBlack(n) ? 'key black' : 'key white';
  if (isBlack(n)) k.style.setProperty('--i', whiteIndex);
  else k.style.setProperty('--i', whiteIndex++);
  k.dataset.note = n;
  keyEls.set(n, k);
  keyboard.appendChild(k);
}

let mouseNote = null;
keyboard.addEventListener('pointerdown', (e) => {
  const k = e.target.closest('.key');
  if (!k) return;
  keyboard.setPointerCapture(e.pointerId);
  mouseNote = Number(k.dataset.note);
  noteOn(mouseNote);
});
keyboard.addEventListener('pointermove', (e) => {
  if (mouseNote === null) return;
  const k = document.elementFromPoint(e.clientX, e.clientY)?.closest('.key');
  const n = k ? Number(k.dataset.note) : null;
  if (n !== null && n !== mouseNote) {
    noteOff(mouseNote);
    mouseNote = n;
    noteOn(n);
  }
});
const releaseMouse = () => {
  if (mouseNote !== null) noteOff(mouseNote);
  mouseNote = null;
};
keyboard.addEventListener('pointerup', releaseMouse);
keyboard.addEventListener('pointercancel', releaseMouse);

// Computer keyboard: home row = white keys, row above = black keys.
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };
let baseNote = 48;
const octLabel = document.getElementById('oct-label');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const updateOct = () => (octLabel.textContent = `${NAMES[baseNote % 12]}${Math.floor(baseNote / 12) - 1}`);
updateOct();
const keyNotes = new Map();

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('select, input, button')) return;
  const key = e.key.toLowerCase();
  if (key === ' ') {
    e.preventDefault();
    seq.toggle();
    return;
  }
  if (key === 'z' || key === 'x') {
    baseNote = Math.min(96, Math.max(12, baseNote + (key === 'z' ? -12 : 12)));
    updateOct();
    return;
  }
  if (key in KEYMAP && !keyNotes.has(key)) {
    const note = baseNote + KEYMAP[key];
    keyNotes.set(key, note);
    noteOn(note);
  }
});
window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  const note = keyNotes.get(key);
  if (note !== undefined) {
    keyNotes.delete(key);
    noteOff(note);
  }
});
window.addEventListener('blur', () => {
  for (const n of [...held]) noteOff(n);
  keyNotes.clear();
});

// Web MIDI
const midiStatus = document.getElementById('midi-status');
if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess().then((access) => {
    const bind = () => {
      const inputs = [...access.inputs.values()];
      midiStatus.textContent = inputs.length ? `MIDI: ${inputs.map((i) => i.name).join(', ')}` : 'MIDI: no devices';
      for (const input of inputs) {
        input.onmidimessage = ({ data: [status, d1, d2] }) => {
          const cmd = status & 0xf0;
          if (cmd === 0x90 && d2 > 0) noteOn(d1, d2 / 127);
          else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1);
        };
      }
    };
    bind();
    access.onstatechange = bind;
  }, () => (midiStatus.textContent = 'MIDI: unavailable'));
} else {
  midiStatus.textContent = 'MIDI: not supported';
}

// ---- Scope ------------------------------------------------------------------

const scope = document.getElementById('scope');
const sctx = scope.getContext('2d');

function drawScope() {
  const buf = new Float32Array(analyser.fftSize);
  const render = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = scope.clientWidth;
    const h = scope.clientHeight;
    if (scope.width !== w * dpr) {
      scope.width = w * dpr;
      scope.height = h * dpr;
    }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    analyser.getFloatTimeDomainData(buf);

    // Trigger on a rising zero crossing so the trace holds still.
    let start = 0;
    for (let i = 1; i < buf.length / 2; i++) {
      if (buf[i - 1] < 0 && buf[i] >= 0) {
        start = i;
        break;
      }
    }
    const css = getComputedStyle(document.documentElement);
    sctx.clearRect(0, 0, w, h);
    sctx.strokeStyle = css.getPropertyValue('--grid');
    sctx.lineWidth = 1;
    sctx.beginPath();
    sctx.moveTo(0, h / 2);
    sctx.lineTo(w, h / 2);
    sctx.stroke();

    sctx.strokeStyle = css.getPropertyValue('--trace');
    sctx.lineWidth = 2;
    sctx.beginPath();
    const span = 1024;
    for (let x = 0; x < w; x++) {
      const v = buf[start + Math.floor((x / w) * span)] || 0;
      const y = h / 2 - v * (h / 2) * 0.9;
      x ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
    sctx.stroke();
    requestAnimationFrame(render);
  };
  render();
}

// ---- Event horizon ----------------------------------------------------------
// Ring brightness/size follows reverb energy; each quantum jump spawns a
// particle that spirals into the void.

const horizon = document.getElementById('horizon');
const hctx = horizon.getContext('2d');
let level = 0;
const particles = [];

const lfoDot = document.querySelector('.lfo-meter span');

function onMeter({ rms, jumps, lfo }) {
  lfoDot.style.left = `${((lfo + 1) / 2) * 100}%`;
  level = Math.max(rms, level * 0.9);
  for (let i = 0; i < jumps && particles.length < 120; i++) {
    particles.push({ a: Math.random() * Math.PI * 2, r: 1, v: 0.004 + Math.random() * 0.01 });
  }
}

function drawHorizon() {
  const render = () => {
    const dpr = window.devicePixelRatio || 1;
    const size = horizon.clientWidth;
    if (horizon.width !== size * dpr) {
      horizon.width = horizon.height = size * dpr;
    }
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2;
    const css = getComputedStyle(document.documentElement);
    const hot = params['reverb:freeze'] ? css.getPropertyValue('--ice').trim() : css.getPropertyValue('--trace').trim();
    const e = Math.min(1, level * 6);
    const core = size * 0.16;

    hctx.clearRect(0, 0, size, size);

    // Accretion glow
    const glow = hctx.createRadialGradient(c, c, core, c, c, core + size * 0.34 * (0.25 + e));
    glow.addColorStop(0, hot);
    glow.addColorStop(1, 'transparent');
    hctx.globalAlpha = 0.15 + 0.85 * e;
    hctx.fillStyle = glow;
    hctx.beginPath();
    hctx.arc(c, c, size / 2, 0, Math.PI * 2);
    hctx.fill();

    // Infalling particles
    hctx.globalAlpha = 1;
    hctx.fillStyle = hot;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.r -= p.v;
      p.a += 0.06 / Math.max(p.r, 0.15);
      if (p.r <= 0) {
        particles.splice(i, 1);
        continue;
      }
      const rad = core + p.r * (size / 2 - core);
      hctx.globalAlpha = p.r;
      hctx.beginPath();
      hctx.arc(c + Math.cos(p.a) * rad, c + Math.sin(p.a) * rad, 1.5, 0, Math.PI * 2);
      hctx.fill();
    }

    // The void
    hctx.globalAlpha = 1;
    hctx.fillStyle = '#000';
    hctx.beginPath();
    hctx.arc(c, c, core, 0, Math.PI * 2);
    hctx.fill();

    level *= 0.985;
    requestAnimationFrame(render);
  };
  render();
}
