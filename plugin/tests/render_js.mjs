// Renders plugin/tests/scenarios.txt through the real AudioWorklet processor
// (src/dsp/meat-thumb-processor.js) under JavaScriptCore.
//
//   jsc -m render_js.mjs -- <scenarios.txt> <outDir> [scenarioName]
//
// Writes <outDir>/<name>.f32: Float32 little-endian, all L samples then all R.

const [scenarioPath, outDir, only] = arguments;
const SR = 48000;
const BLOCK = 128;

// --- AudioWorkletGlobalScope shims -----------------------------------------
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage: () => {} };
  }
};
let ProcessorClass = null;
globalThis.registerProcessor = (name, cls) => {
  ProcessorClass = cls;
};

// Deterministic Math.random (the scenarios neutralise randomness anyway; this
// just makes repeated JS runs reproducible).
let seed = 0x12345678;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  return (seed >>> 0) / 4294967296;
};

await import('../../src/dsp/meat-thumb-processor.js');

// --- Scenario parsing ------------------------------------------------------
function parseScenarios(text) {
  const prelude = [];
  const scenarios = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const tok = line.split(/\s+/);
    if (tok[0] === 'scenario') {
      cur = { name: tok[1], blocks: parseInt(tok[2], 10), cmds: [] };
    } else if (tok[0] === 'end') {
      scenarios.push(cur);
      cur = null;
    } else if (cur) {
      cur.cmds.push({ block: parseInt(tok[0], 10), tok: tok.slice(1) });
    } else {
      prelude.push({ block: 0, tok });
    }
  }
  return { prelude, scenarios };
}

function makeMessage(tok, staged) {
  const num = (s) => parseFloat(s);
  switch (tok[0]) {
    case 'param':
      return { type: 'param', name: tok[1], value: num(tok[2]) };
    case 'delayParam':
      return { type: 'delayParam', name: tok[1], value: num(tok[2]) };
    case 'reverbParam':
      return { type: 'reverbParam', name: tok[1], value: num(tok[2]) };
    case 'modSlots': {
      const slots = [];
      for (let i = 0; i < 8; i++) {
        const spec = tok[1 + i];
        if (!spec) {
          slots.push({ src: 0, dest: '', amt: 0 });
          continue;
        }
        const parts = spec.split(':');
        slots.push({ src: parseInt(parts[0], 10), dest: parts.slice(1, -1).join(':'), amt: num(parts[parts.length - 1]) });
      }
      return { type: 'modSlots', slots };
    }
    case 'seqStep': {
      const idx = parseInt(tok[1], 10);
      staged[idx] = {
        notes: tok[5] === '-' ? [] : tok[5].split(',').map((n) => parseInt(n, 10)),
        accent: tok[2] === '1',
        prob: num(tok[3]),
        ratchet: parseInt(tok[4], 10),
      };
      return null;
    }
    case 'seq': {
      const steps = [];
      for (let i = 0; i < 16; i++) steps.push(staged[i] || { notes: [], accent: false, prob: 1, ratchet: 1 });
      return { type: 'seq', steps, bpm: num(tok[1]), swing: num(tok[2]), gate: num(tok[3]), length: parseInt(tok[4], 10) };
    }
    case 'seqPlay':
      return { type: 'seqPlay' };
    case 'seqStop':
      return { type: 'seqStop' };
    case 'noteOn':
      return { type: 'noteOn', note: parseInt(tok[1], 10), velocity: num(tok[2]) };
    case 'noteOff':
      return { type: 'noteOff', note: parseInt(tok[1], 10) };
    case 'allOff':
      return { type: 'allOff' };
  }
  throw new Error('unknown command ' + tok.join(' '));
}

const { prelude, scenarios } = parseScenarios(readFile(scenarioPath));
for (const sc of scenarios) {
  if (only && sc.name !== only) continue;
  seed = 0x12345678;
  const proc = new ProcessorClass();
  const staged = [];
  const cmds = [...prelude, ...sc.cmds];
  const frames = sc.blocks * BLOCK;
  const out = new Float32Array(frames * 2);
  const L = new Float32Array(BLOCK);
  const R = new Float32Array(BLOCK);
  const t0 = Date.now();
  for (let b = 0; b < sc.blocks; b++) {
    for (const c of cmds) {
      if (c.block !== b) continue;
      const msg = makeMessage(c.tok, staged);
      if (msg) proc.port.onmessage({ data: msg });
    }
    proc.process([], [[L, R]], {});
    out.set(L, b * BLOCK);
    out.set(R, frames + b * BLOCK);
  }
  writeFile(`${outDir}/${sc.name}.f32`, out.buffer);
  print(`${sc.name}: ${frames} frames in ${Date.now() - t0} ms`);
}
