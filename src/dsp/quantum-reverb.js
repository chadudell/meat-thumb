// Meat Thumb — Quantum Reverb
//
// Signal flow (stereo in → stereo out):
//
//   in → low cut → pre-delay → gravity → [+ shimmer] → 4-stage diffuser → 16-line FDN → wet
//                                   ↑                                         │
//                                   └──────── octave-up pitch shifter ←───────┘
//
// - Diffuser: each stage delays 16 channels by different amounts, shuffles and
//   flips them, then mixes with a Hadamard matrix. Turns a transient into a
//   dense smear before it reaches the tank.
// - FDN tank: 16 modulated delay lines (up to ~0.6s each) with a Householder
//   feedback matrix, per-line damping and a loop low cut. Decay goes from
//   0.3s to ~2 minutes; Freeze makes the loop lossless and closes the input.
// - Quantum: lines live in entangled pairs (i, i+8). At random moments a pair
//   "tunnels" to a new delay offset, the two partners moving in opposite
//   directions, so the tank's average pitch stays centred while individual
//   lines smear and warble. Higher Quantum = more uncertainty, bigger jumps.
// - Gravity: inverts the envelope. The input is read by a cloud of taps
//   spread over 0.25–4s whose gains rise exponentially, so the tank receives a
//   crescendo instead of a hit: the sound swells in, then collapses into the
//   tail. The knob crossfades direct → swell and stretches the swell time.
// - Shimmer: a two-grain pitch shifter (+12 semitones) re-injected into the
//   tank, so tails climb octaves.

const N = 16;
const HALF = N / 2;
const DIFFUSER_MS = [7, 13, 23, 41];
const SHIMMER_WINDOW = 2048;
const GRAVITY_TAPS = 24;
const GRAVITY_MAX_S = 4;

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Deterministic PRNG so the "room" is identical on every load.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// In-place fast Walsh–Hadamard transform, orthonormal (scaled by 1/sqrt(16)).
function hadamard16(x) {
  for (let h = 1; h < N; h *= 2) {
    for (let i = 0; i < N; i += h * 2) {
      for (let j = i; j < i + h; j++) {
        const a = x[j];
        const b = x[j + h];
        x[j] = a + b;
        x[j + h] = a - b;
      }
    }
  }
  for (let i = 0; i < N; i++) x[i] *= 0.25;
}

// Linear below |1|, smoothly bounded at |2| — keeps runaway shimmer/freeze in check.
function softLimit(x) {
  if (x > 1) return 1 + Math.tanh(x - 1);
  if (x < -1) return -1 - Math.tanh(-x - 1);
  return x;
}

