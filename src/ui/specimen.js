// The Specimen: the on-model Meat Thumb, altered live by the patch.
//
// Seven drawn states (assets/thumbs, cut from art/meat-thumb-sheet-v2.png and
// registered on the fist so they crossfade cleanly):
//
//   01 clean · 02 sub bass · 03 fat filter · 04 resonance · 05 overdrive ·
//   06 reverb · 07 max meat
//
// Each effect has a weight from the knobs that drive it —
//   bass adds bulk          ← Sub level (and octave)
//   filter adds fleshy folds ← a closing Cutoff, or the wavefolder
//   resonance adds veins     ← Res
//   overdrive roughens skin  ← Drive
//   reverb adds echoes       ← Reverb mix/size, delay mix/feedback
// — and when several are pushed at once the thumb tips into MAX MEAT.
// The weights crossfade the drawings; the live output level then makes the
// thumb throb, the veins pulse, the skin shake and the echoes drift.

const STATES = [
  { id: 'clean', n: '01', name: 'Clean', src: 'assets/thumbs/01-clean.webp' },
  { id: 'sub', n: '02', name: 'Sub Bass', src: 'assets/thumbs/02-sub-bass.webp', what: 'bulk' },
  { id: 'filter', n: '03', name: 'Fat Filter', src: 'assets/thumbs/03-fat-filter.webp', what: 'folds' },
  { id: 'res', n: '04', name: 'Resonance', src: 'assets/thumbs/04-resonance.webp', what: 'veins' },
  { id: 'drive', n: '05', name: 'Overdrive', src: 'assets/thumbs/05-overdrive.webp', what: 'grit' },
  { id: 'echo', n: '06', name: 'Reverb', src: 'assets/thumbs/06-reverb.webp', what: 'echoes' },
  { id: 'max', n: '07', name: 'Max Meat', src: 'assets/thumbs/07-max-meat.webp', what: 'grotesquerie' },
];
const EFFECTS = STATES.slice(1, 6);
const GHOSTS = 3;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Patch → how much of each state. Tuned so the default patch reads as a
// mostly clean thumb and each knob, pushed alone, reaches its drawing.
export function computeCut(p) {
  const sub = p.subType ? clamp01(p.subLevel * (p.subOctave === -2 ? 1.3 : 1.1)) : 0;
  const filter = clamp01(Math.max(p.fold * 1.1, (0.72 - p.cutoff) / 0.5));
  const res = clamp01((p.resonance - 0.12) / 0.7);
  const drive = clamp01((p.drive - 0.15) / 0.75);
  const wet =
    p['reverb:mix'] * 1.25 * (0.6 + 0.4 * p['reverb:size']) +
    p['delay:mix'] * 0.6 * Math.min(1, p['delay:feedback']) +
    (p['reverb:freeze'] ? 0.35 : 0);
  const echo = clamp01((wet - 0.15) / 0.75);

  const w = { sub, filter, res, drive, echo };
  const sorted = Object.values(w).sort((a, b) => b - a);
  const top3 = (sorted[0] + sorted[1] + sorted[2]) / 3;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const meat = 0.6 * top3 + 0.4 * mean;
  const max = smoothstep(0.5, 0.88, meat);
  return { ...w, max, meat, clean: clamp01(1 - meat * 1.6) };
}

function grade(meat) {
  if (meat < 0.15) return 'LEAN';
  if (meat < 0.4) return 'CHOICE';
  if (meat < 0.7) return 'PRIME';
  return 'MAX MEAT';
}

