// Meat Thumb — exotic modulation sources
//
// Qubit:  a spin-½ state on the Bloch sphere, precessing (Rabi oscillation)
//         around an axis tilted from z toward x. At random moments (Poisson,
//         rate = Measure) it is projectively measured along z: it collapses to
//         |0⟩ (+1) or |1⟩ (−1) with Born-rule probability (1 ± z)/2, then keeps
//         precessing from the pole. Output is ⟨σz⟩ = z.
//         Measure often enough and the state can't rotate away between
//         measurements — it freezes at a pole. That's the quantum Zeno effect,
//         and it falls straight out of the maths.
// Lorenz: the Lorenz attractor (σ=10, ρ=28, β=8/3). Deterministic chaos —
//         smooth, never repeating, flipping between two lobes. Output is x/20.
// Dice:   new random target on every sequencer step / note-on, with slew.

// Knob (0..1) → rate mappings, shared with the UI readouts.
export const qubitRateHz = (v) => 0.02 * Math.pow(500, v);
export const qubitMeasureHz = (v) => 200 * v * v * v;

export class Qubit {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 1;
    this.collapses = 0;
  }

  advance(dt, rate, measureRate, tilt) {
    const theta = tilt * (Math.PI / 2);
    const nx = Math.sin(theta);
    const nz = Math.cos(theta);
    const a = 2 * Math.PI * rate * dt;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const { x, y, z } = this;
    // Rodrigues rotation of the Bloch vector about n = (nx, 0, nz).
    const dot = nx * x + nz * z;
    let x2 = x * c + -nz * y * s + nx * dot * (1 - c);
    let y2 = y * c + (nz * x - nx * z) * s;
    let z2 = z * c + nx * y * s + nz * dot * (1 - c);
    const len = Math.hypot(x2, y2, z2) || 1;
    x2 /= len;
    y2 /= len;
    z2 /= len;

    if (measureRate > 0 && Math.random() < 1 - Math.exp(-measureRate * dt)) {
      const up = Math.random() < (1 + z2) / 2;
      x2 = 0;
      y2 = 0;
      z2 = up ? 1 : -1;
      this.collapses++;
    }
    this.x = x2;
    this.y = y2;
    this.z = z2;
  }

  get value() {
    return this.z;
  }
}

export class Lorenz {
  constructor() {
    this.x = 0.1;
    this.y = 0;
    this.z = 20;
  }

  // speed 0..1 → 0.05..3 attractor time units per second.
  advance(dt, speed) {
    const h = dt * (0.05 + 2.95 * speed * speed);
    const steps = Math.max(1, Math.ceil(h / 0.004));
    const k = h / steps;
    let { x, y, z } = this;
    for (let i = 0; i < steps; i++) {
      // RK2 (midpoint) is plenty at this step size.
      const dx1 = 10 * (y - x);
      const dy1 = x * (28 - z) - y;
      const dz1 = x * y - (8 / 3) * z;
      const xm = x + 0.5 * k * dx1;
      const ym = y + 0.5 * k * dy1;
      const zm = z + 0.5 * k * dz1;
      x += k * 10 * (ym - xm);
      y += k * (xm * (28 - zm) - ym);
      z += k * (xm * ym - (8 / 3) * zm);
    }
    this.x = x;
    this.y = y;
    this.z = z;
  }

  get value() {
    return Math.max(-1, Math.min(1, this.x / 20));
  }
}

export class Dice {
  constructor() {
    this.target = 0;
    this.out = 0;
  }

  roll() {
    this.target = Math.random() * 2 - 1;
  }

  // slew 0..1 → 0..0.5s time constant
  advance(dt, slew) {
    const tau = slew * slew * 0.5;
    this.out = tau <= 0.0005 ? this.target : this.out + (this.target - this.out) * (1 - Math.exp(-dt / tau));
  }

  get value() {
    return this.out;
  }
}
