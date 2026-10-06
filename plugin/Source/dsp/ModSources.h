// Meat Thumb — exotic modulation sources. Port of src/dsp/mod-sources.js
//
// Qubit:  Bloch-sphere spin precessing about a tilted axis, randomly measured
//         along z (Born rule). Output <sigma_z> = z. Quantum Zeno at high rates.
// Lorenz: Lorenz attractor (sigma=10, rho=28, beta=8/3), RK2. Output x/20.
// Dice:   new random target on every sequencer step / note-on, with slew.
#pragma once
#include "JsMath.h"

MT_DSP_BEGIN

namespace mt {

inline double qubitRateHz(double v) { return 0.02 * jsPow(500, v); }
inline double qubitMeasureHz(double v) { return 200 * v * v * v; }

class Qubit {
public:
  double x = 0, y = 0, z = 1;
  int collapses = 0;

  void advance(double dt, double rate, double measureRate, double tilt, Rng& rng) {
    const double theta = tilt * (kPi / 2);
    const double nx = std::sin(theta);
    const double nz = std::cos(theta);
    const double a = 2 * kPi * rate * dt;
    const double c = std::cos(a);
    const double s = std::sin(a);
    const double X = x, Y = y, Z = z;
    const double dot = nx * X + nz * Z;
    double x2 = X * c + -nz * Y * s + nx * dot * (1 - c);
    double y2 = Y * c + (nz * X - nx * Z) * s;
    double z2 = Z * c + nx * Y * s + nz * dot * (1 - c);
    double len = jsHypot3(x2, y2, z2);
    if (len == 0 || std::isnan(len)) len = 1; // `|| 1`
    x2 /= len;
    y2 /= len;
    z2 /= len;

    if (measureRate > 0 && rng() < 1 - std::exp(-measureRate * dt)) {
      const bool up = rng() < (1 + z2) / 2;
      x2 = 0;
      y2 = 0;
      z2 = up ? 1 : -1;
      collapses++;
    }
    x = x2;
    y = y2;
    z = z2;
  }

  double value() const { return z; }
};

class Lorenz {
public:
  double x = 0.1, y = 0, z = 20;

  // speed 0..1 -> 0.05..3 attractor time units per second.
  void advance(double dt, double speed) {
    const double h = dt * (0.05 + 2.95 * speed * speed);
    const double stepsD = std::fmax(1.0, std::ceil(h / 0.004));
    const int steps = static_cast<int>(stepsD);
    const double k = h / stepsD;
    double X = x, Y = y, Z = z;
    for (int i = 0; i < steps; i++) {
      const double dx1 = 10 * (Y - X);
      const double dy1 = X * (28 - Z) - Y;
      const double dz1 = X * Y - (8.0 / 3) * Z;
      const double xm = X + 0.5 * k * dx1;
      const double ym = Y + 0.5 * k * dy1;
      const double zm = Z + 0.5 * k * dz1;
      X += k * 10 * (ym - xm);
      Y += k * (xm * (28 - zm) - ym);
      Z += k * (xm * ym - (8.0 / 3) * zm);
    }
    x = X;
    y = Y;
    z = Z;
  }

  double value() const { return std::fmax(-1.0, std::fmin(1.0, x / 20)); }
};

class Dice {
public:
  double target = 0, out = 0;

  void roll(Rng& rng) { target = rng() * 2 - 1; }

  // slew 0..1 -> 0..0.5s time constant
  void advance(double dt, double slew) {
    const double tau = slew * slew * 0.5;
    out = tau <= 0.0005 ? target : out + (target - out) * (1 - std::exp(-dt / tau));
  }

  double value() const { return out; }
};

} // namespace mt

MT_DSP_END
