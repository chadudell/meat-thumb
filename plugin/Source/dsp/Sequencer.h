// Meat Thumb — step sequencer clock. Port of src/dsp/sequencer.js
//
// Counts in samples so notes land sample-accurately. The engine asks how far
// the next event is, renders up to it, advances, and calls fire().
// Each step plays with probability `prob` and can ratchet into 1–4 hits.
#pragma once
#include "JsMath.h"

MT_DSP_BEGIN

namespace mt {

constexpr int kMaxSeqSteps = 16, kMaxStepNotes = 32;

struct SeqStep {
  int notes[kMaxStepNotes];
  int numNotes = 0;
  bool accent = false;
  double prob = 1;
  int ratchet = 1;
};

struct SeqPattern {
  SeqStep steps[kMaxSeqSteps];
  int numSteps = 0;
  double swing = 0, gate = 0.5;
  int length = 16;
};

struct SeqCallbacks {
  void* ctx = nullptr;
  void (*noteOn)(void* ctx, int note, double vel) = nullptr;
  void (*noteOff)(void* ctx, int note) = nullptr;
  void (*step)(void* ctx, int step, bool played) = nullptr;
};

class Sequencer {
public:
  static constexpr double ACCENT_VELOCITY = 1;
  static constexpr double RATCHET_ACCENT_VELOCITY = 0.85;
  static constexpr double NORMAL_VELOCITY = 0.6;
  // Pending note events. One step generates at most 4 ratchets x 32 notes x 2.
  static constexpr int kMaxEvents = 2048;

  bool playing = false;
  double bpm = 120;
  double swing = 0;
  double gate = 0.5;
  int length = 16;
  int current = 0;
  double untilStep = 0;

  void prepare(double sampleRate, Rng* rngPtr, const SeqCallbacks& callbacks) {
    sr = sampleRate;
    rng = rngPtr;
    cb = callbacks;
  }

  void setPattern(const SeqPattern& p) {
    int n = p.numSteps < 0 ? 0 : (p.numSteps > kMaxSeqSteps ? kMaxSeqSteps : p.numSteps);
    for (int i = 0; i < n; i++) steps[i] = p.steps[i];
    numSteps = n;
    swing = p.swing;
    gate = p.gate;
    length = p.length > 1 ? p.length : 1; // Math.max(1, length | 0)
  }

  void start() {
    releaseAll();
    playing = true;
    current = 0;
    untilStep = 0;
  }

  void startAt(int step, double samplesUntilStep) {
    releaseAll();
    playing = true;
    current = step < 0 ? 0 : step;
    untilStep = samplesUntilStep;
  }

  void stop() {
    playing = false;
    releaseAll();
  }

  void releaseAll() {
    for (int i = 0; i < numEvents; i++)
      if (!events[i].on) cb.noteOff(cb.ctx, events[i].note);
    numEvents = 0;
  }

  double stepLength(int index) const {
    const double base = (60 / bpm / 4) * sr;
    return index % 2 == 0 ? base * (1 + swing) : base * (1 - swing);
  }

  int samplesToNextEvent() const {
    double next = untilStep;
    for (int i = 0; i < numEvents; i++)
      if (events[i].in < next) next = events[i].in;
    const double c = std::fmax(1.0, std::ceil(next));
    return c > 1e9 ? 1000000000 : static_cast<int>(c);
  }

  void advance(int samples) {
    untilStep -= samples;
    for (int i = 0; i < numEvents; i++) events[i].in -= samples;
  }

  void fire() {
    if (numEvents) {
      // Partition into due / rest, preserving order.
      int nd = 0, nr = 0;
      for (int i = 0; i < numEvents; i++) {
        if (events[i].in <= 0) due[nd++] = events[i];
        else events[nr++] = events[i];
      }
      if (nd) {
        numEvents = nr;
        for (int i = 0; i < nd; i++)
          if (!due[i].on) cb.noteOff(cb.ctx, due[i].note);
        for (int i = 0; i < nd; i++)
          if (due[i].on) cb.noteOn(cb.ctx, due[i].note, due[i].vel);
      }
    }

    while (untilStep <= 0) {
      const int index = current % length;
      const double len = stepLength(index);
      const SeqStep* step = index < numSteps ? &steps[index] : nullptr;
      bool played = false;
      if (step && step->numNotes && (*rng)() < step->prob) {
        played = true;
        int r = step->ratchet ? step->ratchet : 1;
        const int ratchet = r < 1 ? 1 : (r > 4 ? 4 : r);
        const double hit = len / ratchet;
        const double gateLen = std::fmax(0.005 * sr, hit * gate);
        const int nn = step->numNotes > kMaxStepNotes ? kMaxStepNotes : step->numNotes;
        for (int k = 0; k < ratchet; k++) {
          const double at = k * hit + untilStep;
          const double vel = step->accent ? (k == 0 ? ACCENT_VELOCITY : RATCHET_ACCENT_VELOCITY) : NORMAL_VELOCITY;
          for (int ni = 0; ni < nn; ni++) {
            const int note = step->notes[ni];
            if (k == 0) cb.noteOn(cb.ctx, note, vel);
            else push(at, true, note, vel);
            push(at + gateLen, false, note, 0);
          }
        }
      }
      cb.step(cb.ctx, index, played);
      untilStep += len;
      current = (index + 1) % length;
    }
  }

private:
  struct Event {
    double in;
    bool on;
    int note;
    double vel;
  };

  void push(double in, bool on, int note, double vel) {
    if (numEvents < kMaxEvents) events[numEvents++] = {in, on, note, vel};
  }

  double sr = 48000;
  Rng* rng = nullptr;
  SeqCallbacks cb;
  SeqStep steps[kMaxSeqSteps];
  int numSteps = 0;
  Event events[kMaxEvents];
  Event due[kMaxEvents];
  int numEvents = 0;
};

} // namespace mt

MT_DSP_END
