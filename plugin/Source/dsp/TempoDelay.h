// Meat Thumb — tempo delay. Port of src/dsp/tempo-delay.js
//
// Stereo or ping-pong, synced to BPM (or free in ms). Tape-ish glide, wow +
// flutter, darkening loop filter, soft-saturated feedback (can exceed 100%),
// and ducking.
#pragma once
#include "JsMath.h"
#include <algorithm>
#include <vector>

MT_DSP_BEGIN

namespace mt {

enum DelayMode { DELAY_STEREO = 0, DELAY_PINGPONG = 1 };

struct DelayDivision {
  const char* label;
  double beats;
};

inline const DelayDivision kDelayDivisions[] = {
    {"1/1", 4},     {"1/2", 2},    {"1/4.", 1.5},    {"1/4", 1},       {"1/4T", 2.0 / 3}, {"1/8.", 0.75},
    {"1/8", 0.5},   {"1/8T", 1.0 / 3}, {"1/16.", 0.375}, {"1/16", 0.25}, {"1/16T", 1.0 / 6}, {"1/32", 0.125},
};
constexpr int kNumDelayDivisions = 12;

struct DelayParams {
  double mix = 0.2;
  bool sync = true;
  int div = 5;
  double timeMs = 350;
  double feedback = 0.4;
  int mode = DELAY_PINGPONG;
  double tone = 0.6;
  double wow = 0.15;
  double duck = 0.3;
};

class TempoDelay {
public:
  static constexpr double MAX_SECONDS = 6.1;
  DelayParams params;

  // May allocate.
  void prepare(double sampleRate, Rng* rngPtr) {
    sr = sampleRate;
    rng = rngPtr;
    size = nextPow2(static_cast<int>(std::ceil(MAX_SECONDS * sr)) + 8);
    mask = size - 1;
    bufL.assign(size, 0.f);
    bufR.assign(size, 0.f);
    reset();
  }

  void reset() {
    std::fill(bufL.begin(), bufL.end(), 0.f);
    std::fill(bufR.begin(), bufR.end(), 0.f);
    pos = 0;
    cur = 0.375 * sr;
    lpL = lpR = hpL = hpR = 0;
    wowPhase = flutterPhase = 0;
    drift = driftTarget = 0;
    duckEnv = 0;
    blockActive = false;
  }

  double targetSamples(double bpm) const {
    const DelayParams& p = params;
    int div = p.div < 0 ? 0 : (p.div >= kNumDelayDivisions ? kNumDelayDivisions - 1 : p.div);
    const double seconds = p.sync ? (kDelayDivisions[div].beats * 60) / bpm : p.timeMs / 1000;
    return std::fmin(static_cast<double>(size - 8), std::fmax(4.0, seconds * sr));
  }

  // JS process() split in two so block-rate work can stay on a fixed 128-sample
  // grid regardless of the host buffer size: beginBlock() does the per-block
  // part (once per 128-frame block), run() the per-sample part (may be called
  // several times per block). process() == beginBlock() + run().
  void process(float* left, float* right, int frames, double bpm) {
    beginBlock(bpm);
    run(left, right, frames);
  }

  void beginBlock(double bpm) {
    const DelayParams& p = params;
    blockActive = !(p.mix <= 0 && p.feedback <= 0);
    if (!blockActive) return;
    k.target = targetSamples(bpm);
    k.glide = 1 - std::exp(-1 / (0.08 * sr));
    k.lpC = 1 - std::exp((-2 * kPi * 500 * jsPow(40, p.tone)) / sr);
    k.hpC = 1 - std::exp((-2 * kPi * 90) / sr);
    k.fb = p.feedback;
    k.wowDepth = p.wow * 0.003 * sr;
    k.wowInc = 0.45 / sr;
    k.flutterInc = 6.5 / sr;
    k.duckAtk = 1 - std::exp(-1 / (0.002 * sr));
    k.duckRel = 1 - std::exp(-1 / (0.25 * sr));
    k.pingpong = p.mode == DELAY_PINGPONG;
    k.mix = p.mix;
    k.duck = p.duck;
    if ((*rng)() < 0.01) driftTarget = (*rng)() * 2 - 1;
  }

