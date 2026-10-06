// Sequencer panel: scale-aware step grid. Rows are scale degrees (so changing
// scale or root re-maps the pattern musically); cells are polyphonic.
//
// Under the grid: ACC (accent), PROB (chance the step plays — rolled by the
// engine when the playhead arrives) and RATCH (1–4 hits per step).
//
// Mutation: at the end of every loop, each step mutates with probability
// Mutate. A note runs a quantum walk of Spread steps over the scale degrees and
// is measured (see quantum-walk.js); steps can also empty out, fill in, or
// change ratchet. Your hand-made pattern is kept — Revert brings it back.

import { createKnob } from './knob.js';
import { measureQuantumWalk } from './quantum-walk.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = {
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  'Minor Pent': [0, 3, 5, 7, 10],
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const STEPS = 16;
const PROB_CYCLE = [1, 0.75, 0.5, 0.25];
const STORAGE_KEY = 'meat-thumb.sequencer';

// A heavy little A-minor riff to start from.
const DEFAULT_PATTERN = {
  root: 9,
  octave: 2,
  scale: 'Minor',
  bpm: 124,
  swing: 0.12,
  gate: 0.55,
  length: 16,
  mutate: 0,
  spread: 2,
  cells: [[0], [], [0], [7], [], [0], [], [5], [0], [], [2], [], [4], [], [2, 6], []],
  accents: [true, false, false, true, false, false, false, false, true, false, false, true, false, false, false, false],
  probs: Array(STEPS).fill(1),
  ratchets: Array(STEPS).fill(1),
};

function loadState(storage) {
  try {
    const raw = storage.get(STORAGE_KEY);
    if (raw) return { ...structuredClone(DEFAULT_PATTERN), ...JSON.parse(raw) };
  } catch {}
  return structuredClone(DEFAULT_PATTERN);
}

