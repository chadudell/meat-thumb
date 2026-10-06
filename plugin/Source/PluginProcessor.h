// Meat Thumb AU — the processor: host parameters → mt::Engine, MIDI in,
// transport sync, and the lock-free plumbing to and from the web UI.
#pragma once

#include "Parameters.h"
#include "dsp/Engine.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <atomic>

namespace mt::plugin {

class MeatThumbProcessor : public juce::AudioProcessor, private juce::AudioProcessorValueTreeState::Listener {
public:
  MeatThumbProcessor();
  ~MeatThumbProcessor() override;

  // --- AudioProcessor ---
  void prepareToPlay(double sampleRate, int samplesPerBlock) override;
  void releaseResources() override {}
  bool isBusesLayoutSupported(const BusesLayout&) const override;
  void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
  using AudioProcessor::processBlock;

  juce::AudioProcessorEditor* createEditor() override;
  bool hasEditor() const override { return true; }

  const juce::String getName() const override { return "Meat Thumb"; }
  bool acceptsMidi() const override { return true; }
  bool producesMidi() const override { return false; }
  double getTailLengthSeconds() const override { return 8.0; }

  int getNumPrograms() override { return 1; }
  int getCurrentProgram() override { return 0; }
  void setCurrentProgram(int) override {}
  const juce::String getProgramName(int) override { return "Default"; }
  void changeProgramName(int, const juce::String&) override {}

  void getStateInformation(juce::MemoryBlock&) override;
  void setStateInformation(const void*, int) override;

  // --- For the editor (message thread) ---
  juce::AudioProcessorValueTreeState apvts;

  juce::var paramValuesForUi() const;              // {key: value} in UI units
  juce::var changedParamValuesForUi();             // only what moved since last call
  bool setParamFromUi(const juce::String& key, double uiValue);
  void gestureFromUi(const juce::String& key, bool on);

  juce::var uiStateForUi() const;
  void setUiState(const juce::String& key, const juce::String& value);

  void setPatternFromUi(const juce::var& msg);     // the UI's 'seq' message
  void setModSlotsFromUi(const juce::var& msg);    // the UI's 'modSlots' message
  void noteFromUi(int type, int note, double velocity);
  void requestSeq(bool start);

  struct Meter {
    MeterData data{};
    double level = 0;
    double bpm = 120;
    bool seqPlaying = false;
    bool seqArmed = false;
    bool fresh = false;
  };
  bool takeMeter(Meter& out);                      // false if nothing new
  void readScope(float* dest, int n) const;        // most recent n output samples (mono)
  int popSteps(std::array<std::pair<int, bool>, 64>& dest);

  static constexpr int kScopeSize = 4096;

  // Bumped when the host loads a state (preset/project), so the editor reloads the UI.
  std::atomic<int> stateGeneration{0};

private:
  void parameterChanged(const juce::String& id, float) override;
  void applyPattern(const juce::var& msg);
  void applyModSlots(const juce::var& msg);
  void syncTransport(int numSamples);

  Engine engine;
  const std::vector<ParamDef>& defs;
  std::vector<std::atomic<float>*> raw;
  std::vector<juce::RangedAudioParameter*> params;
  std::unique_ptr<std::atomic<bool>[]> dirty;
  std::atomic<bool> anyDirty{false};

  // UI → audio: pattern / mod slots (copied under a lock the audio thread only try-locks)
  juce::SpinLock handoffLock;
  SeqPattern pendingPattern;
  std::array<ModSlot, kModSlots> pendingSlots;
  double pendingBpm = 120;
  bool patternDirty = false, slotsDirty = false;

  // UI → audio: notes from the on-screen / computer keyboard, and Play/Stop
  struct UiNote { int type, note; double velocity; };
  juce::AbstractFifo noteFifo{256};
  std::array<UiNote, 256> noteBuf{};
  std::atomic<int> seqRequest{0}; // 1 start, 2 stop

  // Transport
  bool hostWasPlaying = false;
  bool seqArmed = false;
  double uiBpm = 120, currentBpm = 120;
  int patternLength = 16;
  int hostSyncIndex = 0;
  std::vector<float> monoScratch;

  // Audio → UI
  juce::SpinLock meterLock;
  Meter meter;
  int samplesSinceMeter = 0;
  std::array<float, kScopeSize> scope{};
  std::atomic<int> scopePos{0};
  juce::AbstractFifo stepFifo{256};
  std::array<std::pair<int, bool>, 256> stepBuf{};

  std::vector<MidiEvent> events;

  // Saved with the project: UI-side state (sequencer pattern, matrix) as JSON.
  juce::CriticalSection uiLock;
  juce::NamedValueSet uiState;
  juce::String lastPatternJson, lastSlotsJson;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MeatThumbProcessor)
};

} // namespace mt::plugin
