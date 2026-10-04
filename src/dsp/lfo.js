// Meat Thumb — global LFO
//
// Free-running in Hz, or tempo-synced to the sequencer's BPM. Output is
// bipolar (-1..1) and lightly smoothed so square and S&H steps don't click
// when they slam the filter cutoff.

export const LFO_SINE = 0;
export const LFO_TRI = 1;
export const LFO_SAW = 2; // falling ramp — the classic wobble
export const LFO_SQUARE = 3;
export const LFO_SH = 4; // sample & hold

// Sync divisions, in beats (quarter notes) per cycle.
export const LFO_DIVISIONS = [
  { label: '4 bar', beats: 16 },
  { label: '2 bar', beats: 8 },
  { label: '1 bar', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4.', beats: 1.5 },
  { label: '1/4', beats: 1 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8.', beats: 0.75 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/32', beats: 0.125 },
];

export class Lfo {
  constructor(sr) {
    this.sr = sr;
    this.phase = 0;
    this.held = Math.random() * 2 - 1;
    this.out = 0;
    this.smooth = 1 - Math.exp((-2 * Math.PI * 250) / sr);
    this.value = 0; // last output, for metering
  }

  reset() {
    this.phase = 0;
    this.held = Math.random() * 2 - 1;
  }

  render(buf, start, end, hz, shape) {
    const inc = hz / this.sr;
    let phase = this.phase;
    let out = this.out;
    for (let s = start; s < end; s++) {
      let raw;
      switch (shape) {
        case LFO_TRI:
          raw = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case LFO_SAW:
          raw = 1 - 2 * phase;
          break;
        case LFO_SQUARE:
          raw = phase < 0.5 ? 1 : -1;
          break;
        case LFO_SH:
          raw = this.held;
          break;
        default:
          raw = Math.sin(2 * Math.PI * phase);
      }
      out += (raw - out) * this.smooth;
      buf[s] = out;
      phase += inc;
      if (phase >= 1) {
        phase -= 1;
        this.held = Math.random() * 2 - 1;
      }
    }
    this.phase = phase;
    this.out = out;
    this.value = out;
  }
}