// In the plugin, `hostTempo` hides BPM (the DAW sets it) and offers to follow
// the DAW's transport instead of the Play button.
export function createSequencer({ root: host, send, ensureAudio, storage, hostTempo = false }) {
  const state = loadState(storage);
  const pattern = {
    cells: state.cells.map((c) => new Set(c)),
    accents: [...state.accents],
    probs: [...state.probs],
    ratchets: [...state.ratchets],
  };
  // The pattern you made by hand; mutations drift away from it.
  let original = state.original ? structuredClone(state.original) : snapshot();
  let playing = false;
  let generation = 0;

  function snapshot() {
    return {
      cells: pattern.cells.map((c) => [...c]),
      accents: [...pattern.accents],
      probs: [...pattern.probs],
      ratchets: [...pattern.ratchets],
    };
  }

  function restore(snap) {
    pattern.cells = snap.cells.map((c) => new Set(c));
    pattern.accents = [...snap.accents];
    pattern.probs = [...snap.probs];
    pattern.ratchets = [...snap.ratchets];
  }

  const save = () => {
    const { cells, accents, probs, ratchets } = snapshot();
    storage.set(STORAGE_KEY, JSON.stringify({ ...state, cells, accents, probs, ratchets, original }));
  };

  const scale = () => SCALES[state.scale];
  const rowCount = () => (state.scale === 'Chromatic' ? 13 : scale().length * 2 + 1);
  const degreeToMidi = (d) => {
    const s = scale();
    return 12 * (state.octave + 1) + state.root + 12 * Math.floor(d / s.length) + s[d % s.length];
  };
  const midiName = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

  // --- Markup ---------------------------------------------------------------
  host.innerHTML = `
    <div class="seq-controls">
      <button class="seq-play" aria-pressed="false">▶ PLAY</button>
      <div class="knobs" data-group="seq"></div>
      ${hostTempo ? `<div class="host-tempo"><span class="label">Tempo</span><strong class="host-bpm">—</strong><label class="toggle"><input type="checkbox" data-param="seqHostSync" checked> follow host transport</label></div>` : ''}
      <div class="seq-selects">
        <label>Root <select data-k="root">${NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
        <label>Oct <select data-k="octave">${[1, 2, 3, 4].map((o) => `<option value="${o}">${o}</option>`).join('')}</select></label>
        <label>Scale <select data-k="scale">${Object.keys(SCALES).map((s) => `<option>${s}</option>`).join('')}</select></label>
      </div>
      <div class="seq-actions">
        <button data-act="random">RANDOM</button>
        <button data-act="clear">CLEAR</button>
      </div>
    </div>
    <div class="seq-mutation">
      <div class="knobs" data-group="mutation"></div>
      <div class="mutation-side">
        <div class="seq-actions">
          <button data-act="mutate">MUTATE NOW</button>
          <button data-act="revert">REVERT</button>
        </div>
        <div class="mutation-status" aria-live="polite">generation 0 · original</div>
      </div>
    </div>
    <div class="seq-grid" role="grid" aria-label="Step grid"></div>`;

  const grid = host.querySelector('.seq-grid');
  const playBtn = host.querySelector('.seq-play');
  const statusEl = host.querySelector('.mutation-status');

  // --- Engine sync ------------------------------------------------------------
  function sendPattern() {
    const rows = rowCount();
    const steps = pattern.cells.map((set, i) => ({
      notes: [...set].filter((d) => d < rows).map(degreeToMidi),
      accent: pattern.accents[i],
      prob: pattern.probs[i],
      ratchet: pattern.ratchets[i],
    }));
    send({ type: 'seq', steps, bpm: state.bpm, swing: state.swing, gate: state.gate, length: state.length });
    save();
  }

  // A hand edit: becomes the new original.
  function commit() {
    original = snapshot();
    generation = 0;
    updateStatus();
    sendPattern();
  }

  function updateStatus() {
    statusEl.textContent = generation === 0 ? 'generation 0 · original' : `generation ${generation} · mutated`;
  }

  // --- Grid -------------------------------------------------------------------
  let paintValue = null;

  function addCell(attrs, cls) {
    const cell = document.createElement('div');
    cell.className = `seq-cell ${cls}`;
    Object.assign(cell.dataset, attrs);
    grid.appendChild(cell);
    return cell;
  }

  function addLabel(text, cls = '') {
    const label = document.createElement('div');
    label.className = `seq-label ${cls}`;
    label.textContent = text;
    grid.appendChild(label);
  }

  function buildGrid() {
    const rows = rowCount();
    grid.style.setProperty('--rows', rows);
    grid.innerHTML = '';
    for (let r = rows - 1; r >= 0; r--) {
      const isRoot = r % scale().length === 0;
      addLabel(midiName(degreeToMidi(r)), isRoot ? 'root' : '');
      for (let s = 0; s < STEPS; s++) {
        addCell({ step: s, row: r }, `${s % 4 === 0 ? 'beat' : ''} ${isRoot ? 'root' : ''}`);
      }
    }
    addLabel('ACC', 'lane-label first');
    for (let s = 0; s < STEPS; s++) addCell({ step: s, lane: 'acc' }, 'lane first accent');
    addLabel('PROB', 'lane-label');
    for (let s = 0; s < STEPS; s++) addCell({ step: s, lane: 'prob' }, 'lane prob');
    addLabel('RATCH', 'lane-label');
    for (let s = 0; s < STEPS; s++) addCell({ step: s, lane: 'ratch' }, 'lane ratch');
    refreshGrid();
  }

  function refreshGrid() {
    for (const cell of grid.querySelectorAll('.seq-cell')) {
      const s = Number(cell.dataset.step);
      const lane = cell.dataset.lane;
      cell.classList.toggle('off-length', s >= state.length);
      if (lane === 'acc') {
        cell.classList.toggle('on', pattern.accents[s]);
      } else if (lane === 'prob') {
        const p = pattern.probs[s];
        cell.style.setProperty('--v', p);
        cell.textContent = p < 1 ? `${Math.round(p * 100)}` : '';
        cell.classList.toggle('on', p < 1);
      } else if (lane === 'ratch') {
        const r = pattern.ratchets[s];
        cell.textContent = r > 1 ? `×${r}` : '';
        cell.classList.toggle('on', r > 1);
      } else {
        cell.classList.toggle('on', pattern.cells[s].has(Number(cell.dataset.row)));
      }
    }
  }

  function applyCell(cell, value) {
    const s = Number(cell.dataset.step);
    if (cell.dataset.lane === 'acc') {
      pattern.accents[s] = value;
    } else {
      const r = Number(cell.dataset.row);
      if (value) pattern.cells[s].add(r);
      else pattern.cells[s].delete(r);
    }
    cell.classList.toggle('on', value);
  }

  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.seq-cell');
    if (!cell) return;
    const s = Number(cell.dataset.step);
    const lane = cell.dataset.lane;
    const dir = e.shiftKey ? -1 : 1;
    if (lane === 'prob') {
      const i = PROB_CYCLE.indexOf(pattern.probs[s]);
      pattern.probs[s] = PROB_CYCLE[(i + dir + PROB_CYCLE.length) % PROB_CYCLE.length];
      refreshGrid();
      commit();
      return;
    }
    if (lane === 'ratch') {
      pattern.ratchets[s] = ((pattern.ratchets[s] - 1 + dir + 4) % 4) + 1;
      refreshGrid();
      commit();
      return;
    }
    grid.setPointerCapture(e.pointerId);
    paintValue = !cell.classList.contains('on');
    applyCell(cell, paintValue);
  });
  grid.addEventListener('pointermove', (e) => {
    if (paintValue === null) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.seq-cell');
    if (!cell || cell.dataset.lane === 'prob' || cell.dataset.lane === 'ratch') return;
    if (cell.classList.contains('on') !== paintValue) applyCell(cell, paintValue);
  });
  const endPaint = () => {
    if (paintValue !== null) commit();
    paintValue = null;
  };
  grid.addEventListener('pointerup', endPaint);
  grid.addEventListener('pointercancel', endPaint);

  // --- Mutation -----------------------------------------------------------------
  function mutate(amount) {
    const rows = rowCount();
    const spread = state.spread;
    let changed = false;
    for (let i = 0; i < state.length; i++) {
      if (Math.random() >= amount) continue;
      const cell = pattern.cells[i];
      const r = Math.random();
      if (cell.size) {
        if (r < 0.7) {
          pattern.cells[i] = new Set([...cell].map((d) => measureQuantumWalk(d, spread, rows)));
        } else if (r < 0.85) {
          cell.clear(); // annihilation
          pattern.accents[i] = false;
        } else {
          pattern.ratchets[i] = pattern.ratchets[i] === 1 ? (Math.random() < 0.7 ? 2 : 3) : 1;
        }
      } else if (r < 0.5) {
        // creation: walk out from the nearest earlier note (or the root)
        let from = 0;
        for (let j = 1; j <= STEPS; j++) {
          const prev = pattern.cells[(i - j + STEPS) % STEPS];
          if (prev.size) {
            from = [...prev][0];
            break;
          }
        }
        cell.add(measureQuantumWalk(from, spread, rows));
      } else {
        continue;
      }
      changed = true;
    }
    if (changed) {
      generation++;
      updateStatus();
      refreshGrid();
      sendPattern();
    }
  }

  // --- Controls -----------------------------------------------------------------
  function addKnobs(group, defs) {
    const knobHost = host.querySelector(`.knobs[data-group="${group}"]`);
    for (const def of defs) {
      if (def.name === 'bpm' && hostTempo) continue;
      const knob = createKnob({
        ...def,
        value: state[def.name],
        onChange: (v) => {
          state[def.name] = v;
          if (def.name === 'length') refreshGrid();
          if (def.send !== false) sendPattern();
          else save();
        },
      });
      knobHost.appendChild(knob.el);
    }
  }
  addKnobs('seq', [
    { name: 'bpm', label: 'BPM', min: 40, max: 240, step: 1, format: (v) => `${v}` },
    { name: 'swing', label: 'Swing', min: 0, max: 0.5, format: (v) => `${Math.round(v * 200)}%` },
    { name: 'gate', label: 'Gate', min: 0.05, max: 1, format: (v) => (v >= 0.995 ? 'tie' : `${Math.round(v * 100)}%`) },
    { name: 'length', label: 'Steps', min: 1, max: 16, step: 1, format: (v) => `${v}` },
  ]);
  addKnobs('mutation', [
    { name: 'mutate', label: 'Mutate', min: 0, max: 1, send: false, format: (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`) },
    { name: 'spread', label: 'Spread', min: 1, max: 6, step: 1, send: false, format: (v) => `${v} step${v > 1 ? 's' : ''}` },
  ]);

  for (const sel of host.querySelectorAll('select[data-k]')) {
    const k = sel.dataset.k;
    sel.value = String(state[k]);
    sel.addEventListener('change', () => {
      state[k] = k === 'scale' ? sel.value : Number(sel.value);
      buildGrid();
      sendPattern();
    });
  }

  host.querySelector('[data-act="clear"]').addEventListener('click', () => {
    pattern.cells.forEach((c) => c.clear());
    pattern.accents.fill(false);
    pattern.probs.fill(1);
    pattern.ratchets.fill(1);
    refreshGrid();
    commit();
  });

  // Random: weighted toward the root and fifth, low register, some rests.
  host.querySelector('[data-act="random"]').addEventListener('click', () => {
    const s = scale().length;
    const fifth = scale().indexOf(7);
    const pool = [0, 0, 0, s, fifth, fifth, 2, 3, 4, s + 2, 1, 5].filter((d) => d >= 0 && d < rowCount());
    for (let i = 0; i < STEPS; i++) {
      const cell = pattern.cells[i];
      cell.clear();
      const density = i % 4 === 0 ? 0.85 : i % 2 === 0 ? 0.5 : 0.35;
      if (Math.random() < density) {
        cell.add(pool[Math.floor(Math.random() * pool.length)]);
        if (Math.random() < 0.12) cell.add(Math.min(rowCount() - 1, [...cell][0] + (state.scale === 'Chromatic' ? 7 : 4)));
      }
      pattern.accents[i] = cell.size > 0 && Math.random() < (i % 4 === 0 ? 0.6 : 0.2);
      pattern.probs[i] = i % 4 === 0 || !cell.size ? 1 : PROB_CYCLE[Math.floor(Math.random() * 2.5)];
      pattern.ratchets[i] = cell.size && Math.random() < 0.1 ? 2 : 1;
    }
    refreshGrid();
    commit();
  });

  host.querySelector('[data-act="mutate"]').addEventListener('click', () => mutate(Math.max(0.25, state.mutate)));
  host.querySelector('[data-act="revert"]').addEventListener('click', () => {
    restore(original);
    generation = 0;
    updateStatus();
    refreshGrid();
    sendPattern();
  });

  async function toggle() {
    await ensureAudio();
    playing = !playing;
    if (playing) {
      sendPattern();
      send({ type: 'seqPlay' });
    } else {
      send({ type: 'seqStop' });
    }
    showPlaying();
  }
  playBtn.addEventListener('click', toggle);

  let waiting = false; // plugin: armed, waiting for the DAW to press play
  function showPlaying() {
    playBtn.classList.toggle('on', playing && !waiting);
    playBtn.classList.toggle('armed', waiting);
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.textContent = waiting ? '● ARMED' : playing ? '■ STOP' : '▶ PLAY';
  }

  // Plugin: the engine may start/stop with the DAW's transport. Armed = Play
  // was pressed; with "follow host transport" it waits for the DAW.
  function setPlaying(running, armed = running) {
    const p = running || armed;
    const w = armed && !running;
    if (p === playing && w === waiting) return;
    playing = p;
    waiting = w;
    showPlaying();
    if (!running) setStep(-1, false);
  }

  const bpmEl = host.querySelector('.host-bpm');
  function setHostBpm(bpm) {
    if (bpmEl) bpmEl.textContent = `${Math.round(bpm * 10) / 10}`;
  }

  // --- Engine events ------------------------------------------------------------
  // Raw (un-delayed) step: mutate as the last step starts, so the new pattern
  // is in the engine before the loop comes round.
  function onEngineStep(step) {
    if (playing && state.mutate > 0 && step === state.length - 1) mutate(state.mutate);
  }

  let lastStep = -1;
  function setStep(step, played) {
    if (step !== lastStep) {
      for (const c of grid.querySelectorAll('.seq-cell.now')) c.classList.remove('now', 'ghost');
      lastStep = step;
    }
    if (step >= 0) {
      for (const c of grid.querySelectorAll(`.seq-cell[data-step="${step}"]`)) {
        c.classList.add('now');
        // A step that had notes but collapsed to silence this pass.
        c.classList.toggle('ghost', !played && pattern.cells[step].size > 0);
      }
    }
  }

  buildGrid();
  updateStatus();

  return {
    toggle,
    sendPattern,
    setStep,
    onEngineStep,
    setPlaying,
    setHostBpm,
    get playing() {
      return playing;
    },
  };
}
