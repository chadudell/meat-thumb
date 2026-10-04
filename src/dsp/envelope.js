// Meat Thumb — ADSR envelope (linear attack, exponential decay/release)

export const ENV_IDLE = 0;
export const ENV_ATTACK = 1;
export const ENV_DECAY = 2;
export const ENV_SUSTAIN = 3;
export const ENV_RELEASE = 4;

// Precompute per-block so the per-sample step is just arithmetic.
export function envCoefs(attack, decay, sustain, release, sr) {
  return {
    attackStep: 1 / Math.max(1, attack * sr),
    decayCoef: Math.exp(-1 / Math.max(1, decay * sr * 0.25)),
    sustain,
    releaseCoef: Math.exp(-1 / Math.max(1, release * sr * 0.25)),
  };
}

export class Envelope {
  constructor() {
    this.value = 0;
    this.stage = ENV_IDLE;
  }

  get active() {
    return this.stage !== ENV_IDLE;
  }

  noteOn() {
    this.stage = ENV_ATTACK;
  }

  noteOff() {
    if (this.stage !== ENV_IDLE) this.stage = ENV_RELEASE;
  }

  reset() {
    this.value = 0;
    this.stage = ENV_IDLE;
  }

  next(c) {
    switch (this.stage) {
      case ENV_ATTACK:
        this.value += c.attackStep;
        if (this.value >= 1) {
          this.value = 1;
          this.stage = ENV_DECAY;
        }
        break;
      case ENV_DECAY:
        this.value = c.sustain + (this.value - c.sustain) * c.decayCoef;
        if (this.value - c.sustain < 1e-4) this.stage = ENV_SUSTAIN;
        break;
      case ENV_SUSTAIN:
        this.value = c.sustain;
        break;
      case ENV_RELEASE:
        this.value *= c.releaseCoef;
        if (this.value < 1e-5) {
          this.value = 0;
          this.stage = ENV_IDLE;
        }
        break;
    }
    return this.value;
  }
}