  void run(float* left, float* right, int frames) {
    if (!blockActive) return;
    const double target = k.target, glide = k.glide, lpC = k.lpC, hpC = k.hpC, fb = k.fb;
    const double wowDepth = k.wowDepth, wowInc = k.wowInc, flutterInc = k.flutterInc;
    const double duckAtk = k.duckAtk, duckRel = k.duckRel;
    const bool pingpong = k.pingpong;
    float* bL = bufL.data();
    float* bR = bufR.data();

    for (int s = 0; s < frames; s++) {
      const double inL = left[s];
      const double inR = right[s];

      cur += (target - cur) * glide;
      drift += (driftTarget - drift) * 0.00005;
      wowPhase = std::fmod(wowPhase + wowInc, 1.0);
      flutterPhase = std::fmod(flutterPhase + flutterInc, 1.0);
      const double mod =
          wowDepth * (0.6 * std::sin(2 * kPi * wowPhase) + 0.3 * drift + 0.1 * std::sin(2 * kPi * flutterPhase));
      const double d = std::fmax(3.0, cur + mod);

      const double rp = pos - d;
      const double yL = hermite(bL, rp);
      const double yR = hermite(bR, rp);

      lpL += (yL - lpL) * lpC;
      lpR += (yR - lpR) * lpC;
      hpL += (lpL - hpL) * hpC;
      hpR += (lpR - hpR) * hpC;
      const double fL = (lpL - hpL) * fb;
      const double fR = (lpR - hpR) * fb;

      if (pingpong) {
        bL[pos] = static_cast<float>(tapeSat((inL + inR) * 0.5 + fR));
        bR[pos] = static_cast<float>(tapeSat(fL));
      } else {
        bL[pos] = static_cast<float>(tapeSat(inL + fL));
        bR[pos] = static_cast<float>(tapeSat(inR + fR));
      }
      pos = (pos + 1) & mask;

      const double level = std::fmax(std::fabs(inL), std::fabs(inR));
      duckEnv += (level - duckEnv) * (level > duckEnv ? duckAtk : duckRel);
      const double wet = k.mix * (1 - k.duck * std::fmin(1.0, duckEnv * 3));

      left[s] = static_cast<float>(inL + yL * wet);
      right[s] = static_cast<float>(inR + yR * wet);
    }
  }

private:
  // 4-point Hermite interpolation.
  double hermite(const float* buf, double rpos) const {
    const double fi = std::floor(rpos);
    const int i = static_cast<int>(fi);
    const double f = rpos - fi;
    const double xm1 = buf[(i - 1) & mask];
    const double x0 = buf[i & mask];
    const double x1 = buf[(i + 1) & mask];
    const double x2 = buf[(i + 2) & mask];
    const double c = (x1 - xm1) * 0.5;
    const double v = x0 - x1;
    const double w = c + v;
    const double a = w + v + (x2 - x0) * 0.5;
    const double b = w + a;
    return ((a * f - b) * f + c) * f + x0;
  }

  // Linear below |0.7|, then bends smoothly toward |1.2|.
  static double tapeSat(double x) {
    const double a = std::fabs(x);
    if (a <= 0.7) return x;
    return jsSign(x) * (0.7 + 0.5 * std::tanh((a - 0.7) / 0.5));
  }

  struct BlockConsts {
    double target = 0, glide = 0, lpC = 0, hpC = 0, fb = 0, wowDepth = 0, wowInc = 0, flutterInc = 0;
    double duckAtk = 0, duckRel = 0, mix = 0, duck = 0;
    bool pingpong = false;
  } k;
  bool blockActive = false;

  double sr = 48000;
  Rng* rng = nullptr;
  int size = 0, mask = 0;
  std::vector<float> bufL, bufR;
  int pos = 0;
  double cur = 0;
  double lpL = 0, lpR = 0, hpL = 0, hpR = 0;
  double wowPhase = 0, flutterPhase = 0;
  double drift = 0, driftTarget = 0;
  double duckEnv = 0;
};

} // namespace mt

MT_DSP_END
