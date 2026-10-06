// Meat Thumb — LFO (free Hz or tempo-synced). Port of src/dsp/lfo.js
#pragma once
#include "JsMath.h"

MT_DSP_BEGIN

namespace mt {

enum LfoShape { LFO_SINE = 0, LFO_TRI = 1, LFO_SAW = 2, LFO_SQUARE = 3, LFO_SH = 4 };

struct LfoDivision {
  const char* label;
  double beats;
};

// Sync divisions, in beats (quarter notes) per cycle.
inline const LfoDivision kLfoDivisions[] = {
    {"4 bar", 16}, {"2 bar", 8},       {"1 bar", 4},  {"1/2", 2},     {"1/4.", 1.5},
    {"1/4", 1},    {"1/4T", 2.0 / 3},  {"1/8.", 0.75}, {"1/8", 0.5},  {"1/8T", 1.0 / 3},
    {"1/16", 0.25}, {"1/16T", 1.0 / 6}, {"1/32", 0.125},
};
constexpr int kNumLfoDivisions = 13;

inline double lfoDivBeats(int div) {
  if (div < 0) div = 0;
  if (div >= kNumLfoDivisions) div = kNumLfoDivisions - 1;
  return kLfoDivisions[div].beats;
}

class Lfo {
public:
  double phase = 0;
  double held = 0;
  double out = 0;
  double smooth = 0;
  double value = 0; // last output, for metering / mod matrix

  void prepare(double sampleRate, Rng* rngPtr) {
    sr = sampleRate;
    rng = rngPtr;
    phase = 0;
    held = (*rng)() * 2 - 1;
    out = 0;
    value = 0;
    smooth = 1 - std::exp((-2 * kPi * 250) / sr);
  }

  void reset() {
    phase = 0;
    held = (*rng)() * 2 - 1;
  }

  void render(double* buf, int start, int end, double hz, int shape) {
    const double inc = hz / sr;
    double ph = phase;
    double o = out;
    for (int s = start; s < end; s++) {
      double raw;
      switch (shape) {
        case LFO_TRI:
          raw = 1 - 4 * std::fabs(ph - 0.5);
          break;
        case LFO_SAW:
          raw = 1 - 2 * ph;
          break;
        case LFO_SQUARE:
          raw = ph < 0.5 ? 1 : -1;
          break;
        case LFO_SH:
          raw = held;
          break;
        default:
          raw = std::sin(2 * kPi * ph);
      }
      o += (raw - o) * smooth;
      buf[s] = o;
      ph += inc;
      if (ph >= 1) {
        ph -= 1;
        held = (*rng)() * 2 - 1;
      }
    }
    phase = ph;
    out = o;
    value = o;
  }

private:
  double sr = 48000;
  Rng* rng = nullptr;
};

} // namespace mt

MT_DSP_END
