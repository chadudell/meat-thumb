// Meat Thumb — per-voice stereo filter. Port of src/dsp/filter.js
//
// LP24: zero-delay-feedback (TPT) 4-pole ladder, tanh in the feedback path.
// LP12 / BP / HP: TPT state-variable filter (Simper/Zavalishin form).
#pragma once
#include "JsMath.h"

MT_DSP_BEGIN

namespace mt {

enum FilterMode { FILTER_LP24 = 0, FILTER_LP12 = 1, FILTER_BP = 2, FILTER_HP = 3 };

class VoiceFilter {
public:
  static constexpr double SAT = 0.7;

  void prepare(double sampleRate) {
    sr = sampleRate;
    maxHz = sr * 0.45;
    reset();
  }

  void reset() {
    for (double& v : ladder) v = 0;
    for (double& v : svf) v = 0;
  }

  // Call once per sample (shared by both channels).
  void setup(int m, double hz, double res) {
    mode = m;
    if (hz < 20) hz = 20;
    else if (hz > maxHz) hz = maxHz;
    const double g = std::tan((kPi * hz) / sr);
    if (m == FILTER_LP24) {
      inv1g = 1 / (1 + g);
      G = g * inv1g;
      G4 = G * G * G * G;
      k = res * 4.1;
      comp = 1 + k * 0.45;
    } else {
      k = 2 - 1.96 * res;
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
  }

  double process(double x, int ch) { return mode == FILTER_LP24 ? processLadder(x, ch) : processSvf(x, ch); }

private:
  double processLadder(double x, int ch) {
    double* s = ladder;
    const int o = ch * 4;
    const double g1 = inv1g;
    const double input = x * comp;

    const double sigma = G * G * G * s[o] * g1 + G * G * s[o + 1] * g1 + G * s[o + 2] * g1 + s[o + 3] * g1;
    const double y4 = (G4 * input + sigma) / (1 + k * G4);
    const double u = std::tanh((input - k * y4) * SAT) / SAT;

    double v = (u - s[o]) * G;
    const double y1 = v + s[o];
    s[o] = y1 + v;
    v = (y1 - s[o + 1]) * G;
    const double y2 = v + s[o + 1];
    s[o + 1] = y2 + v;
    v = (y2 - s[o + 2]) * G;
    const double y3 = v + s[o + 2];
    s[o + 2] = y3 + v;
    v = (y3 - s[o + 3]) * G;
    const double y = v + s[o + 3];
    s[o + 3] = y + v;
    return y;
  }

  double processSvf(double x, int ch) {
    double* s = svf;
    const int i = ch * 2;
    const double ic1 = s[i];
    const double ic2 = s[i + 1];
    const double v3 = x - ic2;
    const double v1 = a1 * ic1 + a2 * v3;
    const double v2 = ic2 + a2 * ic1 + a3 * v3;
    s[i] = 2 * v1 - ic1;
    s[i + 1] = 2 * v2 - ic2;
    switch (mode) {
      case FILTER_LP12:
        return v2;
      case FILTER_BP:
        return std::sqrt(k) * v1;
      default:
        return x - k * v1 - v2;
    }
  }

  double sr = 48000, maxHz = 48000 * 0.45;
  double ladder[8] = {}; // 4 stages x L/R
  double svf[4] = {};    // ic1, ic2 x L/R
  int mode = FILTER_LP24;
  double G = 0, G4 = 0, inv1g = 1, k = 0, comp = 1, a1 = 0, a2 = 0, a3 = 0;
};

} // namespace mt

MT_DSP_END
