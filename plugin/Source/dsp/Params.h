// Meat Thumb — engine parameters (base, un-modulated knob values).
// Field names == JS param names; delay/reverb params are prefixed delay_/reverb_.
// Defaults == JS defaults (meat-thumb-processor.js, tempo-delay.js, quantum-reverb.js).
#pragma once

#include <cstring>

namespace mt {

struct Params {
  // --- synth (meat-thumb-processor.js this.params) ---
  int wave = 0; // 0 saw, 1 pulse, 2 triangle
  double pulseWidth = 0.5;
  int unison = 7;
  double detune = 0.35;
  double blend = 0.6;
  double width = 0.8;
  double drift = 0.3;
  bool randomPhase = true;
  int octave = 0;
  double fine = 0; // cents
  int subType = 1; // 0 off, 1 sine, 2 square
  int subOctave = -1;
  double subLevel = 0.4;
  double drive = 0.35;
  double attack = 0.005;
  double decay = 0.3;
  double sustain = 0.85;
  double release = 0.25;
  double volume = 0.7;
  int filterMode = 0; // 0 LP24, 1 LP12, 2 BP, 3 HP
  double cutoff = 0.7;
  double resonance = 0.2;
  double filterEnvAmt = 0.25;
  double keyTrack = 0.5;
  double fAttack = 0.005;
  double fDecay = 0.4;
  double fSustain = 0.3;
  double fRelease = 0.3;
  int lfoShape = 0;
  double lfoRate = 2;
  bool lfoSync = false;
  int lfoDiv = 8;
  double lfoAmt = 0;
  bool lfoRetrig = false;
  double fold = 0;
  double foldSym = 0;
  double pitch = 0;
  int lfo2Shape = 1;
  double lfo2Rate = 0.3;
  bool lfo2Sync = false;
  int lfo2Div = 2;
  double qubitRate = 0.5;
  double qubitMeasure = 0.25;
  double qubitTilt = 0.8;
  double lorenzSpeed = 0.35;
  double diceSlew = 0.15;

  // --- delay (tempo-delay.js params) ---
  double delay_mix = 0.2;
  bool delay_sync = true;
  int delay_div = 5;
  double delay_timeMs = 350;
  double delay_feedback = 0.4;
  int delay_mode = 1; // 0 stereo, 1 ping-pong
  double delay_tone = 0.6;
  double delay_wow = 0.15;
  double delay_duck = 0.3;

  // --- reverb (quantum-reverb.js params) ---
  double reverb_mix = 0.3;
  double reverb_size = 0.6;
  double reverb_decay = 0.55;
  double reverb_damp = 0.4;
  double reverb_predelay = 0.02;
  double reverb_mod = 0.3;
  double reverb_shimmer = 0;
  double reverb_gravity = 0;
  double reverb_quantum = 0.25;
  bool reverb_freeze = false;
};

// Set a parameter by its JS key ("cutoff", "delay:mix", "reverb:freeze", ...;
// the C++ spelling "delay_mix" is accepted too). Ints/bools are converted the
// way the JS uses them (ints truncate, bools are value != 0).
// Returns false for unknown keys. Not real-time critical (string compares),
// but allocation-free.
inline bool setParamByKey(Params& p, const char* key, double v) {
  char k[48];
  size_t n = std::strlen(key);
  if (n >= sizeof(k)) return false;
  std::memcpy(k, key, n + 1);
  for (size_t i = 0; i < n; i++)
    if (k[i] == ':') k[i] = '_';
#define MT_D(name)                     \
  if (!std::strcmp(k, #name)) {        \
    p.name = v;                        \
    return true;                       \
  }
#define MT_I(name)                     \
  if (!std::strcmp(k, #name)) {        \
    p.name = static_cast<int>(v);      \
    return true;                       \
  }
#define MT_B(name)                     \
  if (!std::strcmp(k, #name)) {        \
    p.name = v != 0;                   \
    return true;                       \
  }
  MT_I(wave) MT_D(pulseWidth) MT_I(unison) MT_D(detune) MT_D(blend) MT_D(width) MT_D(drift) MT_B(randomPhase)
  MT_I(octave) MT_D(fine) MT_I(subType) MT_I(subOctave) MT_D(subLevel) MT_D(drive) MT_D(attack) MT_D(decay)
  MT_D(sustain) MT_D(release) MT_D(volume) MT_I(filterMode) MT_D(cutoff) MT_D(resonance) MT_D(filterEnvAmt)
  MT_D(keyTrack) MT_D(fAttack) MT_D(fDecay) MT_D(fSustain) MT_D(fRelease) MT_I(lfoShape) MT_D(lfoRate)
  MT_B(lfoSync) MT_I(lfoDiv) MT_D(lfoAmt) MT_B(lfoRetrig) MT_D(fold) MT_D(foldSym) MT_D(pitch) MT_I(lfo2Shape)
  MT_D(lfo2Rate) MT_B(lfo2Sync) MT_I(lfo2Div) MT_D(qubitRate) MT_D(qubitMeasure) MT_D(qubitTilt)
  MT_D(lorenzSpeed) MT_D(diceSlew)
  MT_D(delay_mix) MT_B(delay_sync) MT_I(delay_div) MT_D(delay_timeMs) MT_D(delay_feedback) MT_I(delay_mode)
  MT_D(delay_tone) MT_D(delay_wow) MT_D(delay_duck)
  MT_D(reverb_mix) MT_D(reverb_size) MT_D(reverb_decay) MT_D(reverb_damp) MT_D(reverb_predelay) MT_D(reverb_mod)
  MT_D(reverb_shimmer) MT_D(reverb_gravity) MT_D(reverb_quantum) MT_B(reverb_freeze)
#undef MT_D
#undef MT_I
#undef MT_B
  return false;
}

} // namespace mt
