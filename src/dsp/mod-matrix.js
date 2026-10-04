// Meat Thumb — modulation sources/destinations (shared by the engine and UI)
//
// A slot adds  amount × source × (max − min) / 2  to the destination's knob
// value, then clamps to [min, max]. So amount 100% with a full-swing source
// sweeps half the knob's range either side of where you set it.

export const MOD_SOURCES = ['—', 'LFO 1', 'LFO 2', 'Qubit', 'Lorenz', 'Dice'];
export const MOD_SLOTS = 8;

// Keys use the same "target:name" convention as the UI (no prefix = synth).
export const MOD_DESTINATIONS = [
  { key: 'pitch', label: 'Pitch', group: 'Osc', min: -12, max: 12 },
  { key: 'pulseWidth', label: 'PW', group: 'Osc', min: 0.05, max: 0.95 },
  { key: 'fold', label: 'Fold', group: 'Osc', min: 0, max: 1 },
  { key: 'foldSym', label: 'Fold Sym', group: 'Osc', min: -1, max: 1 },
  { key: 'drive', label: 'Drive', group: 'Osc', min: 0, max: 1 },
  { key: 'subLevel', label: 'Sub Level', group: 'Osc', min: 0, max: 1 },
  { key: 'detune', label: 'Detune', group: 'Unison', min: 0, max: 1 },
  { key: 'blend', label: 'Blend', group: 'Unison', min: 0, max: 1 },
  { key: 'width', label: 'Width', group: 'Unison', min: 0, max: 1 },
  { key: 'drift', label: 'Drift', group: 'Unison', min: 0, max: 1 },
  { key: 'cutoff', label: 'Cutoff', group: 'Filter', min: 0, max: 1 },
  { key: 'resonance', label: 'Resonance', group: 'Filter', min: 0, max: 1 },
  { key: 'filterEnvAmt', label: 'Filter Env', group: 'Filter', min: -1, max: 1 },
  { key: 'lfoAmt', label: 'LFO 1 Amount', group: 'LFO', min: -1, max: 1 },
  { key: 'lfoRate', label: 'LFO 1 Rate', group: 'LFO', min: 0.05, max: 30 },
  { key: 'volume', label: 'Volume', group: 'Amp', min: 0, max: 1 },
  { key: 'delay:mix', label: 'Delay Mix', group: 'Delay', min: 0, max: 1 },
  { key: 'delay:feedback', label: 'Delay Feedback', group: 'Delay', min: 0, max: 1.1 },
  { key: 'delay:tone', label: 'Delay Tone', group: 'Delay', min: 0, max: 1 },
  { key: 'delay:wow', label: 'Delay Wow', group: 'Delay', min: 0, max: 1 },
  { key: 'delay:timeMs', label: 'Delay Time (free)', group: 'Delay', min: 10, max: 2000 },
  { key: 'reverb:mix', label: 'Reverb Mix', group: 'Reverb', min: 0, max: 1 },
  { key: 'reverb:size', label: 'Reverb Size', group: 'Reverb', min: 0, max: 1 },
  { key: 'reverb:decay', label: 'Reverb Decay', group: 'Reverb', min: 0, max: 1 },
  { key: 'reverb:damp', label: 'Reverb Damp', group: 'Reverb', min: 0, max: 1 },
  { key: 'reverb:predelay', label: 'Reverb Pre', group: 'Reverb', min: 0, max: 0.5 },
  { key: 'reverb:mod', label: 'Reverb Mod', group: 'Reverb', min: 0, max: 1 },
  { key: 'reverb:shimmer', label: 'Shimmer', group: 'Reverb', min: 0, max: 1 },
  { key: 'reverb:quantum', label: 'Quantum', group: 'Reverb', min: 0, max: 1 },
  { key: 'reverb:gravity', label: 'Gravity', group: 'Reverb', min: 0, max: 1 },
];

export const MOD_DEST_BY_KEY = Object.fromEntries(MOD_DESTINATIONS.map((d) => [d.key, d]));
