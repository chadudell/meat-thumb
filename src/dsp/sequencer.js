// Meat Thumb — step sequencer clock (runs inside the AudioWorklet)
//
// Counts in samples, so it never drifts and notes land sample-accurately.
// The processor asks how far the next event is, renders up to it, advances,
// and calls fire() to trigger whatever is due.
//
// Each step is a superposition until the playhead observes it: it plays with
// probability `prob` (rolled once per pass), and a played step can ratchet
// into 1–4 evenly spaced hits.

const ACCENT_VELOCITY = 1;
const RATCHET_ACCENT_VELOCITY = 0.85;
const NORMAL_VELOCITY = 0.6;

export class Sequencer {
  constructor(sr, { noteOn, noteOff, step }) {
    this.sr = sr;
    this.cb = { noteOn, noteOff, step };
    this.playing = false;
    this.bpm = 120;
    this.swing = 0; // 0..0.5 — fraction of a step the off-beats are pushed late
    this.gate = 0.5; // 0..1 of a (ratchet) hit; 1 = legato
    this.length = 16;
    this.steps = []; // [{ notes: number[], accent: boolean, prob: 0..1, ratchet: 1..4 }]
    this.current = 0;
    this.untilStep = 0; // samples (fractional) until the next step fires
    this.events = []; // [{ in, on, note, vel }] pending, `in` samples from now
  }

  set({ steps, bpm, swing, gate, length }) {
    if (steps) this.steps = steps;
    if (bpm !== undefined) this.bpm = bpm;
    if (swing !== undefined) this.swing = swing;
    if (gate !== undefined) this.gate = gate;
    if (length !== undefined) this.length = Math.max(1, length | 0);
  }

  start() {
    this.releaseAll();
    this.playing = true;
    this.current = 0;
    this.untilStep = 0;
  }

  stop() {
    this.playing = false;
    this.releaseAll();
  }

  releaseAll() {
    for (const e of this.events) if (!e.on) this.cb.noteOff(e.note);
    this.events = [];
  }

  // Sixteenth-note length, with swing stretching even steps and shrinking odd
  // ones so each pair still takes two sixteenths.
  stepLength(index) {
    const base = (60 / this.bpm / 4) * this.sr;
    return index % 2 === 0 ? base * (1 + this.swing) : base * (1 - this.swing);
  }

  samplesToNextEvent() {
    let next = this.untilStep;
    for (const e of this.events) if (e.in < next) next = e.in;
    return Math.max(1, Math.ceil(next));
  }

  advance(samples) {
    this.untilStep -= samples;
    for (const e of this.events) e.in -= samples;
  }

  fire() {
    if (this.events.length) {
      const due = [];
      const rest = [];
      for (const e of this.events) (e.in <= 0 ? due : rest).push(e);
      if (due.length) {
        this.events = rest;
        // Offs before ons, so a legato repeat retriggers cleanly.
        for (const e of due) if (!e.on) this.cb.noteOff(e.note);
        for (const e of due) if (e.on) this.cb.noteOn(e.note, e.vel);
      }
    }

    while (this.untilStep <= 0) {
      const index = this.current % this.length;
      const len = this.stepLength(index);
      const step = this.steps[index];
      let played = false;
      if (step && step.notes.length && Math.random() < (step.prob ?? 1)) {
        played = true;
        const ratchet = Math.max(1, Math.min(4, step.ratchet | 0 || 1));
        const hit = len / ratchet;
        const gateLen = Math.max(0.005 * this.sr, hit * this.gate);
        for (let k = 0; k < ratchet; k++) {
          const at = k * hit + this.untilStep; // untilStep ≤ 0: we may be slightly late
          const vel = step.accent ? (k === 0 ? ACCENT_VELOCITY : RATCHET_ACCENT_VELOCITY) : NORMAL_VELOCITY;
          for (const note of step.notes) {
            if (k === 0) this.cb.noteOn(note, vel);
            else this.events.push({ in: at, on: true, note, vel });
            this.events.push({ in: at + gateLen, on: false, note });
          }
        }
      }
      this.cb.step(index, played);
      this.untilStep += len;
      this.current = (index + 1) % this.length;
    }
  }
}