export class QuantumReverb {
  constructor(sr) {
    this.sr = sr;
    this.params = {
      mix: 0.3,
      size: 0.6, // 0..1
      decay: 0.55, // 0..1 → 0.3s .. 120s
      damp: 0.4, // 0..1 → 18kHz .. 600Hz in the loop
      predelay: 0.02, // seconds
      mod: 0.3,
      shimmer: 0,
      gravity: 0,
      quantum: 0.25,
      freeze: false,
    };
    const rand = mulberry32(0x6d656174); // "meat"

    // Pre-delay
    this.preSize = nextPow2(Math.ceil(0.5 * sr) + 2);
    this.preMask = this.preSize - 1;
    this.preL = new Float32Array(this.preSize);
    this.preR = new Float32Array(this.preSize);
    this.prePos = 0;

    // Gravity: long stereo buffer read by rising-gain taps.
    this.gravSize = nextPow2(Math.ceil(GRAVITY_MAX_S * sr) + 2);
    this.gravMask = this.gravSize - 1;
    this.gravL = new Float32Array(this.gravSize);
    this.gravR = new Float32Array(this.gravSize);
    this.gravPos = 0;
    this.gravJitter = new Float64Array(GRAVITY_TAPS);
    for (let k = 0; k < GRAVITY_TAPS; k++) this.gravJitter[k] = rand() - 0.5;
    // Exponentially rising gains, normalized to unit energy.
    this.gravGain = new Float64Array(GRAVITY_TAPS);
    let e = 0;
    for (let k = 0; k < GRAVITY_TAPS; k++) {
      this.gravGain[k] = Math.exp(5 * ((k + 1) / GRAVITY_TAPS - 1));
      e += this.gravGain[k] * this.gravGain[k];
    }
    for (let k = 0; k < GRAVITY_TAPS; k++) this.gravGain[k] /= Math.sqrt(e);
    this.gravTapL = new Int32Array(GRAVITY_TAPS); // tap delays in samples, alternating L/R spread
    this.gravTapR = new Int32Array(GRAVITY_TAPS);
    this.gravTime = 0.25 * sr;

    // Diffuser
    this.diff = DIFFUSER_MS.map((ms) => {
      const range = (ms * sr) / 1000;
      const size = nextPow2(Math.ceil(range) + 1);
      const delays = new Int32Array(N);
      for (let i = 0; i < N; i++) delays[i] = Math.max(1, Math.floor((range * (i + rand())) / N));
      const perm = [...Array(N).keys()];
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      const flip = new Float32Array(N);
      for (let i = 0; i < N; i++) flip[i] = rand() < 0.5 ? -1 : 1;
      return { buf: new Float32Array(N * size), size, mask: size - 1, delays, perm: Int32Array.from(perm), flip };
    });
    this.diffPos = 0;

    // FDN tank
    this.fdnSize = nextPow2(Math.ceil(0.7 * sr) + 4);
    this.fdnMask = this.fdnSize - 1;
    this.fdnBuf = new Float32Array(N * this.fdnSize);
    this.fdnPos = 0;
    this.lenRatio = new Float64Array(N);
    for (let i = 0; i < N; i++) this.lenRatio[i] = Math.pow(2, i / N) * (1 + 0.06 * (rand() - 0.5));
    this.curLen = new Float64Array(N).fill(this.baseLen() * 1.5);
    this.lp = new Float64Array(N);
    this.hp = new Float64Array(N);
    this.gain = new Float64Array(N);

    // Modulation: slow LFO per line (interpolated across each block)
    this.lfoPhase = new Float64Array(N);
    this.lfoRate = new Float64Array(N);
    this.lfoPrev = new Float64Array(N);
    this.lfoNext = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      this.lfoPhase[i] = rand();
      this.lfoRate[i] = 0.07 + rand() * 0.35;
    }

    // Quantum: entangled pairs (i, i+HALF) share a target with opposite sign.
    this.qOff = new Float64Array(N);
    this.qTarget = new Float64Array(N);
    this.qGlide = new Float64Array(N).fill(0.001);
    this.rand = Math.random;

    // Shimmer
    this.shSize = SHIMMER_WINDOW * 2;
    this.shMask = this.shSize - 1;
    this.shBuf = new Float32Array(this.shSize);
    this.shPos = 0;
    this.shPhase = 0;

    // Input low cut + smoothing
    this.inHpL = 0;
    this.inHpR = 0;
    this.inGain = 1;

    this.x = new Float64Array(N);
    this.y = new Float64Array(N);
    this.fb = new Float64Array(N);
    this.out = new Float64Array(N);

