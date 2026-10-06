// Real-time checks for mt::Engine:
//   1. sample-accurate MIDI: a note at offset k starts exactly k samples later
//   2. no heap allocation inside process()/noteOn/... (global operator new hook)
//   3. CPU benchmark: 8 voices x 9 unison, full FX, 10 s @ 48 kHz, 512-frame blocks
#include "../Source/dsp/Engine.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <new>
#include <vector>

static std::atomic<long> gAllocs{0};
void* operator new(size_t n) {
  gAllocs++;
  if (void* p = std::malloc(n ? n : 1)) return p;
  throw std::bad_alloc();
}
void* operator new[](size_t n) {
  gAllocs++;
  if (void* p = std::malloc(n ? n : 1)) return p;
  throw std::bad_alloc();
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, size_t) noexcept { std::free(p); }
void operator delete[](void* p, size_t) noexcept { std::free(p); }

static int firstNonZero(const std::vector<float>& v) {
  for (size_t i = 0; i < v.size(); i++)
    if (v[i] != 0.f) return (int)i;
  return -1;
}

static int noteStart(int offset) {
  auto e = std::make_unique<mt::Engine>();
  e->prepare(48000);
  e->params.randomPhase = false;
  std::vector<float> L(1024), R(1024);
  mt::MidiEvent ev{offset, mt::MIDI_NOTE_ON, 60, 1.0, 0};
  e->process(L.data(), R.data(), 1024, &ev, 1);
  return firstNonZero(L);
}

int main() {
  int fails = 0;

  // 1. Sample accuracy (including offsets that are not on the 128 grid and
  //    that fall into a later 128-block of the same host buffer).
  const int base = noteStart(0);
  for (int off : {1, 37, 127, 128, 300, 777}) {
    const int s = noteStart(off);
    const bool ok = s - base == off;
    fails += !ok;
    std::printf("note at offset %4d -> first sample %4d (offset 0 -> %d)  %s\n", off, s, base, ok ? "OK" : "FAIL");
  }

  // Pitch bend: +12 semitones should double the oscillator frequency.
  {
    auto e = std::make_unique<mt::Engine>();
    e->prepare(48000);
    mt::Params& p = e->params;
    p.randomPhase = false; p.drift = 0; p.unison = 1; p.subType = 0; p.drive = 0; p.cutoff = 1;
    p.filterEnvAmt = 0; p.delay_mix = 0; p.delay_feedback = 0; p.reverb_mix = 0; p.volume = 0.5;
    auto zc = [&](double bend) {
      e->reset();
      std::vector<mt::MidiEvent> evs = {{0, mt::MIDI_PITCH_BEND, 0, 0, bend}, {0, mt::MIDI_NOTE_ON, 57, 1, 0}};
      std::vector<float> L(48000), R(48000);
      e->process(L.data(), R.data(), 48000, evs.data(), (int)evs.size());
      int z = 0;
      for (int i = 24000; i < 48000; i++) z += (L[i - 1] < 0) != (L[i] < 0);
      return z / 2.0 / 0.5; // Hz
    };
    const double f0 = zc(0), f12 = zc(12);
    const bool ok = std::fabs(f12 / f0 - 2) < 0.02;
    fails += !ok;
    std::printf("pitch bend: 0 st -> %.1f Hz, +12 st -> %.1f Hz  %s\n", f0, f12, ok ? "OK" : "FAIL");
  }

  // 2 + 3. Heavy patch.
  auto eng = std::make_unique<mt::Engine>();
  mt::Engine& e = *eng;
  e.prepare(48000);
  mt::Params& p = e.params;
  p.unison = 9;
  p.fold = 0.5;
  p.foldSym = 0.2;
  p.subType = 2;
  p.release = 2;
  p.lfoAmt = 0.3;
  p.delay_mix = 0.4;
  p.delay_feedback = 0.8;
  p.delay_wow = 0.4;
  p.reverb_mix = 0.5;
  p.reverb_shimmer = 0.5;
  p.reverb_gravity = 0.5;
  p.reverb_quantum = 0.6;
  mt::ModSlot slots[mt::kModSlots];
  slots[0] = {2, mt::modDestIndex("fold"), 0.3};
  slots[1] = {4, mt::modDestIndex("cutoff"), 0.2};
  slots[2] = {3, mt::modDestIndex("width"), 0.5};
  e.setModSlots(slots);
  int steps = 0;
  e.onStep = [&](int, bool) { steps++; };

  const int SR = 48000, BLOCK = 512, SECONDS = 10;
  std::vector<float> L(BLOCK), R(BLOCK);
  std::vector<mt::MidiEvent> evs;
  const int notes[8] = {36, 43, 48, 52, 55, 60, 64, 67};
  for (int n : notes) evs.push_back({0, mt::MIDI_NOTE_ON, n, 1, 0});

  const long allocsBefore = gAllocs.load();
  double peak = 0;
  const auto t0 = std::chrono::steady_clock::now();
  for (int done = 0; done < SR * SECONDS; done += BLOCK) {
    e.process(L.data(), R.data(), BLOCK, evs.data(), (int)evs.size());
    evs.clear();
    for (int i = 0; i < BLOCK; i++) peak = std::fmax(peak, std::fabs(L[i]));
  }
  const auto t1 = std::chrono::steady_clock::now();
  const long allocs = gAllocs.load() - allocsBefore;
  const double secs = std::chrono::duration<double>(t1 - t0).count();
  std::printf("benchmark: 8 voices x 9 unison + fold + square sub + full FX, %d s @ %d Hz, %d-frame blocks\n", SECONDS, SR, BLOCK);
  std::printf("  rendered in %.3f s  ->  %.1f%% of real time (one core)\n", secs, 100.0 * secs / SECONDS);
  std::printf("  peak %.3f, output finite: %s\n", peak, std::isfinite(peak) ? "yes" : "NO");

  // Allocation check also covers the sequencer + meters.
  mt::SeqPattern pat;
  pat.numSteps = 16;
  for (int i = 0; i < 16; i++) {
    pat.steps[i].numNotes = 2;
    pat.steps[i].notes[0] = 48 + i;
    pat.steps[i].notes[1] = 55 + i;
    pat.steps[i].ratchet = 1 + i % 4;
  }
  const long a2 = gAllocs.load();
  e.setPattern(pat);
  e.setBpm(174);
  e.seqStart();
  for (int done = 0; done < SR * 2; done += BLOCK) e.process(L.data(), R.data(), BLOCK, nullptr, 0);
  e.seqStop();
  mt::MeterData m = e.takeMeter();
  const long allocs2 = gAllocs.load() - a2;
  std::printf("  heap allocations during process(): %ld (synth) + %ld (sequencer/meter)  %s\n", allocs, allocs2,
              allocs + allocs2 == 0 ? "OK" : "FAIL");
  std::printf("  sequencer steps fired: %d, meter rms %.4f jumps %d, outputLevel %.4f\n", steps, m.rms, m.jumps,
              e.outputLevel());
  fails += (allocs + allocs2) != 0 || !std::isfinite(peak);
  return fails ? 1 : 0;
}
