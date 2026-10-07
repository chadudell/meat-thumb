// Meat Thumb — Quantum Reverb. Port of src/dsp/quantum-reverb.js
//
//   in -> low cut -> pre-delay -> gravity -> [+ shimmer] -> 4-stage diffuser -> 16-line FDN -> wet
//                                      ^                                          |
//                                      +-------- octave-up pitch shifter <--------+
#pragma once
#include "JsMath.h"
#include <algorithm>
#include <vector>

MT_DSP_BEGIN

namespace mt {

struct ReverbParams {
  double mix = 0.3;
  double size = 0.6;
  double decay = 0.55;
  double damp = 0.4;
  double predelay = 0.02;
  double mod = 0.3;
  double shimmer = 0;
  double gravity = 0;
  double quantum = 0.25;
  bool freeze = false;
};

class QuantumReverb {
public:
  static constexpr int N = 16;
  static constexpr int HALF = N / 2;
  static constexpr int SHIMMER_WINDOW = 2048;
  static constexpr int GRAVITY_TAPS = 24;
  static constexpr double GRAVITY_MAX_S = 4;

  ReverbParams params;

  // Metering accumulators (audio thread only; Engine publishes them).
  double energy = 0;
  long energyCount = 0;
  int jumps = 0;

  // May allocate. Rebuilds the (deterministic) room for this sample rate.
  void prepare(double sampleRate, Rng* rngPtr) {
    sr = sampleRate;
    rng = rngPtr;
    Mulberry32 rand(0x6d656174u); // "meat"
    static const double DIFFUSER_MS[4] = {7, 13, 23, 41};

    preSize = nextPow2(static_cast<int>(std::ceil(0.5 * sr)) + 2);
    preMask = preSize - 1;
    preL.assign(preSize, 0.f);
    preR.assign(preSize, 0.f);

    gravSize = nextPow2(static_cast<int>(std::ceil(GRAVITY_MAX_S * sr)) + 2);
    gravMask = gravSize - 1;
    gravL.assign(gravSize, 0.f);
    gravR.assign(gravSize, 0.f);
    for (int k = 0; k < GRAVITY_TAPS; k++) gravJitter[k] = rand() - 0.5;
    double e = 0;
    for (int k = 0; k < GRAVITY_TAPS; k++) {
      gravGain[k] = std::exp(5 * (static_cast<double>(k + 1) / GRAVITY_TAPS - 1));
      e += gravGain[k] * gravGain[k];
    }
    for (int k = 0; k < GRAVITY_TAPS; k++) gravGain[k] /= std::sqrt(e);

    for (int st = 0; st < 4; st++) {
      Diffuser& d = diff[st];
      const double range = (DIFFUSER_MS[st] * sr) / 1000;
      d.size = nextPow2(static_cast<int>(std::ceil(range)) + 1);
      d.mask = d.size - 1;
      for (int i = 0; i < N; i++) {
        const double v = std::floor((range * (i + rand())) / N);
        d.delays[i] = static_cast<int>(std::fmax(1.0, v));
      }
      for (int i = 0; i < N; i++) d.perm[i] = i;
      for (int i = N - 1; i > 0; i--) {
        const int j = static_cast<int>(std::floor(rand() * (i + 1)));
        std::swap(d.perm[i], d.perm[j]);
      }
      for (int i = 0; i < N; i++) d.flip[i] = rand() < 0.5 ? -1.f : 1.f;
      d.buf.assign(static_cast<size_t>(N) * d.size, 0.f);
    }

    fdnSize = nextPow2(static_cast<int>(std::ceil(0.7 * sr)) + 4);
    fdnMask = fdnSize - 1;
    fdnBuf.assign(static_cast<size_t>(N) * fdnSize, 0.f);
    for (int i = 0; i < N; i++) lenRatio[i] = jsPow(2, static_cast<double>(i) / N) * (1 + 0.06 * (rand() - 0.5));

    for (int i = 0; i < N; i++) {
      lfoPhase0[i] = rand();
      lfoRate[i] = 0.07 + rand() * 0.35;
    }

    shSize = SHIMMER_WINDOW * 2;
    shMask = shSize - 1;
    shBuf.assign(shSize, 0.f);

    reset();
  }

