// Meat Thumb — sine wavefolder, ADAA at 2x oversampling. Port of src/dsp/folder.js
//
//   y = sin(pi/2 * (g*x + sym)), averaged over each segment (F = -cos), run at
//   2x and decimated by a 16-tap Blackman-windowed sinc. Dry path is delayed by
//   the same 4-sample latency.
#pragma once
#include "JsMath.h"

MT_DSP_BEGIN

namespace mt {

class Wavefolder {
public:
  static constexpr int OS = 2;
  static constexpr int TAPS = 16;
  static constexpr int LATENCY = 4;
  static constexpr int DRY_SIZE = 8;

  static const double* fir() {
    static const FirTable table;
    return table.h;
  }

  void reset() {
    ch[0].reset();
    ch[1].reset();
  }

  // amount 0..1, sym -1..1. Returns the sample for channel c, LATENCY samples late.
  double process(double x, int chIdx, double amount, double sym) {
    static constexpr double HALF_PI = kPi / 2;
    Channel& c = ch[chIdx];
    c.dry[c.dp] = x;
    const double dryOut = c.dry[(c.dp - LATENCY + DRY_SIZE) % DRY_SIZE];
    c.dp = (c.dp + 1) % DRY_SIZE;

    double* hist = c.hist;
    if (amount <= 0) {
      for (int k = 1; k <= OS; k++) {
        hist[c.hp] = c.prevX + (x - c.prevX) * (static_cast<double>(k) / OS);
        c.hp = (c.hp + 1) % TAPS;
      }
      c.prevU = HALF_PI * (x + sym * 0.8);
      c.prevX = x;
      return dryOut;
    }

    const double g = 1 + amount * 7;
    const double bias = sym * 0.8;
    double u0 = c.prevU;
    for (int k = 1; k <= OS; k++) {
      const double xi = c.prevX + (x - c.prevX) * (static_cast<double>(k) / OS);
      const double u1 = HALF_PI * (g * xi + bias);
      const double du = u1 - u0;
      hist[c.hp] = std::fabs(du) > 1e-6 ? (std::cos(u0) - std::cos(u1)) / du : std::sin(0.5 * (u0 + u1));
      c.hp = (c.hp + 1) % TAPS;
      u0 = u1;
    }
    c.prevU = u0;
    c.prevX = x;

    const double* F = fir();
    double folded = 0;
    for (int i = 0; i < TAPS; i++) folded += hist[(c.hp + i) % TAPS] * F[i];

    const double wet = std::fmin(1.0, amount * 5);
    return dryOut + (folded - dryOut) * wet;
  }

private:
  struct FirTable {
    double h[TAPS];
    FirTable() {
      const double fc = 0.45 / OS;
      double sum = 0;
      for (int i = 0; i < TAPS; i++) {
        const double m = i - (TAPS - 1) / 2.0;
        const double sinc = std::sin(2 * kPi * fc * m) / (kPi * m);
        const double win = 0.42 - 0.5 * std::cos((2 * kPi * i) / (TAPS - 1)) + 0.08 * std::cos((4 * kPi * i) / (TAPS - 1));
        h[i] = sinc * win;
        sum += h[i];
      }
      for (int i = 0; i < TAPS; i++) h[i] /= sum;
    }
  };

  struct Channel {
    double prevX = 0, prevU = 0;
    double hist[TAPS] = {};
    int hp = 0;
    double dry[DRY_SIZE] = {};
    int dp = 0;
    void reset() { // NB: like the JS, hp/dp are not reset
      prevX = 0;
      prevU = 0;
      for (double& v : hist) v = 0;
      for (double& v : dry) v = 0;
    }
  };

  Channel ch[2];
};

} // namespace mt

MT_DSP_END
