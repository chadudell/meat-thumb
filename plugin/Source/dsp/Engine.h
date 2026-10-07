// Meat Thumb — synth engine. Port of src/dsp/meat-thumb-processor.js
//
// Per voice: up to 9 unison oscillators (PolyBLEP saw / pulse / triangle),
// spread in pitch and stereo, each with its own slow analog drift -> sine
// wavefolder, plus a sub oscillator -> stereo filter (own envelope, key
// tracking, global LFO) -> amp envelope. Voices are summed, pushed through an
// asymmetric tanh drive, DC-blocked, then tempo delay -> Quantum Reverb ->
// master ceiling. Every 128-sample chunk the mod matrix adds LFO 1/2, Qubit,
// Lorenz and Dice to the knob values it targets.
//
// Threading: everything except prepare() is allocation-, lock- and
// exception-free and must be called from the audio thread, except
// takeMeter() / outputLevel() which are safe from any (single) other thread.
#pragma once

#include "Envelope.h"
#include "Filter.h"
#include "JsMath.h"
#include "Lfo.h"
#include "ModMatrix.h"
#include "ModSources.h"
#include "Params.h"
#include "QuantumReverb.h"
#include "Sequencer.h"
#include "TempoDelay.h"
#include "Wavefolder.h"

#include <atomic>
#include <functional>

namespace mt {

struct MidiEvent {
  int sampleOffset; // within the process() block; events must be sorted by offset
  int type;         // 0 noteOn, 1 noteOff, 2 allOff, 3 pitchBend (value = semitones)
  int note;
  double velocity;  // 0..1
  double value;
};

enum MidiEventType { MIDI_NOTE_ON = 0, MIDI_NOTE_OFF = 1, MIDI_ALL_OFF = 2, MIDI_PITCH_BEND = 3 };

struct MeterData {
  double rms;       // reverb wet RMS since last takeMeter()
  int jumps;        // quantum tunnelling events since last takeMeter()
  double lfo;       // LFO 1 output
  double mods[5];   // LFO 1, LFO 2, Qubit, Lorenz, Dice
  double bloch[3];  // qubit x, y, z
  int collapses;    // qubit measurements since last takeMeter()
  double lorenz[2]; // lorenz x, z
};

class Engine {
public:
  static constexpr int MAX_VOICES = 8;
  static constexpr int MAX_UNISON = 9;
  static constexpr int BLOCK = 128; // AudioWorklet render quantum

  Params params; // caller writes base values before each process()

  Engine();

  void prepare(double sampleRate); // may allocate
  void reset();
  void setModSlots(const ModSlot* slots); // kModSlots entries, copied
  void setPattern(const SeqPattern&);     // copied
  void setBpm(double bpm);
  void seqStart();                                    // == JS 'seqPlay' (also resets synced LFOs)
  void seqStartAt(int step, double samplesUntilStep); // next step index + samples until it fires
  void seqStop();                                     // == JS 'seqStop'
  bool seqPlaying() const { return seq.playing; }
  void noteOn(int note, double velocity);
  void noteOff(int note);
  void allOff();

  // Renders n frames into L/R (overwrites). Any n works: block-rate work
  // (mod matrix, unison layout, FX block coefficients) runs on a fixed
  // 128-frame grid that persists across calls, exactly like the AudioWorklet
  // render quantum, so the output is independent of the host buffer size.
  // MIDI events are applied sample-accurately (render segments are split at
  // event offsets as well as at sequencer events). Params written before a
  // call take effect at the next 128-grid boundary (<= 2.7 ms @ 48k), as in JS.
  void process(float* L, float* R, int n, const MidiEvent* events, int numEvents);

  std::function<void(int step, bool played)> onStep; // audio thread; step -1 on stop

  MeterData takeMeter();      // any thread: returns latest values + resets accumulators
  double outputLevel() const; // any thread: smoothed RMS of the final output

  double getSampleRate() const { return sr; }

private:
  struct Voice {
    int note = -1;
    double velocity = 0;
    long long age = 0;
    Envelope ampEnv, filtEnv;
    VoiceFilter filter;
    Wavefolder folder;
    double phase[MAX_UNISON] = {};
    double inc[MAX_UNISON] = {};
    double triState[MAX_UNISON] = {};
    double drift[MAX_UNISON] = {};
    double driftTarget[MAX_UNISON] = {};
    double subPhase = 0, subInc = 0;
    bool active() const { return ampEnv.active(); }
    bool releasing() const { return ampEnv.stage == ENV_RELEASE; }
  };

  void applyEvent(const MidiEvent& e);
  void updateModulation(int frames);
  void updateLayout();
  void renderVoices(float* left, float* right, int start, int end);
  void beginFx();
  void postProcess(float* left, float* right, int frames, int offset);
  void publishMeter(const float* L, const float* R, int n);

  static void seqNoteOn(void* ctx, int note, double vel);
  static void seqNoteOff(void* ctx, int note);
  static void seqStep(void* ctx, int step, bool played);

  double sr = 48000;
  Rng rng;
  Params cur; // effective (modulated) params for the current chunk

  Voice voices[MAX_VOICES];
  long long ageCounter = 0;
  double pitchBend = 0;

  double uniPos[MAX_UNISON] = {}, uniGainL[MAX_UNISON] = {}, uniGainR[MAX_UNISON] = {};
  int unisonCount = 1;
  int gridPos = 0; // position inside the current 128-frame block

  double dcX[2] = {}, dcY[2] = {};

  Lfo lfo, lfo2;
  double lfoBuf[BLOCK] = {}, lfo2Buf[BLOCK] = {}, cutBuf[BLOCK] = {};
  double cutoffSmooth = 0.7;

  Qubit qubit;
  Lorenz lorenz;
  Dice dice;
  double modValues[kNumModSources] = {};
  ModSlot slots[kModSlots];

  TempoDelay delay;
  QuantumReverb reverb;
  Sequencer seq;

  // Meter / level publication (audio thread writes, UI thread reads).
  std::atomic<double> mEnergy{0};
  std::atomic<long long> mEnergyCount{0};
  std::atomic<int> mJumps{0};
  std::atomic<int> mCollapses{0};
  std::atomic<double> mLfo{0};
  std::atomic<double> mMods[5];
  std::atomic<double> mBloch[3];
  std::atomic<double> mLorenz[2];
  std::atomic<double> mLevel{0};
  double levelEnv = 0;
};

} // namespace mt
