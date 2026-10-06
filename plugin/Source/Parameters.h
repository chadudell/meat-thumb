// Meat Thumb AU — the host-automatable parameters.
//
// One row per UI control. `key` is exactly what the web UI uses ("cutoff",
// "delay:mix", "reverb:freeze"), so UI messages map straight onto host
// parameters; the AU parameter ID is the key with ':' → '_'. Ranges and
// defaults match KNOBS in src/main.js and the engine defaults.
#pragma once

#include "dsp/Params.h"

#include <juce_core/juce_core.h>

#include <initializer_list>
#include <vector>

namespace mt::plugin {

enum class Kind { Float, Int, Bool, Choice };

struct ParamDef {
  const char* key;
  const char* name;
  Kind kind;
  double min, max, def;
  std::vector<const char*> choices = {};  // Choice: labels
  std::vector<double> values = {};        // Choice: engine value per label (default: index)
  void (*apply)(Params&, double) = nullptr;
};

#define MT_F(field) [](Params& p, double v) { p.field = v; }
#define MT_N(field) [](Params& p, double v) { p.field = static_cast<int>(v); }
#define MT_B(field) [](Params& p, double v) { p.field = v != 0; }

inline const std::vector<ParamDef>& paramDefs() {
  static const std::vector<ParamDef> defs = {
      // Oscillator
      {"wave", "Wave", Kind::Choice, 0, 2, 0, {"Saw", "Pulse", "Tri"}, {}, MT_N(wave)},
      {"pulseWidth", "Pulse Width", Kind::Float, 0.05, 0.95, 0.5, {}, {}, MT_F(pulseWidth)},
      {"octave", "Octave", Kind::Int, -2, 2, 0, {}, {}, MT_N(octave)},
      {"fine", "Fine", Kind::Int, -100, 100, 0, {}, {}, MT_F(fine)},
      {"drive", "Drive", Kind::Float, 0, 1, 0.35, {}, {}, MT_F(drive)},
      {"fold", "Fold", Kind::Float, 0, 1, 0, {}, {}, MT_F(fold)},
      {"foldSym", "Fold Sym", Kind::Float, -1, 1, 0, {}, {}, MT_F(foldSym)},
      // Unison
      {"unison", "Unison Voices", Kind::Int, 1, 9, 7, {}, {}, MT_N(unison)},
      {"detune", "Detune", Kind::Float, 0, 1, 0.35, {}, {}, MT_F(detune)},
      {"blend", "Blend", Kind::Float, 0, 1, 0.6, {}, {}, MT_F(blend)},
      {"width", "Width", Kind::Float, 0, 1, 0.8, {}, {}, MT_F(width)},
      {"drift", "Drift", Kind::Float, 0, 1, 0.3, {}, {}, MT_F(drift)},
      {"randomPhase", "Random Phase", Kind::Bool, 0, 1, 1, {}, {}, MT_B(randomPhase)},
      // Sub
      {"subType", "Sub Wave", Kind::Choice, 0, 2, 1, {"Off", "Sine", "Square"}, {}, MT_N(subType)},
      {"subOctave", "Sub Octave", Kind::Choice, 0, 1, -1, {"-1", "-2"}, {-1, -2}, MT_N(subOctave)},
      {"subLevel", "Sub Level", Kind::Float, 0, 1, 0.4, {}, {}, MT_F(subLevel)},
      // Amp
      {"attack", "Attack", Kind::Float, 0.001, 2, 0.005, {}, {}, MT_F(attack)},
      {"decay", "Decay", Kind::Float, 0.01, 3, 0.3, {}, {}, MT_F(decay)},
      {"sustain", "Sustain", Kind::Float, 0, 1, 0.85, {}, {}, MT_F(sustain)},
      {"release", "Release", Kind::Float, 0.01, 4, 0.25, {}, {}, MT_F(release)},
      {"volume", "Volume", Kind::Float, 0, 1, 0.7, {}, {}, MT_F(volume)},
      // Filter
      {"filterMode", "Filter Mode", Kind::Choice, 0, 3, 0, {"LP24", "LP12", "BP", "HP"}, {}, MT_N(filterMode)},
      {"cutoff", "Cutoff", Kind::Float, 0, 1, 0.7, {}, {}, MT_F(cutoff)},
      {"resonance", "Resonance", Kind::Float, 0, 1, 0.2, {}, {}, MT_F(resonance)},
      {"filterEnvAmt", "Filter Env", Kind::Float, -1, 1, 0.25, {}, {}, MT_F(filterEnvAmt)},
      {"keyTrack", "Key Track", Kind::Float, 0, 1, 0.5, {}, {}, MT_F(keyTrack)},
      {"fAttack", "Filter Attack", Kind::Float, 0.001, 2, 0.005, {}, {}, MT_F(fAttack)},
      {"fDecay", "Filter Decay", Kind::Float, 0.01, 3, 0.4, {}, {}, MT_F(fDecay)},
      {"fSustain", "Filter Sustain", Kind::Float, 0, 1, 0.3, {}, {}, MT_F(fSustain)},
      {"fRelease", "Filter Release", Kind::Float, 0.01, 4, 0.3, {}, {}, MT_F(fRelease)},
      // LFO 1
      {"lfoShape", "LFO Shape", Kind::Choice, 0, 4, 0, {"Sine", "Tri", "Saw", "Square", "S&H"}, {}, MT_N(lfoShape)},
      {"lfoRate", "LFO Rate", Kind::Float, 0.05, 30, 2, {}, {}, MT_F(lfoRate)},
      {"lfoDiv", "LFO Division", Kind::Int, 0, 12, 8, {}, {}, MT_N(lfoDiv)},
      {"lfoAmt", "LFO Amount", Kind::Float, -1, 1, 0, {}, {}, MT_F(lfoAmt)},
      {"lfoSync", "LFO Sync", Kind::Bool, 0, 1, 0, {}, {}, MT_B(lfoSync)},
      {"lfoRetrig", "LFO Retrigger", Kind::Bool, 0, 1, 0, {}, {}, MT_B(lfoRetrig)},
      // Mod sources
      {"lfo2Shape", "LFO 2 Shape", Kind::Choice, 0, 4, 1, {"Sine", "Tri", "Saw", "Square", "S&H"}, {}, MT_N(lfo2Shape)},
      {"lfo2Rate", "LFO 2 Rate", Kind::Float, 0.02, 20, 0.3, {}, {}, MT_F(lfo2Rate)},
      {"lfo2Div", "LFO 2 Division", Kind::Int, 0, 12, 2, {}, {}, MT_N(lfo2Div)},
      {"lfo2Sync", "LFO 2 Sync", Kind::Bool, 0, 1, 0, {}, {}, MT_B(lfo2Sync)},
      {"qubitRate", "Qubit Rabi", Kind::Float, 0, 1, 0.5, {}, {}, MT_F(qubitRate)},
      {"qubitMeasure", "Qubit Measure", Kind::Float, 0, 1, 0.25, {}, {}, MT_F(qubitMeasure)},
      {"qubitTilt", "Qubit Tilt", Kind::Float, 0, 1, 0.8, {}, {}, MT_F(qubitTilt)},
      {"lorenzSpeed", "Lorenz Speed", Kind::Float, 0, 1, 0.35, {}, {}, MT_F(lorenzSpeed)},
      {"diceSlew", "Dice Slew", Kind::Float, 0, 1, 0.15, {}, {}, MT_F(diceSlew)},
      // Delay
      {"delay:mode", "Delay Mode", Kind::Choice, 0, 1, 1, {"Stereo", "Ping-Pong"}, {}, MT_N(delay_mode)},
      {"delay:sync", "Delay Sync", Kind::Bool, 0, 1, 1, {}, {}, MT_B(delay_sync)},
      {"delay:timeMs", "Delay Time", Kind::Float, 10, 2000, 350, {}, {}, MT_F(delay_timeMs)},
      {"delay:div", "Delay Division", Kind::Int, 0, 11, 5, {}, {}, MT_N(delay_div)},
      {"delay:feedback", "Delay Feedback", Kind::Float, 0, 1.1, 0.4, {}, {}, MT_F(delay_feedback)},
      {"delay:tone", "Delay Tone", Kind::Float, 0, 1, 0.6, {}, {}, MT_F(delay_tone)},
      {"delay:wow", "Delay Wow", Kind::Float, 0, 1, 0.15, {}, {}, MT_F(delay_wow)},
      {"delay:duck", "Delay Duck", Kind::Float, 0, 1, 0.3, {}, {}, MT_F(delay_duck)},
      {"delay:mix", "Delay Mix", Kind::Float, 0, 1, 0.2, {}, {}, MT_F(delay_mix)},
      // Quantum reverb
      {"reverb:mix", "Reverb Mix", Kind::Float, 0, 1, 0.3, {}, {}, MT_F(reverb_mix)},
      {"reverb:size", "Reverb Size", Kind::Float, 0, 1, 0.6, {}, {}, MT_F(reverb_size)},
      {"reverb:decay", "Reverb Decay", Kind::Float, 0, 1, 0.55, {}, {}, MT_F(reverb_decay)},
      {"reverb:damp", "Reverb Damp", Kind::Float, 0, 1, 0.4, {}, {}, MT_F(reverb_damp)},
      {"reverb:predelay", "Reverb Pre-delay", Kind::Float, 0, 0.5, 0.02, {}, {}, MT_F(reverb_predelay)},
      {"reverb:mod", "Reverb Mod", Kind::Float, 0, 1, 0.3, {}, {}, MT_F(reverb_mod)},
      {"reverb:shimmer", "Shimmer", Kind::Float, 0, 1, 0, {}, {}, MT_F(reverb_shimmer)},
      {"reverb:quantum", "Quantum", Kind::Float, 0, 1, 0.25, {}, {}, MT_F(reverb_quantum)},
      {"reverb:gravity", "Gravity", Kind::Float, 0, 1, 0, {}, {}, MT_F(reverb_gravity)},
      {"reverb:freeze", "Freeze", Kind::Bool, 0, 1, 0, {}, {}, MT_B(reverb_freeze)},
      // Sequencer (plugin only): start/stop with the DAW's transport.
      {"seqHostSync", "Seq Follows Host", Kind::Bool, 0, 1, 1, {}, {}, nullptr},
  };
  return defs;
}

#undef MT_F
#undef MT_N
#undef MT_B

// UI value (what the web UI sends/shows) ↔ choice index.
inline int choiceIndexForValue(const ParamDef& d, double v) {
  if (d.values.empty()) return static_cast<int>(v + 0.5);
  for (size_t i = 0; i < d.values.size(); i++)
    if (d.values[i] == v) return static_cast<int>(i);
  return 0;
}
inline double valueForChoiceIndex(const ParamDef& d, int i) {
  return d.values.empty() ? i : d.values[static_cast<size_t>(i)];
}

inline juce::String paramId(const ParamDef& d) { return juce::String(d.key).replaceCharacter(':', '_'); }

} // namespace mt::plugin