    // Metering for the UI
    this.energy = 0;
    this.energyCount = 0;
    this.jumps = 0;
  }

  baseLen() {
    return (0.02 + Math.pow(this.params.size, 1.5) * 0.28) * this.sr;
  }

  // Decay time in seconds for the current settings (Infinity when frozen).
  get rt60() {
    return this.params.freeze ? Infinity : 0.3 * Math.pow(400, this.params.decay);
  }

  process(left, right, frames) {
    const p = this.params;
    const sr = this.sr;
    const freeze = p.freeze;

    // --- Per-block coefficients ---------------------------------------------
    const base = this.baseLen();
    const rt = this.rt60;
    for (let i = 0; i < N; i++) {
      this.gain[i] = freeze ? 1 : Math.pow(10, (-3 * this.curLen[i]) / (rt * sr));
    }
    const fc = 18000 * Math.pow(600 / 18000, p.damp);
    const dampC = freeze ? 1 : 1 - Math.exp((-2 * Math.PI * fc) / sr);
    const loopHpC = 1 - Math.exp((-2 * Math.PI * 25) / sr);
    const inHpC = 1 - Math.exp((-2 * Math.PI * 120) / sr);
    const lenGlide = 1 - Math.exp(-1 / (0.15 * sr)); // size changes sweep like tape
    const modDepth = p.mod * 0.0025 * sr;
    const preSamples = Math.min(this.preSize - 2, Math.max(0, Math.round(p.predelay * sr)));
    const inTarget = freeze ? 0 : 1;
    const shimmerGain = freeze ? 0 : p.shimmer * 0.55;

    // Gravity tap layout (glides so turning the knob doesn't click).
    const grav = p.gravity;
    const gravTarget = (0.25 + (GRAVITY_MAX_S - 0.3) * grav * grav) * sr;
    this.gravTime += (gravTarget - this.gravTime) * 0.05;
    const spacing = this.gravTime / GRAVITY_TAPS;
    for (let k = 0; k < GRAVITY_TAPS; k++) {
      const t = (k + 1) * spacing;
      this.gravTapL[k] = Math.min(this.gravSize - 2, Math.round(t + this.gravJitter[k] * spacing));
      this.gravTapR[k] = Math.min(this.gravSize - 2, Math.round(t - this.gravJitter[k] * spacing));
    }
    const directGain = Math.cos((grav * Math.PI) / 2);
    const swellGain = Math.sin((grav * Math.PI) / 2) * 2;
    const dry = Math.cos((p.mix * Math.PI) / 2);
    const wet = Math.sin((p.mix * Math.PI) / 2);

    for (let i = 0; i < N; i++) {
      this.lfoPrev[i] = this.lfoNext[i];
      this.lfoPhase[i] = (this.lfoPhase[i] + (this.lfoRate[i] * frames) / sr) % 1;
      this.lfoNext[i] = Math.sin(2 * Math.PI * this.lfoPhase[i]) * modDepth;
    }

    // Quantum tunnelling events
    const q = p.quantum;
    if (q > 0) {
      const prob = q * q * 0.025;
      const span = q * 0.012 * sr;
      for (let i = 0; i < HALF; i++) {
        if (this.rand() < prob) {
          const t = (this.rand() * 2 - 1) * span;
          // Mostly smooth glides, sometimes a fast "tunnel" that chirps.
          const glide = this.rand() < 0.2 ? 0.004 + q * 0.01 : 0.0002 + this.rand() * 0.001;
          this.qTarget[i] = t;
          this.qTarget[i + HALF] = -t;
          this.qGlide[i] = glide;
          this.qGlide[i + HALF] = glide;
          this.jumps++;
        }
      }
    } else {
      this.qTarget.fill(0);
    }

    // --- Per-sample ---------------------------------------------------------
    const { x, y, fb, out, diff, fdnBuf, fdnMask, fdnSize } = this;
    const norm = 0.5 / Math.sqrt(HALF); // -6dB: a big tank piles up energy
    const shStep = 1 / SHIMMER_WINDOW;

    for (let s = 0; s < frames; s++) {
      const frac = (s + 1) / frames;
      this.inGain += (inTarget - this.inGain) * 0.002;

      // Low cut on the way in so the sub doesn't turn the tank to mud.
      this.inHpL += (left[s] - this.inHpL) * inHpC;
      this.inHpR += (right[s] - this.inHpR) * inHpC;
      const pw = this.prePos;
      this.preL[pw] = (left[s] - this.inHpL) * this.inGain;
      this.preR[pw] = (right[s] - this.inHpR) * this.inGain;
      const pr = (pw - preSamples) & this.preMask;
      let inL = this.preL[pr];
      let inR = this.preR[pr];

      // Gravity
      const gp = this.gravPos;
      this.gravL[gp] = inL;
      this.gravR[gp] = inR;
      this.gravPos = (gp + 1) & this.gravMask;
      if (swellGain > 0.001) {
        let sl = 0;
        let sr2 = 0;
        for (let k = 0; k < GRAVITY_TAPS; k++) {
          const g = this.gravGain[k];
          sl += this.gravL[(gp - this.gravTapL[k]) & this.gravMask] * g;
          sr2 += this.gravR[(gp - this.gravTapR[k]) & this.gravMask] * g;
        }
        inL = inL * directGain + sl * swellGain;
        inR = inR * directGain + sr2 * swellGain;
      }
      this.prePos = (pw + 1) & this.preMask;

      // Shimmer: two overlapping grains reading at double speed.
      let sh = 0;
      if (shimmerGain > 0) {
        const p1 = this.shPhase;
        const p2 = (p1 + 0.5) % 1;
        const d1 = 2 + (1 - p1) * SHIMMER_WINDOW;
        const d2 = 2 + (1 - p2) * SHIMMER_WINDOW;
        sh = (this.readShimmer(d1) * Math.sin(Math.PI * p1) + this.readShimmer(d2) * Math.sin(Math.PI * p2)) * shimmerGain;
        this.shPhase = (p1 + shStep) % 1;
      }

      for (let i = 0; i < N; i++) x[i] = ((i & 1) ? inR : inL) + sh;

      // Diffuser
      const dp = this.diffPos;
      for (let st = 0; st < diff.length; st++) {
        const d = diff[st];
        const w = dp & d.mask;
        for (let i = 0; i < N; i++) {
          const off = i * d.size;
          d.buf[off + w] = x[i];
          y[i] = d.buf[off + ((w - d.delays[i]) & d.mask)];
        }
        for (let i = 0; i < N; i++) x[i] = y[d.perm[i]] * d.flip[i];
        hadamard16(x);
      }
      this.diffPos = dp + 1;

      // FDN tank
      const wp = this.fdnPos;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        this.curLen[i] += (base * this.lenRatio[i] - this.curLen[i]) * lenGlide;
        this.qOff[i] += (this.qTarget[i] - this.qOff[i]) * this.qGlide[i];
        const lfo = this.lfoPrev[i] + (this.lfoNext[i] - this.lfoPrev[i]) * frac;
        let delay = this.curLen[i] + lfo + this.qOff[i];
        if (delay < 2) delay = 2;
        else if (delay > fdnSize - 2) delay = fdnSize - 2;

        const rp = wp - delay;
        const ri = Math.floor(rp);
        const rf = rp - ri;
        const off = i * fdnSize;
        const a = fdnBuf[off + (ri & fdnMask)];
        const b = fdnBuf[off + ((ri + 1) & fdnMask)];
        let v = a + (b - a) * rf;
        out[i] = v;

        this.lp[i] += (v - this.lp[i]) * dampC;
        v = this.lp[i];
        this.hp[i] += (v - this.hp[i]) * loopHpC;
        v = (v - this.hp[i]) * this.gain[i];
        fb[i] = v;
        sum += v;
      }
      const house = (sum * 2) / N;
      for (let i = 0; i < N; i++) {
        fdnBuf[i * fdnSize + wp] = softLimit(x[i] + fb[i] - house);
      }
      this.fdnPos = (wp + 1) & fdnMask;

      let wl = 0;
      let wr = 0;
      for (let i = 0; i < N; i += 2) {
        wl += out[i];
        wr += out[i + 1];
      }
      wl *= norm;
      wr *= norm;

      this.shBuf[this.shPos] = (wl + wr) * 0.5;
      this.shPos = (this.shPos + 1) & this.shMask;

      this.energy += wl * wl + wr * wr;
      this.energyCount++;

      left[s] = left[s] * dry + wl * wet;
      right[s] = right[s] * dry + wr * wet;
    }
  }

  readShimmer(delay) {
    const rp = this.shPos - delay;
    const ri = Math.floor(rp);
    const rf = rp - ri;
    const a = this.shBuf[ri & this.shMask];
    const b = this.shBuf[(ri + 1) & this.shMask];
    return a + (b - a) * rf;
  }

  // Returns and resets the meter accumulators.
  takeMeter() {
    const rms = this.energyCount ? Math.sqrt(this.energy / this.energyCount) : 0;
    const jumps = this.jumps;
    this.energy = 0;
    this.energyCount = 0;
    this.jumps = 0;
    return { rms, jumps };
  }
}