  // Back to the freshly-constructed state (room layout is kept).
  void reset() {
    std::fill(preL.begin(), preL.end(), 0.f);
    std::fill(preR.begin(), preR.end(), 0.f);
    std::fill(gravL.begin(), gravL.end(), 0.f);
    std::fill(gravR.begin(), gravR.end(), 0.f);
    for (Diffuser& d : diff) std::fill(d.buf.begin(), d.buf.end(), 0.f);
    std::fill(fdnBuf.begin(), fdnBuf.end(), 0.f);
    std::fill(shBuf.begin(), shBuf.end(), 0.f);
    prePos = 0;
    gravPos = 0;
    diffPos = 0;
    fdnPos = 0;
    shPos = 0;
    shPhase = 0;
    for (int k = 0; k < GRAVITY_TAPS; k++) gravTapL[k] = gravTapR[k] = 0;
    gravTime = 0.25 * sr;
    // JS constructs with the default size (0.6) before any param arrives.
    const double initLen = (0.02 + jsPow(0.6, 1.5) * 0.28) * sr * 1.5;
    for (int i = 0; i < N; i++) {
      curLen[i] = initLen;
      lp[i] = hp[i] = gain[i] = 0;
      lfoPhase[i] = lfoPhase0[i];
      lfoPrev[i] = lfoNext[i] = 0;
      qOff[i] = qTarget[i] = 0;
      qGlide[i] = 0.001;
      x[i] = y[i] = fb[i] = out[i] = 0;
    }
    inHpL = inHpR = 0;
    inGain = 1;
    energy = 0;
    energyCount = 0;
    jumps = 0;
  }

  double baseLen() const { return (0.02 + jsPow(params.size, 1.5) * 0.28) * sr; }

  double rt60() const { return params.freeze ? INFINITY : 0.3 * jsPow(400, params.decay); }

  // JS process() split in two so block-rate work can stay on a fixed 128-sample
  // grid regardless of the host buffer size: beginBlock(frames) is the
  // per-block part, run(..., offset) the per-sample part for samples
  // [offset, offset + n) of that block. process() == beginBlock() + run().
  void process(float* left, float* right, int frames) {
    beginBlock(frames);
    run(left, right, frames, 0);
  }

  void beginBlock(int frames) {
    const ReverbParams& p = params;
    const bool freeze = p.freeze;
    Rng& rnd = *rng;
    blockFrames = frames;

    // --- Per-block coefficients ---
    base = baseLen();
    const double rt = rt60();
    for (int i = 0; i < N; i++) gain[i] = freeze ? 1 : jsPow(10, (-3 * curLen[i]) / (rt * sr));
    const double fc = 18000 * jsPow(600.0 / 18000, p.damp);
    dampC = freeze ? 1 : 1 - std::exp((-2 * kPi * fc) / sr);
    loopHpC = 1 - std::exp((-2 * kPi * 25) / sr);
    inHpC = 1 - std::exp((-2 * kPi * 120) / sr);
    lenGlide = 1 - std::exp(-1 / (0.15 * sr));
    const double modDepth = p.mod * 0.0025 * sr;
    preSamples = static_cast<int>(std::fmin(preSize - 2.0, std::fmax(0.0, jsRound(p.predelay * sr))));
    inTarget = freeze ? 0 : 1;
    shimmerGain = freeze ? 0 : p.shimmer * 0.55;

    const double grav = p.gravity;
    const double gravTarget = (0.25 + (GRAVITY_MAX_S - 0.3) * grav * grav) * sr;
    gravTime += (gravTarget - gravTime) * 0.05;
    const double spacing = gravTime / GRAVITY_TAPS;
    for (int k = 0; k < GRAVITY_TAPS; k++) {
      const double t = (k + 1) * spacing;
      gravTapL[k] = static_cast<int>(std::fmin(gravSize - 2.0, jsRound(t + gravJitter[k] * spacing)));
      gravTapR[k] = static_cast<int>(std::fmin(gravSize - 2.0, jsRound(t - gravJitter[k] * spacing)));
    }
    directGain = std::cos((grav * kPi) / 2);
    swellGain = std::sin((grav * kPi) / 2) * 2;
    dry = std::cos((p.mix * kPi) / 2);
    wet = std::sin((p.mix * kPi) / 2);

    for (int i = 0; i < N; i++) {
      lfoPrev[i] = lfoNext[i];
      lfoPhase[i] = std::fmod(lfoPhase[i] + (lfoRate[i] * frames) / sr, 1.0);
      lfoNext[i] = std::sin(2 * kPi * lfoPhase[i]) * modDepth;
    }

    // Quantum tunnelling events
    const double q = p.quantum;
    if (q > 0) {
      const double prob = q * q * 0.025;
      const double span = q * 0.012 * sr;
      for (int i = 0; i < HALF; i++) {
        if (rnd() < prob) {
          const double t = (rnd() * 2 - 1) * span;
          double glide;
          if (rnd() < 0.2) glide = 0.004 + q * 0.01;
          else glide = 0.0002 + rnd() * 0.001;
          qTarget[i] = t;
          qTarget[i + HALF] = -t;
          qGlide[i] = glide;
          qGlide[i + HALF] = glide;
          jumps++;
        }
      }
    } else {
      for (int i = 0; i < N; i++) qTarget[i] = 0;
    }

  }

