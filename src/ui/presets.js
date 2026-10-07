// Preset bar: factory cuts plus your own. A preset is a snapshot of the knob,
// switch and toggle values (the mod matrix and sequencer pattern are kept
// separately, so swapping sounds doesn't wipe your riff). Anything a preset
// leaves out falls back to the default patch.
//
// User presets live in host storage — localStorage on the web, the AU's saved
// state in a plugin (so they travel with the project).

const STORE = 'meat-thumb.presets';
const CURRENT = 'meat-thumb.preset';

export const FACTORY = [
  { name: 'Prime Rib', params: {} },
  {
    name: 'Brisket Bass',
    params: {
      octave: -1, unison: 3, detune: 0.15, subType: 1, subLevel: 0.9, cutoff: 0.36, resonance: 0.25,
      filterEnvAmt: 0.45, fDecay: 0.25, fSustain: 0.1, drive: 0.55, release: 0.12,
      'reverb:mix': 0.08, 'delay:mix': 0.04,
    },
  },
  {
    name: 'Wobble Loin',
    params: {
      octave: -1, lfoSync: true, lfoDiv: 9, lfoShape: 2, lfoAmt: 0.55, cutoff: 0.42, resonance: 0.55,
      subLevel: 0.6, drive: 0.5, filterEnvAmt: 0.1, 'reverb:mix': 0.12,
    },
  },
  {
    name: 'Fat Cap Pad',
    params: {
      attack: 0.6, release: 2.5, unison: 9, detune: 0.5, cutoff: 0.55, filterEnvAmt: 0.1, subLevel: 0.2,
      drive: 0.2, 'reverb:mix': 0.55, 'reverb:size': 0.85, 'reverb:decay': 0.8, 'reverb:shimmer': 0.45,
      'delay:mix': 0.25,
    },
  },
  {
    name: 'Chop Shop Lead',
    params: {
      wave: 1, pulseWidth: 0.3, unison: 5, drive: 0.85, fold: 0.35, cutoff: 0.75, resonance: 0.35,
      'delay:mix': 0.3, 'delay:feedback': 0.55, 'reverb:mix': 0.2,
    },
  },
  {
    name: 'Quantum Giblets',
    params: {
      fold: 0.5, foldSym: 0.3, cutoff: 0.6, resonance: 0.4, 'reverb:quantum': 0.8, 'reverb:gravity': 0.5,
      'reverb:mix': 0.45, lfo2Rate: 0.8,
    },
  },
  {
    name: 'Max Meat',
    params: {
      subType: 2, subOctave: -2, subLevel: 1, cutoff: 0.25, resonance: 0.85, drive: 1, fold: 0.6,
      'reverb:mix': 0.7, 'reverb:size': 0.9, 'delay:mix': 0.35, 'delay:feedback': 0.7, unison: 9, detune: 0.6,
    },
  },
];

export function createPresets({ root, storage, defaults, snapshot, apply }) {
  const nameEl = root.querySelector('.preset-name');
  const input = root.querySelector('.preset-input');
  const menu = root.querySelector('.preset-menu');

  let user = [];
  try {
    user = JSON.parse(storage.get(STORE)) || [];
  } catch {}
  const all = () => [...FACTORY.map((p) => ({ ...p, factory: true })), ...user];

  let index = Math.max(0, all().findIndex((p) => p.name === storage.get(CURRENT)));
  let dirty = false;

  function show() {
    const p = all()[index];
    nameEl.textContent = `${String(index + 1).padStart(2, '0')}  ${p.name}${dirty ? ' *' : ''}`;
    nameEl.title = p.factory ? 'Factory preset' : 'Your preset';
  }

  function load(i) {
    const list = all();
    index = (i + list.length) % list.length;
    const p = list[index];
    const values = {};
    for (const key of Object.keys(defaults)) values[key] = key in p.params ? p.params[key] : defaults[key];
    apply(values);
    dirty = false;
    storage.set(CURRENT, p.name);
    show();
  }

  function persist() {
    storage.set(STORE, JSON.stringify(user));
  }

  function saveAs(name) {
    name = name.trim().slice(0, 28);
    if (!name) return;
    const existing = user.findIndex((p) => p.name === name);
    const preset = { name, params: snapshot() };
    if (existing >= 0) user[existing] = preset;
    else user.push(preset);
    persist();
    index = all().findIndex((p) => p.name === name);
    dirty = false;
    storage.set(CURRENT, name);
    show();
  }

  function askName() {
    const p = all()[index];
    input.value = p.factory ? `${p.name} copy` : p.name;
    nameEl.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  }
  function endAsk(commit) {
    if (input.hidden) return;
    input.hidden = true;
    nameEl.hidden = false;
    if (commit) saveAs(input.value);
  }
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep the computer keyboard from playing notes while typing
    if (e.key === 'Enter') endAsk(true);
    else if (e.key === 'Escape') endAsk(false);
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  input.addEventListener('blur', () => endAsk(false));

  root.addEventListener('click', (e) => {
    const step = e.target.closest('.preset-step');
    if (step) return load(index + Number(step.dataset.dir));
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act !== 'more') menu.hidden = true;
    if (act === 'save') {
      const p = all()[index];
      if (p.factory) askName();
      else saveAs(p.name);
    } else if (act === 'saveas') askName();
    else if (act === 'more') menu.hidden = !menu.hidden;
    else if (act === 'init') load(0);
    else if (act === 'delete') {
      const p = all()[index];
      if (p.factory) return;
      user = user.filter((u) => u.name !== p.name);
      persist();
      load(Math.min(index, all().length - 1));
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.preset-more')) menu.hidden = true;
  });

  show();
  return {
    // A knob moved by hand: the patch no longer matches the preset.
    touched() {
      if (dirty) return;
      dirty = true;
      show();
    },
  };
}
