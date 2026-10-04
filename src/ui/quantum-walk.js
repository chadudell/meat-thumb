// Meat Thumb — discrete-time Hadamard quantum walk on a line
//
// A walker on `size` sites (scale degrees) with a two-state coin: a left-mover
// and a right-mover, each with a complex amplitude. Each step:
//   coin:  H = 1/√2 [[1, 1], [1, −1]] mixes the two coin states at every site
//   shift: left-movers hop one site down, right-movers one site up
//          (at a wall the walker reflects: it flips direction and stays put)
// Both operations are unitary, so total probability stays exactly 1.
// Measuring position gives P(x) = |ψ_L(x)|² + |ψ_R(x)|².
//
// Interference makes this spread linearly in t (a classical random walk
// spreads like √t) and piles probability near the leading edges ±t/√2,
// so mutated notes tend to *leap* rather than shuffle to a neighbour.
// The symmetric starting coin (|L⟩ + i|R⟩)/√2 keeps the leaps balanced
// up and down.

export function quantumWalkDistribution(start, steps, size) {
  let lr = new Float64Array(size);
  let li = new Float64Array(size);
  let rr = new Float64Array(size);
  let ri = new Float64Array(size);
  lr[start] = Math.SQRT1_2;
  ri[start] = Math.SQRT1_2;

  for (let t = 0; t < steps; t++) {
    const nlr = new Float64Array(size);
    const nli = new Float64Array(size);
    const nrr = new Float64Array(size);
    const nri = new Float64Array(size);
    for (let x = 0; x < size; x++) {
      // Hadamard coin
      const cLr = (lr[x] + rr[x]) * Math.SQRT1_2;
      const cLi = (li[x] + ri[x]) * Math.SQRT1_2;
      const cRr = (lr[x] - rr[x]) * Math.SQRT1_2;
      const cRi = (li[x] - ri[x]) * Math.SQRT1_2;
      // Shift with reflecting walls
      if (x > 0) {
        nlr[x - 1] += cLr;
        nli[x - 1] += cLi;
      } else {
        nrr[x] += cLr;
        nri[x] += cLi;
      }
      if (x < size - 1) {
        nrr[x + 1] += cRr;
        nri[x + 1] += cRi;
      } else {
        nlr[x] += cRr;
        nli[x] += cRi;
      }
    }
    lr = nlr;
    li = nli;
    rr = nrr;
    ri = nri;
  }

  const p = new Float64Array(size);
  for (let x = 0; x < size; x++) p[x] = lr[x] ** 2 + li[x] ** 2 + rr[x] ** 2 + ri[x] ** 2;
  return p;
}

// Run the walk, then measure: collapse to one site by the Born rule.
export function measureQuantumWalk(start, steps, size, rand = Math.random) {
  const p = quantumWalkDistribution(Math.min(size - 1, Math.max(0, start)), steps, size);
  let r = rand();
  for (let x = 0; x < size; x++) {
    r -= p[x];
    if (r <= 0) return x;
  }
  return size - 1;
}