  void run(float* left, float* right, int frames, int offset) {
    // --- Per-sample ---
    const double norm = 0.5 / std::sqrt(static_cast<double>(HALF));
    const double shStep = 1.0 / SHIMMER_WINDOW;
    float* fdn = fdnBuf.data();

    for (int s = 0; s < frames; s++) {
      const double frac = static_cast<double>(offset + s + 1) / blockFrames;
      inGain += (inTarget - inGain) * 0.002;

      const double inSL = left[s];
      const double inSR = right[s];
      inHpL += (inSL - inHpL) * inHpC;
      inHpR += (inSR - inHpR) * inHpC;
      const int pw = prePos;
      preL[pw] = static_cast<float>((inSL - inHpL) * inGain);
      preR[pw] = static_cast<float>((inSR - inHpR) * inGain);
      const int pr = (pw - preSamples) & preMask;
      double inL = preL[pr];
      double inR = preR[pr];

      // Gravity
      const int gp = gravPos;
      gravL[gp] = static_cast<float>(inL);
      gravR[gp] = static_cast<float>(inR);
      gravPos = (gp + 1) & gravMask;
      if (swellGain > 0.001) {
        double sl = 0, sr2 = 0;
        for (int k = 0; k < GRAVITY_TAPS; k++) {
          const double g = gravGain[k];
          sl += gravL[(gp - gravTapL[k]) & gravMask] * g;
          sr2 += gravR[(gp - gravTapR[k]) & gravMask] * g;
        }
        inL = inL * directGain + sl * swellGain;
        inR = inR * directGain + sr2 * swellGain;
      }
      prePos = (pw + 1) & preMask;

      // Shimmer
      double sh = 0;
      if (shimmerGain > 0) {
        const double p1 = shPhase;
        const double p2 = std::fmod(p1 + 0.5, 1.0);
        const double d1 = 2 + (1 - p1) * SHIMMER_WINDOW;
        const double d2 = 2 + (1 - p2) * SHIMMER_WINDOW;
        sh = (readShimmer(d1) * std::sin(kPi * p1) + readShimmer(d2) * std::sin(kPi * p2)) * shimmerGain;
        shPhase = std::fmod(p1 + shStep, 1.0);
      }

      for (int i = 0; i < N; i++) x[i] = ((i & 1) ? inR : inL) + sh;

      // Diffuser
      const uint32_t dp = diffPos;
      for (int st = 0; st < 4; st++) {
        Diffuser& d = diff[st];
        const int w = static_cast<int>(dp & static_cast<uint32_t>(d.mask));
        float* buf = d.buf.data();
        for (int i = 0; i < N; i++) {
          const int off = i * d.size;
          buf[off + w] = static_cast<float>(x[i]);
          y[i] = buf[off + ((w - d.delays[i]) & d.mask)];
        }
        for (int i = 0; i < N; i++) x[i] = y[d.perm[i]] * static_cast<double>(d.flip[i]);
        hadamard16(x);
      }
      diffPos = dp + 1;

      // FDN tank
      const int wp = fdnPos;
      double sum = 0;
      for (int i = 0; i < N; i++) {
        curLen[i] += (base * lenRatio[i] - curLen[i]) * lenGlide;
        qOff[i] += (qTarget[i] - qOff[i]) * qGlide[i];
        const double lfo = lfoPrev[i] + (lfoNext[i] - lfoPrev[i]) * frac;
        double delay = curLen[i] + lfo + qOff[i];
        if (delay < 2) delay = 2;
        else if (delay > fdnSize - 2) delay = fdnSize - 2;

        const double rp = wp - delay;
        const double rfl = std::floor(rp);
        const int ri = static_cast<int>(rfl);
        const double rf = rp - rfl;
        const size_t off = static_cast<size_t>(i) * fdnSize;
        const double a = fdn[off + (ri & fdnMask)];
        const double b = fdn[off + ((ri + 1) & fdnMask)];
        double v = a + (b - a) * rf;
        out[i] = v;

        lp[i] += (v - lp[i]) * dampC;
        v = lp[i];
        hp[i] += (v - hp[i]) * loopHpC;
        v = (v - hp[i]) * gain[i];
        fb[i] = v;
        sum += v;
      }
      const double house = (sum * 2) / N;
      for (int i = 0; i < N; i++) fdn[static_cast<size_t>(i) * fdnSize + wp] = static_cast<float>(softLimit(x[i] + fb[i] - house));
      fdnPos = (wp + 1) & fdnMask;

      double wl = 0, wr = 0;
      for (int i = 0; i < N; i += 2) {
        wl += out[i];
        wr += out[i + 1];
      }
      wl *= norm;
      wr *= norm;

      shBuf[shPos] = static_cast<float>((wl + wr) * 0.5);
      shPos = (shPos + 1) & shMask;

      energy += wl * wl + wr * wr;
      energyCount++;

      left[s] = static_cast<float>(inSL * dry + wl * wet);
      right[s] = static_cast<float>(inSR * dry + wr * wet);
    }
  }

private:
  struct Diffuser {
    std::vector<float> buf;
    int size = 0, mask = 0;
    int delays[N] = {};
    int perm[N] = {};
    float flip[N] = {};
  };

