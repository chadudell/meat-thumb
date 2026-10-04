// Meat Thumb — tempo delay
//
// Stereo or ping-pong, synced to the sequencer BPM (or free in ms). Tape-ish:
// time changes glide (pitch-bending the repeats), Wow adds slow + flutter
// modulation, Tone darkens each repeat, and the loop saturates softly so
// Feedback can go past 100% into a controlled dub runaway. Duck pulls the
// echoes down while you're playing and lets them bloom in the gaps.

export const DELAY_STEREO = 0;
export const DELAY_PINGPONG = 1;

// Beats (quarter notes) per repeat.
export const DELAY_DIVISIONS = [
  { label: '1/1', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4.', beats: 1.5 },
  { label: '1/4', beats: 1 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8.', beats: 0.75 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16.', beats: 0.375 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/32', beats: 0.125 },
];

const MAX_SECONDS = 6.1; // a whole bar at 40 BPM

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// 4-point Hermite interpolation — keeps modulated repeats from going dull.
function hermite(buf, mask, pos) {
  const i = Math.floor(pos);
  const f = pos - i;
  const xm1 = buf[(i - 1) & mask];
  const x0 = buf[i & mask];
  const x1 = buf[(i + 1) & mask];
  const x2 = buf[(i + 2) & mask];
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const b = w + a;
  return ((a * f - b) * f + c) * f + x0;
}

// Linear below |0.7|, then bends smoothly toward |1.2|.
function tapeSat(x) {
  const a = Math.abs(x);
  if (a <= 0.7) return x;
  return Math.sign(x) * (0.7 + 0.5 * Math.tanh((a - 0.7) / 0.5));
}

export class TempoDelay {
  constructor(sr) {
    this.sr = sr;
    this.params = {
      mix: 0.2,
      sync: true,
      div: 5, // 1/8.
      timeMs: 350,
      feedback: 0.4, // 0..1.1
      mode: DELAY_PINGPONG,
      tone: 0.6, // 0..1 → loop lowpass 500Hz..20kHz
      wow: 0.15,
      duck: 0.3,
    };
    this.size = nextPow2(Math.ceil(MAX_SECONDS * sr) + 8);
    this.mask = this.size - 1;
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.pos = 0;
    this.cur = 0.375 * sr;
    this.lpL = 0;
    this.lpR = 0;
    this.hpL = 0;
    this.hpR = 0;
    this.wowPhase = 0;
    this.flutterPhase = 0;
    this.drift = 0;
    this.driftTarget = 0;
    this.duckEnv = 0;
  }

  targetSamples(bpm) {
    const p = this.params;
    const seconds = p.sync ? (DELAY_DIVISIONS[p.div].beats * 60) / bpm : p.timeMs / 1000;
    return Math.min(this.size - 8, Math.max(4, seconds * this.sr));
  }

  process(left, right, frames, bpm) {
    const p = this.params;
    if (p.mix <= 0 && p.feedback <= 0) return;
    const sr = this.sr;
    const target = this.targetSamples(bpm);
    const glide = 1 - Math.exp(-1 / (0.08 * sr));
    const lpC = 1 - Math.exp((-2 * Math.PI * 500 * Math.pow(40, p.tone)) / sr);
    const hpC = 1 - Math.exp((-2 * Math.PI * 90) / sr);
    const fb = p.feedback;
    const wowDepth = p.wow * 0.003 * sr;
    const wowInc = 0.45 / sr;
    const flutterInc = 6.5 / sr;
    const duckAtk = 1 - Math.exp(-1 / (0.002 * sr));
    const duckRel = 1 - Math.exp(-1 / (0.25 * sr));
    const pingpong = p.mode === DELAY_PINGPONG;
    const { bufL, bufR, mask } = this;

    if (Math.random() < 0.01) this.driftTarget = Math.random() * 2 - 1;

    for (let s = 0; s < frames; s++) {
      const inL = left[s];
      const inR = right[s];

      this.cur += (target - this.cur) * glide;
      this.drift += (this.driftTarget - this.drift) * 0.00005;
      this.wowPhase = (this.wowPhase + wowInc) % 1;
      this.flutterPhase = (this.flutterPhase + flutterInc) % 1;
      const mod =
        wowDepth *
        (0.6 * Math.sin(2 * Math.PI * this.wowPhase) + 0.3 * this.drift + 0.1 * Math.sin(2 * Math.PI * this.flutterPhase));
      const d = Math.max(3, this.cur + mod);

      const rp = this.pos - d;
      const yL = hermite(bufL, mask, rp);
      const yR = hermite(bufR, mask, rp);

      // Darken + thin each repeat on its way back round.
      this.lpL += (yL - this.lpL) * lpC;
      this.lpR += (yR - this.lpR) * lpC;
      this.hpL += (this.lpL - this.hpL) * hpC;
      this.hpR += (this.lpR - this.hpR) * hpC;
      const fL = (this.lpL - this.hpL) * fb;
      const fR = (this.lpR - this.hpR) * fb;

      if (pingpong) {
        // Mono in on the left, then bounce: L → R → L …
        bufL[this.pos] = tapeSat((inL + inR) * 0.5 + fR);
        bufR[this.pos] = tapeSat(fL);
      } else {
        bufL[this.pos] = tapeSat(inL + fL);
        bufR[this.pos] = tapeSat(inR + fR);
      }
      this.pos = (this.pos + 1) & mask;

      const level = Math.max(Math.abs(inL), Math.abs(inR));
      this.duckEnv += (level - this.duckEnv) * (level > this.duckEnv ? duckAtk : duckRel);
      const wet = p.mix * (1 - p.duck * Math.min(1, this.duckEnv * 3));

      left[s] = inL + yL * wet;
      right[s] = inR + yR * wet;
    }
  }
}
