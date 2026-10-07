// Minimal rotary knob: vertical drag (shift = fine), wheel, arrow keys,
// double-click to reset. `bipolar` knobs fill outward from 12 o'clock.
// `onGesture(true/false)` brackets a drag, so a plugin host can record it as
// one automation move.

const SWEEP = 270;

// Drawn as a cream bakelite cap (rotates) inside a printed tick ring, with a
// thin red value arc. `size`: 'lg' | 'md' | 'sm' | 'xs'.
const TICKS = Array.from({ length: 11 }, (_, i) => {
  const a = ((-SWEEP / 2 + (i * SWEEP) / 10 - 90) * Math.PI) / 180;
  return `<line x1="${32 + 29 * Math.cos(a)}" y1="${32 + 29 * Math.sin(a)}" x2="${32 + 31.5 * Math.cos(a)}" y2="${32 + 31.5 * Math.sin(a)}"></line>`;
}).join('');

export function createKnob({ label, min, max, value, step = 0, bipolar = false, size = 'md', title, format = (v) => v.toFixed(2), onChange, onGesture }) {
  const el = document.createElement('div');
  el.className = `knob ${size}`;
  if (title) el.title = title;
  el.innerHTML = `
    <div class="dial" tabindex="0" role="slider" aria-label="${label}"
         aria-valuemin="${min}" aria-valuemax="${max}">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <g class="ticks">${TICKS}</g>
        <path class="track" d=""></path>
        <path class="fill" d=""></path>
      </svg>
      <div class="cap"><span class="pointer"></span></div>
    </div>
    <div class="readout"></div>
    <div class="label">${label}</div>`;

  const dial = el.querySelector('.dial');
  const fillPath = el.querySelector('.fill');
  const cap = el.querySelector('.cap');
  const readout = el.querySelector('.readout');
  el.querySelector('.track').setAttribute('d', arc(-SWEEP / 2, SWEEP / 2));

  const initial = value;
  let current = value;

  function set(v, emit = true) {
    v = Math.min(max, Math.max(min, v));
    if (step) v = Math.round(v / step) * step;
    current = v;
    const norm = (v - min) / (max - min);
    const angle = -SWEEP / 2 + norm * SWEEP;
    const from = bipolar ? 0 : -SWEEP / 2;
    const [a0, a1] = angle < from ? [angle, from] : [from, angle];
    fillPath.setAttribute('d', a1 - a0 > 0.3 ? arc(a0, a1) : '');
    cap.style.transform = `rotate(${angle}deg)`;
    readout.textContent = format(v);
    dial.setAttribute('aria-valuenow', String(v));
    if (emit) onChange?.(v);
  }

  let dragY = null;
  let dragStart = 0;
  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId);
    dragY = e.clientY;
    dragStart = current;
    el.classList.add('active');
    onGesture?.(true);
  });
  dial.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    const px = e.shiftKey ? 800 : 160;
    set(dragStart + ((dragY - e.clientY) / px) * (max - min));
  });
  const end = () => {
    if (dragY === null) return;
    dragY = null;
    el.classList.remove('active');
    onGesture?.(false);
  };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  // One-shot edits are a whole gesture on their own.
  const nudge = (v) => {
    onGesture?.(true);
    set(v);
    onGesture?.(false);
  };
  dial.addEventListener('dblclick', () => nudge(initial));
  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    nudge(current - Math.sign(e.deltaY) * (step || (max - min) / 100));
  }, { passive: false });
  dial.addEventListener('keydown', (e) => {
    const d = step || (max - min) / 50;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(current + d);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(current - d);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  set(value, false);
  return { el, set, get value() { return current; } };
}

function arc(a0, a1) {
  const r = 25.5;
  const p = (a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [32 + r * Math.cos(rad), 32 + r * Math.sin(rad)];
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