  static void hadamard16(double* v) {
    for (int h = 1; h < N; h *= 2) {
      for (int i = 0; i < N; i += h * 2) {
        for (int j = i; j < i + h; j++) {
          const double a = v[j];
          const double b = v[j + h];
          v[j] = a + b;
          v[j + h] = a - b;
        }
      }
    }
    for (int i = 0; i < N; i++) v[i] *= 0.25;
  }

  static double softLimit(double v) {
    if (v > 1) return 1 + std::tanh(v - 1);
    if (v < -1) return -1 - std::tanh(-v - 1);
    return v;
  }

  double readShimmer(double delay) const {
    const double rp = shPos - delay;
    const double rfl = std::floor(rp);
    const int ri = static_cast<int>(rfl);
    const double rf = rp - rfl;
    const double a = shBuf[ri & shMask];
    const double b = shBuf[(ri + 1) & shMask];
    return a + (b - a) * rf;
  }

  double sr = 48000;
  Rng* rng = nullptr;

  int preSize = 0, preMask = 0, prePos = 0;
  std::vector<float> preL, preR;

  int gravSize = 0, gravMask = 0, gravPos = 0;
  std::vector<float> gravL, gravR;
  double gravJitter[GRAVITY_TAPS] = {};
  double gravGain[GRAVITY_TAPS] = {};
  int gravTapL[GRAVITY_TAPS] = {};
  int gravTapR[GRAVITY_TAPS] = {};
  double gravTime = 0;

  Diffuser diff[4];
  uint32_t diffPos = 0;

  int fdnSize = 0, fdnMask = 0, fdnPos = 0;
  std::vector<float> fdnBuf;
  double lenRatio[N] = {};
  double curLen[N] = {};
  double lp[N] = {}, hp[N] = {}, gain[N] = {};

  double lfoPhase0[N] = {};
  double lfoPhase[N] = {}, lfoRate[N] = {}, lfoPrev[N] = {}, lfoNext[N] = {};

  double qOff[N] = {}, qTarget[N] = {}, qGlide[N] = {};

  int shSize = 0, shMask = 0, shPos = 0;
  std::vector<float> shBuf;
  double shPhase = 0;

  double inHpL = 0, inHpR = 0, inGain = 1;

  double x[N] = {}, y[N] = {}, fb[N] = {}, out[N] = {};

  // Per-block constants (beginBlock -> run)
  int blockFrames = 128;
  double base = 0, dampC = 0, loopHpC = 0, inHpC = 0, lenGlide = 0;
  int preSamples = 0;
  double inTarget = 1, shimmerGain = 0, directGain = 1, swellGain = 0, dry = 1, wet = 0;
};

} // namespace mt

MT_DSP_END
