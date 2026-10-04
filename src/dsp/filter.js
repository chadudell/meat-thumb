// Meat Thumb — per-voice stereo filter
//
// LP24: zero-delay-feedback (TPT) 4-pole ladder, tanh in the feedback path for
//       that pushed, rubbery resonance. Bass loss at high resonance is
//       partially compensated so it stays meaty. Self-oscillates near max.
// LP12 / BP / HP: TPT state-variable filter (Simper/Zavalishin form).
//
// Both are stable under audio-rate cutoff modulation, which is what lets the
// envelope and LFO sweep hard without zipper noise or blow-ups.

export const FILTER_LP24 = 0;
export const FILTER_LP12 = 1;
export const FILTER_BP = 2;
export const FILTER_HP = 3;

const SAT = 0.7; // ladder saturation drive

export class VoiceFilter {
  constructor(sr) {
    this.sr = sr;
    this.maxHz = sr * 0.45;
    this.ladder = new Float64Array(8); // 4 stages × L/R
    this.svf = new Float64Array(4); // ic1, ic2 × L/R
    this.mode = FILTER_LP24;
    // coefficients
    this.G = 0;
    this.G4 = 0;
    this.inv1g = 1;
    this.k = 0;
    this.comp = 1;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
  }

  reset() {
    this.ladder.fill(0);
    this.svf.fill(0);
  }

  // Call once per sample (shared by both channels).
  setup(mode, hz, res) {
    this.mode = mode;
    if (hz < 20) hz = 20;
    else if (hz > this.maxHz) hz = this.maxHz;
    const g = Math.tan((Math.PI * hz) / this.sr);
    if (mode === FILTER_LP24) {
      this.inv1g = 1 / (1 + g);
      this.G = g * this.inv1g;
      this.G4 = this.G * this.G * this.G * this.G;
      this.k = res * 4.1;
      this.comp = 1 + this.k * 0.45;
    } else {
      this.k = 2 - 1.96 * res;
      this.a1 = 1 / (1 + g * (g + this.k));
      this.a2 = g * this.a1;
      this.a3 = g * this.a2;
    }
  }

  process(x, ch) {
    return this.mode === FILTER_LP24 ? this.processLadder(x, ch) : this.processSvf(x, ch);
  }

  processLadder(x, ch) {
    const s = this.ladder;
    const o = ch * 4;
    const G = this.G;
    const g1 = this.inv1g;
    const k = this.k;
    const input = x * this.comp;

    // Solve the zero-delay feedback loop for the (linear) output estimate…
    const sigma = G * G * G * s[o] * g1 + G * G * s[o + 1] * g1 + G * s[o + 2] * g1 + s[o + 3] * g1;
    const y4 = (this.G4 * input + sigma) / (1 + k * this.G4);
    // …then saturate what actually enters the ladder.
    const u = Math.tanh((input - k * y4) * SAT) / SAT;

    let v = (u - s[o]) * G;
    const y1 = v + s[o];
    s[o] = y1 + v;
    v = (y1 - s[o + 1]) * G;
    const y2 = v + s[o + 1];
    s[o + 1] = y2 + v;
    v = (y2 - s[o + 2]) * G;
    const y3 = v + s[o + 2];
    s[o + 2] = y3 + v;
    v = (y3 - s[o + 3]) * G;
    const y = v + s[o + 3];
    s[o + 3] = y + v;
    return y;
  }

  processSvf(x, ch) {
    const s = this.svf;
    const i = ch * 2;
    const ic1 = s[i];
    const ic2 = s[i + 1];
    const v3 = x - ic2;
    const v1 = this.a1 * ic1 + this.a2 * v3;
    const v2 = ic2 + this.a2 * ic1 + this.a3 * v3;
    s[i] = 2 * v1 - ic1;
    s[i + 1] = 2 * v2 - ic2;
    switch (this.mode) {
      case FILTER_LP12:
        return v2;
      case FILTER_BP:
        return Math.sqrt(this.k) * v1; // peak gain rises with resonance, but tamely
      default:
        return x - this.k * v1 - v2;
    }
  }
}
