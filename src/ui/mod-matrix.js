// Mod Matrix panel (8 slots) + live displays for the mod sources.

import { createKnob } from './knob.js';
import { MOD_SOURCES, MOD_DESTINATIONS, MOD_SLOTS } from '../dsp/mod-matrix.js';

const STORAGE_KEY = 'meat-thumb.matrix';

// Suggestions to start from — all at 0% so they do nothing until you turn them up.
const DEFAULT_SLOTS = [
  { src: 3, dest: 'pitch', amt: 0 },
  { src: 4, dest: 'fold', amt: 0 },
  { src: 5, dest: 'cutoff', amt: 0 },
  { src: 2, dest: 'reverb:quantum', amt: 0 },
  { src: 0, dest: '', amt: 0 },
  { src: 0, dest: '', amt: 0 },
  { src: 0, dest: '', amt: 0 },
  { src: 0, dest: '', amt: 0 },
];

function loadSlots(storage) {
  try {
    const saved = JSON.parse(storage.get(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length === MOD_SLOTS) return saved;
  } catch {}
  return structuredClone(DEFAULT_SLOTS);
}

const destOptions = (() => {
  const groups = {};
  for (const d of MOD_DESTINATIONS) (groups[d.group] ??= []).push(d);
  return (
    '<option value="">—</option>' +
    Object.entries(groups)
      .map(([g, ds]) => `<optgroup label="${g}">${ds.map((d) => `<option value="${d.key}">${d.label}</option>`).join('')}</optgroup>`)
      .join('')
  );
})();

export function createModMatrix({ host, send, storage }) {
  const slots = loadSlots(storage);

  const sendSlots = () => {
    send({ type: 'modSlots', slots });
    storage.set(STORAGE_KEY, JSON.stringify(slots));
  };

  slots.forEach((slot, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = `
      <div class="slot-n">${i + 1}</div>
      <div class="slot-route">
        <select class="slot-src" aria-label="Slot ${i + 1} source">${MOD_SOURCES.map((s, j) => `<option value="${j}">${s}</option>`).join('')}</select>
        <span class="slot-arrow">→</span>
        <select class="slot-dest" aria-label="Slot ${i + 1} destination">${destOptions}</select>
      </div>`;
    const src = el.querySelector('.slot-src');
    const dest = el.querySelector('.slot-dest');
    src.value = String(slot.src);
    dest.value = slot.dest;
    const sync = () => el.classList.toggle('live', slot.src > 0 && !!slot.dest && slot.amt !== 0);
    src.addEventListener('change', () => {
      slot.src = Number(src.value);
      sync();
      sendSlots();
    });
    dest.addEventListener('change', () => {
      slot.dest = dest.value;
      sync();
      sendSlots();
    });
    const knob = createKnob({
      label: 'Amount',
      size: 'xxs',
      min: -1,
      max: 1,
      value: slot.amt,
      bipolar: true,
      format: (v) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`),
      onChange: (v) => {
        slot.amt = Math.abs(v) < 0.005 ? 0 : v;
        sync();
        sendSlots();
      },
    });
    el.appendChild(knob.el);
    sync();
    host.appendChild(el);
  });

  return { sendSlots };
}

// ---- Source displays ---------------------------------------------------------

export function createSourceDisplays({ getTilt }) {
  const meters = [...document.querySelectorAll('.src-meter span')];
  const bloch = document.getElementById('bloch');
  const lorenz = document.getElementById('lorenz');
  const bctx = bloch.getContext('2d');
  const lctx = lorenz.getContext('2d');
  const trail = [];
  let state = { mods: [0, 0, 0, 0, 0], bloch: [0, 0, 1], lorenz: [0, 20], flash: 0 };

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }

  let last = 0;
  function draw(now = 0) {
    requestAnimationFrame(draw);
    if (now - last < 33) return; // ~30 fps
    last = now;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim();
    const line = css.getPropertyValue('--line').trim();
    const meat = css.getPropertyValue('--meat').trim();
    const ice = css.getPropertyValue('--ice').trim();

    // Bloch sphere, seen side-on (x–z plane), with the precession axis.
    {
      const [w, h] = fit(bloch);
      const c = w / 2;
      const r = w / 2 - 6;
      bctx.clearRect(0, 0, w, h);
      bctx.strokeStyle = line;
      bctx.lineWidth = 1;
      bctx.beginPath();
      bctx.arc(c, c, r, 0, Math.PI * 2);
      bctx.stroke();
      bctx.beginPath();
      bctx.ellipse(c, c, r, r * 0.28, 0, 0, Math.PI * 2);
      bctx.stroke();
      const tilt = (getTilt() * Math.PI) / 2;
      bctx.setLineDash([3, 3]);
      bctx.beginPath();
      bctx.moveTo(c - Math.sin(tilt) * r, c + Math.cos(tilt) * r);
      bctx.lineTo(c + Math.sin(tilt) * r, c - Math.cos(tilt) * r);
      bctx.stroke();
      bctx.setLineDash([]);
      bctx.fillStyle = ink;
      bctx.font = `9px ${css.getPropertyValue('--mono')}`;
      bctx.fillText('|0⟩', c + 4, 9);
      bctx.fillText('|1⟩', c + 4, w - 2);
      const [x, y, z] = state.bloch;
      const px = c + x * r;
      const py = c - z * r + y * r * 0.12;
      bctx.strokeStyle = state.flash > 0 ? ice : meat;
      bctx.lineWidth = 2;
      bctx.beginPath();
      bctx.moveTo(c, c);
      bctx.lineTo(px, py);
      bctx.stroke();
      bctx.fillStyle = state.flash > 0 ? ice : meat;
      bctx.beginPath();
      bctx.arc(px, py, state.flash > 0 ? 6 : 4, 0, Math.PI * 2);
      bctx.fill();
      state.flash = Math.max(0, state.flash - 1);
    }

    // Lorenz attractor trail (x–z projection).
    {
      const [w, h] = fit(lorenz);
      const [x, z] = state.lorenz;
      trail.push([w / 2 + (x / 24) * (w / 2), h - (z / 50) * h]);
      if (trail.length > 750) trail.shift(); // long enough to trace both lobes
      lctx.clearRect(0, 0, w, h);
      lctx.lineWidth = 1;
      lctx.strokeStyle = meat;
      // Fade the tail in a dozen batched strokes rather than one per segment.
      const BANDS = 12;
      const per = Math.ceil(trail.length / BANDS);
      for (let b = 0; b < BANDS; b++) {
        const from = b * per;
        const to = Math.min(trail.length - 1, from + per);
        if (to <= from) break;
        lctx.globalAlpha = (b + 1) / BANDS;
        lctx.beginPath();
        lctx.moveTo(...trail[from]);
        for (let i = from + 1; i <= to; i++) lctx.lineTo(...trail[i]);
        lctx.stroke();
      }
      lctx.globalAlpha = 1;
    }
  }
  requestAnimationFrame(draw);

  return {
    update({ mods, bloch: b, lorenz: l, collapses }) {
      if (!mods) return;
      state.mods = mods;
      state.bloch = b;
      state.lorenz = l;
      if (collapses) state.flash = 8;
      mods.forEach((v, i) => {
        // transform, not left: moves a composited layer instead of repainting the panel
        if (meters[i]) meters[i].style.transform = `translateX(${(((v + 1) / 2) * 34).toFixed(1)}px)`;
      });
    },
  };
}