export function createSpecimen(root) {
  root.innerHTML = `
    <div class="specimen-head">
      <span class="kicker">Today's cut</span>
      <span class="cut-no"></span>
    </div>
    <h2 class="cut-name"></h2>
    <div class="stage">
      <div class="moire" aria-hidden="true"></div>
      <div class="ghosts" aria-hidden="true">
        ${Array.from({ length: GHOSTS }, () => `<img class="ghost" alt="" draggable="false">`).join('')}
      </div>
      <div class="thumb" role="img" aria-label="Meat Thumb">
        ${STATES.map((s) => `<img data-id="${s.id}" src="${s.src}" alt="" draggable="false">`).join('')}
      </div>
      <div class="stamp" aria-hidden="true"><span></span></div>
    </div>
    <dl class="cut-sheet">
      ${EFFECTS.map(
        (s) => `
        <div class="cut-row" data-id="${s.id}">
          <dt><span class="n">${s.n}</span> ${s.name} <em>${s.what}</em></dt>
          <dd><span class="bar"><span></span></span><span class="pct">0</span></dd>
        </div>`
      ).join('')}
    </dl>
    <div class="ticket">
      <span>Net meat</span><strong class="net">0%</strong>
    </div>`;

  const layers = Object.fromEntries([...root.querySelectorAll('.thumb img')].map((img) => [img.dataset.id, img]));
  const thumb = root.querySelector('.thumb');
  const ghosts = [...root.querySelectorAll('.ghost')];
  const stamp = root.querySelector('.stamp span');
  const nameEl = root.querySelector('.cut-name');
  const noEl = root.querySelector('.cut-no');
  const netEl = root.querySelector('.net');
  const rows = Object.fromEntries([...root.querySelectorAll('.cut-row')].map((r) => [r.dataset.id, r]));

  let cut = computeCut({});
  let frozen = false;
  let level = 0; // smoothed output level, 0..1
  let target = 0;
  let lfo = 0;
  let lastGhostSrc = '';

  function update(params) {
    cut = computeCut(params);
    frozen = !!params['reverb:freeze'];

    // Weighted crossfade: layer i's opacity is its share of everything up to
    // and including it, so the stack composites to a true weighted average.
    // Weights are cubed so the strongest drawing dominates — five drawings at
    // 30% each would just be mud — and clean only yields to the strongest effect.
    const keep = 1 - cut.max;
    const strongest = Math.max(...EFFECTS.map((s) => cut[s.id]));
    const weights = [
      ['clean', Math.pow(1 - strongest, 1.5) * keep + 0.04],
      ...EFFECTS.map((s) => [s.id, Math.pow(cut[s.id] * keep, 3)]),
      ['max', Math.pow(cut.max, 1.5)],
    ];
    let total = 0;
    for (const [id, wt] of weights) {
      total += wt;
      layers[id].style.opacity = total > 0 ? (wt / total).toFixed(3) : '0';
    }

    // The cut on the ticket is whichever drawing is carrying the most weight.
    let best = weights[0];
    for (const w of weights) if (w[1] > best[1] + 1e-6) best = w;
    const state = STATES.find((s) => s.id === best[0]);
    nameEl.textContent = state.name;
    noEl.textContent = `Nº ${state.n} / 07`;
    root.dataset.cut = state.id;

    for (const s of EFFECTS) {
      const v = cut[s.id];
      rows[s.id].querySelector('.bar span').style.width = `${v * 100}%`;
      rows[s.id].querySelector('.pct').textContent = Math.round(v * 100);
      rows[s.id].classList.toggle('hot', v > 0.5);
    }
    netEl.textContent = `${Math.round(cut.meat * 100)}%`;
    stamp.textContent = grade(cut.meat);
    root.style.setProperty('--grit', cut.drive.toFixed(3));
    root.style.setProperty('--echo', cut.echo.toFixed(3));

    // Echoes are ghosts of whatever the thumb currently looks like.
    if (state.src !== lastGhostSrc) {
      lastGhostSrc = state.src;
      for (const g of ghosts) g.src = state.src;
    }
  }

  // Output level (peak-ish, 0..1) and LFO 1 (-1..1) from the engine meter.
  function feed({ level: lv, lfo: l }) {
    if (lv !== undefined) target = Math.min(1, lv * 1.6);
    if (l !== undefined) lfo = l;
  }

  // Motion is transform/opacity only — the compositor moves pre-rasterised
  // layers, nothing is re-filtered or repainted per frame — and it stops
  // writing to the DOM once the thumb has come to rest.
  let lastFrame = 0;
  let lastWrite = '';
  let ghostFilter = '';
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastFrame < 33) return; // ~30 fps is plenty for a thumb
    lastFrame = now;
    const t = now / 1000;
    level += (target - level) * (target > level ? 0.5 : 0.12);
    target *= 0.9; // decays if the meter goes quiet (e.g. plugin window hidden)
    if (level < 0.002) level = 0;

    // Bulk: the thumb swells with sub and with how hard it's being played.
    // Veins: resonance throbs while it plays. Grit: a jittery shake.
    const throb = level * cut.res * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * (0.9 + 2.6 * cut.res)));
    const swell = 1 + 0.05 * cut.sub + 0.035 * level * (0.4 + cut.sub + cut.max) + 0.015 * throb;
    const wobble = Math.sin(t * 2 * Math.PI * 6.5) * 0.012 * level * (cut.sub + cut.max * 0.6);
    const shake = level * (cut.drive * 1.6 + cut.max);
    const jx = shake ? (Math.random() - 0.5) * shake : 0;
    const jy = shake ? (Math.random() - 0.5) * shake : 0;
    const lean = lfo * 1.6 * (0.3 + cut.filter);
    const tf = `translate(${jx.toFixed(1)}px, ${(jy - level * 6).toFixed(1)}px) rotate(${lean.toFixed(1)}deg) scale(${(swell + wobble).toFixed(3)}, ${(swell - wobble * 0.6).toFixed(3)})`;
    if (tf !== lastWrite) {
      thumb.style.transform = tf;
      lastWrite = tf;
    }

    // Echoes: translucent copies drifting up and away; Freeze holds them.
    const e = cut.echo;
    const filter = `hue-rotate(${frozen ? 160 : 230}deg) saturate(${frozen ? 0.9 : 0.5})`;
    const refilter = filter !== ghostFilter;
    ghostFilter = filter;
    ghosts.forEach((g, i) => {
      const k = i + 1;
      if (e < 0.02) {
        if (g.style.opacity !== '0') g.style.opacity = '0';
        return;
      }
      if (refilter) g.style.filter = filter;
      const drift = frozen ? 0 : Math.sin(t * (0.35 + 0.15 * k) + k * 1.7);
      const dx = k * (10 + 18 * e) + drift * 3 * k;
      const dy = -k * (5 + 9 * e) + Math.cos(t * 0.4 + k) * 2 * (frozen ? 0 : 1);
      g.style.opacity = ((e * 0.36 * (0.7 + 0.3 * level)) / k).toFixed(2);
      g.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${1 + 0.02 * k})`;
    });
  }
  requestAnimationFrame(frame);

  return { update, feed };
}
