// Minimal rotary knob: vertical drag (shift = fine), wheel, arrow keys,
// double-click to reset. `bipolar` knobs fill outward from 12 o'clock.

const SWEEP = 270;

export function createKnob({ label, min, max, value, step = 0, bipolar = false, format = (v) => v.toFixed(2), onChange }) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.innerHTML = `
    <div class="dial" tabindex="0" role="slider" aria-label="${label}"
         aria-valuemin="${min}" aria-valuemax="${max}">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path class="track" d=""></path>
        <path class="fill" d=""></path>
        <line class="pointer" x1="32" y1="32" x2="32" y2="12"></line>
      </svg>
    </div>
    <div class="readout"></div>
    <div class="label">${label}</div>`;

  const dial = el.querySelector('.dial');
  const fillPath = el.querySelector('.fill');
  const pointer = el.querySelector('.pointer');
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
    pointer.setAttribute('transform', `rotate(${angle} 32 32)`);
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
  });
  dial.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    const px = e.shiftKey ? 800 : 160;
    set(dragStart + ((dragY - e.clientY) / px) * (max - min));
  });
  const end = () => {
    dragY = null;
    el.classList.remove('active');
  };
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener('dblclick', () => set(initial));
  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(current - Math.sign(e.deltaY) * (step || (max - min) / 100));
  }, { passive: false });
  dial.addEventListener('keydown', (e) => {
    const d = step || (max - min) / 50;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(current + d);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(current - d);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  set(value, false);
  return { el, set, get value() { return current; } };
}

function arc(a0, a1) {
  const r = 26;
  const p = (a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [32 + r * Math.cos(rad), 32 + r * Math.sin(rad)];
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
