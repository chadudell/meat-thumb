// Meat Thumb — modulation sources/destinations. Port of src/dsp/mod-matrix.js
//
// A slot adds  amount x source x (max - min) / 2  to the destination's knob
// value, then clamps to [min, max].
#pragma once
#include "Params.h"

namespace mt {

// Index matches MOD_SOURCES in mod-matrix.js.
enum ModSource { MOD_NONE = 0, MOD_LFO1 = 1, MOD_LFO2 = 2, MOD_QUBIT = 3, MOD_LORENZ = 4, MOD_DICE = 5 };
constexpr int kNumModSources = 6;
inline const char* const kModSourceNames[kNumModSources] = {"\xE2\x80\x94", "LFO 1", "LFO 2", "Qubit", "Lorenz", "Dice"};

// key == the JS "target:name" key (no prefix = synth), same order as MOD_DESTINATIONS.
struct ModDest {
  const char* key;
  const char* label;
  const char* group;
  double min, max;
};

constexpr int kNumModDestinations = 30;
constexpr int kModSlots = 8;

extern const ModDest kModDestinations[];

struct ModSlot {
  int src = 0;   // index into MOD_SOURCES (0 = none)
  int dest = -1; // index into kModDestinations, -1 = none
  double amt = 0;
};

// The Params field each destination drives (same order as kModDestinations).
inline double Params::* const kModDestField[kNumModDestinations] = {
    &Params::pitch,          &Params::pulseWidth,     &Params::fold,          &Params::foldSym,
    &Params::drive,          &Params::subLevel,       &Params::detune,        &Params::blend,
    &Params::width,          &Params::drift,          &Params::cutoff,        &Params::resonance,
    &Params::filterEnvAmt,   &Params::lfoAmt,         &Params::lfoRate,       &Params::volume,
    &Params::delay_mix,      &Params::delay_feedback, &Params::delay_tone,    &Params::delay_wow,
    &Params::delay_timeMs,   &Params::reverb_mix,     &Params::reverb_size,   &Params::reverb_decay,
    &Params::reverb_damp,    &Params::reverb_predelay, &Params::reverb_mod,   &Params::reverb_shimmer,
    &Params::reverb_quantum, &Params::reverb_gravity,
};

// Returns the destination index for a JS key ("cutoff", "delay:mix"), or -1.
int modDestIndex(const char* key);

} // namespace mt
