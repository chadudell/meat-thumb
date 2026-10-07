// Meat Thumb — ADSR envelope (linear attack, exponential decay/release)
// Port of src/dsp/envelope.js
#pragma once
#include "JsMath.h"

MT_DSP_BEGIN

namespace mt {

enum EnvStage { ENV_IDLE = 0, ENV_ATTACK = 1, ENV_DECAY = 2, ENV_SUSTAIN = 3, ENV_RELEASE = 4 };

struct EnvCoefs {
  double attackStep, decayCoef, sustain, releaseCoef;
};

inline EnvCoefs envCoefs(double attack, double decay, double sustain, double release, double sr) {
  EnvCoefs c;
  c.attackStep = 1 / std::fmax(1.0, attack * sr);
  c.decayCoef = std::exp(-1 / std::fmax(1.0, decay * sr * 0.25));
  c.sustain = sustain;
  c.releaseCoef = std::exp(-1 / std::fmax(1.0, release * sr * 0.25));
  return c;
}

class Envelope {
public:
  double value = 0;
  int stage = ENV_IDLE;

  bool active() const { return stage != ENV_IDLE; }
  void noteOn() { stage = ENV_ATTACK; }
  void noteOff() {
    if (stage != ENV_IDLE) stage = ENV_RELEASE;
  }
  void reset() {
    value = 0;
    stage = ENV_IDLE;
  }

  double next(const EnvCoefs& c) {
    switch (stage) {
      case ENV_ATTACK:
        value += c.attackStep;
        if (value >= 1) {
          value = 1;
          stage = ENV_DECAY;
        }
        break;
      case ENV_DECAY:
        value = c.sustain + (value - c.sustain) * c.decayCoef;
        if (value - c.sustain < 1e-4) stage = ENV_SUSTAIN;
        break;
      case ENV_SUSTAIN:
        value = c.sustain;
        break;
      case ENV_RELEASE:
        value *= c.releaseCoef;
        if (value < 1e-5) {
          value = 0;
          stage = ENV_IDLE;
        }
        break;
      default:
        break;
    }
    return value;
  }
};

} // namespace mt

MT_DSP_END
