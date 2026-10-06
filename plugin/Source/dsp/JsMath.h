// Meat Thumb DSP (C++ port) — JS-compatible math helpers.
//
// The engine is a line-by-line port of src/dsp/*.js. To keep it bit-close to
// the browser version these helpers reproduce the exact JS semantics where they
// differ from the C/C++ standard library:
//   - Math.round  (round half toward +inf, not away from zero)
//   - Math.pow    (JavaScriptCore uses repeated squaring for small non-negative
//                  integer exponents)
//   - Math.hypot  (JavaScriptCore's scaled Kahan sum)
//   - mulberry32  (uint32 semantics of Math.imul and >>>)
// Math.random is replaced by a fast xorshift PRNG (Rng) — only the reverb
// room layout needs to be reproducible, and that uses mulberry32.
//
// FP contraction (a*b+c -> fma) must be OFF for parity with JS, which never
// fuses. Every DSP header wraps its code in MT_DSP_BEGIN / MT_DSP_END.
#pragma once

#include <cmath>
#include <cstdint>

#if defined(__clang__)
#define MT_DSP_BEGIN _Pragma("float_control(push)") _Pragma("clang fp contract(off)")
#define MT_DSP_END _Pragma("float_control(pop)")
#else
#define MT_DSP_BEGIN
#define MT_DSP_END
#endif

MT_DSP_BEGIN

namespace mt {

constexpr double kPi = 3.141592653589793; // Math.PI
constexpr double kSqrt2 = 1.4142135623730951; // Math.SQRT2

// Math.round: nearest integer, ties toward +Infinity.
inline double jsRound(double x) {
  double r = std::floor(x);
  if (x - r >= 0.5) r += 1.0;
  return r;
}

// Math.pow as implemented by JavaScriptCore: non-negative int32 exponents use
// exponentiation by squaring, everything else goes to libm pow.
inline double jsPow(double x, double y) {
  if (std::isnan(y)) return NAN;
  if (std::isinf(y) && std::fabs(x) == 1.0) return NAN;
  if (y >= 0.0 && y <= 2147483647.0) {
    const int32_t yi = static_cast<int32_t>(y);
    if (static_cast<double>(yi) == y) {
      double result = 1.0;
      double b = x;
      int32_t e = yi;
      while (e) {
        if (e & 1) result *= b;
        b *= b;
        e >>= 1;
      }
      return result;
    }
  }
  return std::pow(x, y);
}

// Math.hypot(a, b, c) as implemented by JavaScriptCore.
inline double jsHypot3(double a, double b, double c) {
  if (std::isinf(a) || std::isinf(b) || std::isinf(c)) return INFINITY;
  double mx = 0;
  mx = std::fabs(a) > mx ? std::fabs(a) : mx;
  mx = std::fabs(b) > mx ? std::fabs(b) : mx;
  mx = std::fabs(c) > mx ? std::fabs(c) : mx;
  if (mx == 0) mx = 1;
  const double args[3] = {a, b, c};
  double sum = 0, comp = 0;
  for (double v : args) {
    const double scaled = v / mx;
    const double summand = scaled * scaled - comp;
    const double prelim = sum + summand;
    comp = (prelim - sum) - summand;
    sum = prelim;
  }
  return std::sqrt(sum) * mx;
}

inline double jsSign(double x) { return x > 0 ? 1.0 : (x < 0 ? -1.0 : x); }

inline int nextPow2(int n) {
  int p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Exact port of the JS mulberry32 (reverb room layout depends on it).
struct Mulberry32 {
  uint32_t a;
  explicit Mulberry32(uint32_t seed) : a(seed) {}
  double operator()() {
    a += 0x6d2b79f5u;
    uint32_t t = (a ^ (a >> 15)) * (1u | a);
    t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
    return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
  }
};

// Math.random replacement: xorshift64*, uniform in [0, 1). Allocation/lock free.
struct Rng {
  uint64_t s;
  explicit Rng(uint64_t seed = 0x9E3779B97F4A7C15ull) : s(seed ? seed : 1) {}
  void seed(uint64_t v) { s = v ? v : 1; }
  double operator()() {
    s ^= s >> 12;
    s ^= s << 25;
    s ^= s >> 27;
    const uint64_t r = s * 0x2545F4914F6CDD1Dull;
    return static_cast<double>(r >> 11) * (1.0 / 9007199254740992.0);
  }
};

} // namespace mt

MT_DSP_END
