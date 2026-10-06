#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>

namespace mt::plugin {

namespace {

juce::AudioProcessorValueTreeState::ParameterLayout makeLayout() {
  juce::AudioProcessorValueTreeState::ParameterLayout layout;
  for (const auto& d : paramDefs()) {
    const juce::ParameterID id{paramId(d), 1};
    switch (d.kind) {
      case Kind::Float:
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            id, d.name, juce::NormalisableRange<float>((float)d.min, (float)d.max), (float)d.def));
        break;
      case Kind::Int:
        layout.add(std::make_unique<juce::AudioParameterInt>(id, d.name, (int)d.min, (int)d.max, (int)d.def));
        break;
      case Kind::Bool:
        layout.add(std::make_unique<juce::AudioParameterBool>(id, d.name, d.def != 0));
        break;
      case Kind::Choice: {
        juce::StringArray labels;
        for (auto* c : d.choices) labels.add(c);
        layout.add(std::make_unique<juce::AudioParameterChoice>(id, d.name, labels, choiceIndexForValue(d, d.def)));
        break;
      }
    }
  }
  return layout;
}

int indexOfKey(const juce::String& key) {
  const auto& defs = paramDefs();
  for (size_t i = 0; i < defs.size(); i++)
    if (key == defs[i].key) return (int)i;
  return -1;
}

int modDestIndex(const juce::String& key) {
  for (int i = 0; i < kNumModDestinations; i++)
    if (key == kModDestinations[i].key) return i;
  return -1;
}

} // namespace

MeatThumbProcessor::MeatThumbProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "MeatThumb", makeLayout()),
      defs(paramDefs()) {
  dirty = std::make_unique<std::atomic<bool>[]>(defs.size());
  for (size_t i = 0; i < defs.size(); i++) {
    const auto id = paramId(defs[i]);
    raw.push_back(apvts.getRawParameterValue(id));
    params.push_back(apvts.getParameter(id));
    dirty[i] = false;
    apvts.addParameterListener(id, this);
  }
  events.reserve(2048);
  for (size_t i = 0; i < defs.size(); i++)
    if (juce::String(defs[i].key) == "seqHostSync") hostSyncIndex = (int)i;
  engine.onStep = [this](int step, bool played) {
    const auto w = stepFifo.write(1);
    if (w.blockSize1 > 0) stepBuf[(size_t)w.startIndex1] = {step, played};
  };
}

MeatThumbProcessor::~MeatThumbProcessor() {
  for (const auto& d : defs) apvts.removeParameterListener(paramId(d), this);
}

bool MeatThumbProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
  const auto out = layouts.getMainOutputChannelSet();
  return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void MeatThumbProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
  engine.prepare(sampleRate);
  monoScratch.assign((size_t)std::max(samplesPerBlock, 4096), 0.0f);
  // prepare() rebuilt the engine; hand it the pattern and matrix again.
  const juce::SpinLock::ScopedLockType l(handoffLock);
  patternDirty = slotsDirty = true;
  hostWasPlaying = false;
}

// ---- Audio thread --------------------------------------------------------------

void MeatThumbProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
  juce::ScopedNoDenormals noDenormals;
  const int n = buffer.getNumSamples();

  {
    const juce::SpinLock::ScopedTryLockType l(handoffLock);
    if (l.isLocked()) {
      if (patternDirty) {
        engine.setPattern(pendingPattern);
        uiBpm = pendingBpm;
        patternLength = std::max(1, pendingPattern.length);
        patternDirty = false;
      }
      if (slotsDirty) {
        engine.setModSlots(pendingSlots.data());
        slotsDirty = false;
      }
    }
  }

  for (size_t i = 0; i < defs.size(); i++) {
    if (!defs[i].apply) continue;
    const double v = raw[i]->load(std::memory_order_relaxed);
    defs[i].apply(engine.params, defs[i].kind == Kind::Choice ? valueForChoiceIndex(defs[i], (int)v) : v);
  }

  syncTransport(n);

  events.clear();
  {
    const auto r = noteFifo.read(noteFifo.getNumReady());
    auto take = [&](int start, int size) {
      for (int i = 0; i < size; i++) {
        const auto& u = noteBuf[(size_t)(start + i)];
        if (events.size() < events.capacity()) events.push_back({0, u.type, u.note, u.velocity, 0});
      }
    };
    take(r.startIndex1, r.blockSize1);
    take(r.startIndex2, r.blockSize2);
  }
  for (const auto meta : midi) {
    if (events.size() >= events.capacity()) break;
    const auto m = meta.getMessage();
    const int at = juce::jlimit(0, std::max(0, n - 1), meta.samplePosition);
    if (m.isNoteOn())
      events.push_back({at, MIDI_NOTE_ON, m.getNoteNumber(), m.getFloatVelocity(), 0});
    else if (m.isNoteOff())
      events.push_back({at, MIDI_NOTE_OFF, m.getNoteNumber(), 0, 0});
    else if (m.isAllNotesOff() || m.isAllSoundOff())
      events.push_back({at, MIDI_ALL_OFF, 0, 0, 0});
    else if (m.isPitchWheel())
      events.push_back({at, MIDI_PITCH_BEND, 0, 0, (m.getPitchWheelValue() - 8192) / 8192.0 * 2.0});
  }
  midi.clear();

  auto* left = buffer.getWritePointer(0);
  auto* right = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : nullptr;
  if (right) {
    engine.process(left, right, n, events.data(), (int)events.size());
  } else {
    // Mono out: render stereo into scratch and fold down.
    if ((int)monoScratch.size() < n) monoScratch.resize((size_t)n); // only if the host lied about block size
    engine.process(left, monoScratch.data(), n, events.data(), (int)events.size());
    for (int i = 0; i < n; i++) left[i] = 0.5f * (left[i] + monoScratch[(size_t)i]);
  }
  for (int c = 2; c < buffer.getNumChannels(); c++) buffer.clear(c, 0, n);

  // Scope ring (mono).
  int pos = scopePos.load(std::memory_order_relaxed);
  for (int i = 0; i < n; i++) {
    scope[(size_t)pos] = right ? 0.5f * (left[i] + right[i]) : left[i];
    pos = (pos + 1) & (kScopeSize - 1);
  }
  scopePos.store(pos, std::memory_order_release);

  // ~30 meter updates a second.
  samplesSinceMeter += n;
  if (samplesSinceMeter >= getSampleRate() / 30) {
    const juce::SpinLock::ScopedTryLockType l(meterLock);
    if (l.isLocked()) {
      samplesSinceMeter = 0;
      meter.data = engine.takeMeter();
      meter.level = engine.outputLevel();
      meter.bpm = currentBpm;
      meter.seqPlaying = engine.seqPlaying();
      meter.seqArmed = seqArmed;
      meter.fresh = true;
    }
  }
}

void MeatThumbProcessor::syncTransport(int) {
  bool hostPlaying = false;
  double ppq = 0;
  currentBpm = uiBpm;
  if (auto* ph = getPlayHead()) {
    if (const auto pos = ph->getPosition()) {
      if (const auto bpm = pos->getBpm()) currentBpm = *bpm;
      hostPlaying = pos->getIsPlaying();
      ppq = pos->getPpqPosition().orFallback(0.0);
    }
  }
  engine.setBpm(currentBpm);
  const bool follow = raw[(size_t)hostSyncIndex]->load(std::memory_order_relaxed) > 0.5f;

  // Start aligned to the DAW's grid: the next 16th note, however far away.
  auto startAligned = [&] {
    const double sixteenths = ppq * 4.0;
    const double next = std::ceil(sixteenths - 1e-9);
    const double samplesPer16th = 60.0 / currentBpm / 4.0 * getSampleRate();
    const auto step = (int)(((long long)next % patternLength + patternLength) % patternLength);
    engine.seqStartAt(step, (next - sixteenths) * samplesPer16th);
  };

  // Play / Stop from the UI arm or disarm the sequencer.
  const int req = seqRequest.exchange(0);
  if (req == 1) {
    seqArmed = true;
    if (!follow) engine.seqStart();
    else if (hostPlaying) startAligned();
  } else if (req == 2) {
    seqArmed = false;
    engine.seqStop();
  }

  if (follow && seqArmed) {
    if (hostPlaying && !hostWasPlaying) startAligned();
    else if (!hostPlaying && hostWasPlaying) engine.seqStop();
  }
  hostWasPlaying = hostPlaying;
}

// ---- Message thread ----------------------------------------------------------------

juce::AudioProcessorEditor* MeatThumbProcessor::createEditor() { return new MeatThumbEditor(*this); }

static double uiValueOf(const ParamDef& d, float rawValue) {
  return d.kind == Kind::Choice ? valueForChoiceIndex(d, (int)rawValue) : (double)rawValue;
}

static juce::var toVar(const ParamDef& d, double v) {
  if (d.kind == Kind::Bool) return v > 0.5;
  if (d.kind == Kind::Int || d.kind == Kind::Choice) return (int)std::lround(v);
  return v;
}

juce::var MeatThumbProcessor::paramValuesForUi() const {
  auto* obj = new juce::DynamicObject();
  for (size_t i = 0; i < defs.size(); i++)
    obj->setProperty(defs[i].key, toVar(defs[i], uiValueOf(defs[i], raw[i]->load())));
  return juce::var(obj);
}

juce::var MeatThumbProcessor::changedParamValuesForUi() {
  if (!anyDirty.exchange(false)) return {};
  auto* obj = new juce::DynamicObject();
  for (size_t i = 0; i < defs.size(); i++)
    if (dirty[i].exchange(false)) obj->setProperty(defs[i].key, toVar(defs[i], uiValueOf(defs[i], raw[i]->load())));
  return juce::var(obj);
}

bool MeatThumbProcessor::setParamFromUi(const juce::String& key, double uiValue) {
  const int i = indexOfKey(key);
  if (i < 0) return false;
  const auto& d = defs[(size_t)i];
  auto* p = params[(size_t)i];
  const float value = d.kind == Kind::Choice ? (float)choiceIndexForValue(d, uiValue) : (float)uiValue;
  p->setValueNotifyingHost(p->convertTo0to1(value));
  return true;
}

void MeatThumbProcessor::gestureFromUi(const juce::String& key, bool on) {
  const int i = indexOfKey(key);
  if (i < 0) return;
  if (on) params[(size_t)i]->beginChangeGesture();
  else params[(size_t)i]->endChangeGesture();
}

void MeatThumbProcessor::parameterChanged(const juce::String& id, float) {
  for (size_t i = 0; i < defs.size(); i++) {
    if (paramId(defs[i]) == id) {
      dirty[i] = true;
      anyDirty = true;
      return;
    }
  }
}

juce::var MeatThumbProcessor::uiStateForUi() const {
  const juce::ScopedLock l(uiLock);
  auto* obj = new juce::DynamicObject();
  for (const auto& nv : uiState) obj->setProperty(nv.name, nv.value);
  return juce::var(obj);
}

void MeatThumbProcessor::setUiState(const juce::String& key, const juce::String& value) {
  const juce::ScopedLock l(uiLock);
  uiState.set(juce::Identifier(key), value);
}

void MeatThumbProcessor::setPatternFromUi(const juce::var& msg) {
  {
    const juce::ScopedLock l(uiLock);
    lastPatternJson = juce::JSON::toString(msg, true);
  }
  applyPattern(msg);
}

void MeatThumbProcessor::setModSlotsFromUi(const juce::var& msg) {
  {
    const juce::ScopedLock l(uiLock);
    lastSlotsJson = juce::JSON::toString(msg, true);
  }
  applyModSlots(msg);
}

void MeatThumbProcessor::applyPattern(const juce::var& msg) {
  SeqPattern pat;
  if (auto* steps = msg["steps"].getArray()) {
    pat.numSteps = std::min((int)steps->size(), kMaxSeqSteps);
    for (int s = 0; s < pat.numSteps; s++) {
      const auto& st = steps->getReference(s);
      auto& out = pat.steps[s];
      out.numNotes = 0;
      if (auto* notes = st["notes"].getArray())
        for (const auto& note : *notes)
          if (out.numNotes < kMaxStepNotes) out.notes[out.numNotes++] = (int)note;
      out.accent = (bool)st["accent"];
      out.prob = st.hasProperty("prob") ? (double)st["prob"] : 1.0;
      out.ratchet = st.hasProperty("ratchet") ? (int)st["ratchet"] : 1;
    }
  }
  if (msg.hasProperty("swing")) pat.swing = msg["swing"];
  if (msg.hasProperty("gate")) pat.gate = msg["gate"];
  if (msg.hasProperty("length")) pat.length = juce::jlimit(1, kMaxSeqSteps, (int)msg["length"]);

  const juce::SpinLock::ScopedLockType l(handoffLock);
  pendingPattern = pat;
  if (msg.hasProperty("bpm")) pendingBpm = msg["bpm"];
  patternDirty = true;
}

void MeatThumbProcessor::applyModSlots(const juce::var& msg) {
  std::array<ModSlot, kModSlots> slots{};
  if (auto* arr = msg["slots"].getArray()) {
    for (int i = 0; i < std::min((int)arr->size(), kModSlots); i++) {
      const auto& s = arr->getReference(i);
      slots[(size_t)i].src = (int)s["src"];
      slots[(size_t)i].dest = modDestIndex(s["dest"].toString());
      slots[(size_t)i].amt = (double)s["amt"];
    }
  }
  const juce::SpinLock::ScopedLockType l(handoffLock);
  pendingSlots = slots;
  slotsDirty = true;
}

void MeatThumbProcessor::noteFromUi(int type, int note, double velocity) {
  const auto w = noteFifo.write(1);
  if (w.blockSize1 > 0) noteBuf[(size_t)w.startIndex1] = {type, note, velocity};
}

void MeatThumbProcessor::requestSeq(bool start) { seqRequest = start ? 1 : 2; }

bool MeatThumbProcessor::takeMeter(Meter& out) {
  const juce::SpinLock::ScopedLockType l(meterLock);
  if (!meter.fresh) return false;
  out = meter;
  meter.fresh = false;
  return true;
}

void MeatThumbProcessor::readScope(float* dest, int n) const {
  const int end = scopePos.load(std::memory_order_acquire);
  for (int i = 0; i < n; i++) dest[i] = scope[(size_t)((end - n + i) & (kScopeSize - 1))];
}

int MeatThumbProcessor::popSteps(std::array<std::pair<int, bool>, 64>& dest) {
  const auto r = stepFifo.read(std::min(stepFifo.getNumReady(), (int)dest.size()));
  int k = 0;
  for (int i = 0; i < r.blockSize1; i++) dest[(size_t)k++] = stepBuf[(size_t)(r.startIndex1 + i)];
  for (int i = 0; i < r.blockSize2; i++) dest[(size_t)k++] = stepBuf[(size_t)(r.startIndex2 + i)];
  return k;
}

// ---- State ------------------------------------------------------------------------

void MeatThumbProcessor::getStateInformation(juce::MemoryBlock& dest) {
  auto state = apvts.copyState();
  juce::ValueTree ui("UI");
  {
    const juce::ScopedLock l(uiLock);
    for (const auto& nv : uiState) ui.setProperty(nv.name, nv.value, nullptr);
    ui.setProperty("enginePattern", lastPatternJson, nullptr);
    ui.setProperty("engineSlots", lastSlotsJson, nullptr);
  }
  state.appendChild(ui, nullptr);
  if (auto xml = state.createXml()) copyXmlToBinary(*xml, dest);
}

void MeatThumbProcessor::setStateInformation(const void* data, int size) {
  auto xml = getXmlFromBinary(data, size);
  if (!xml) return;
  auto state = juce::ValueTree::fromXml(*xml);
  if (!state.hasType(apvts.state.getType())) return;
  auto ui = state.getChildWithName("UI");
  state.removeChild(ui, nullptr);
  apvts.replaceState(state);

  juce::String pattern, slots;
  {
    const juce::ScopedLock l(uiLock);
    uiState.clear();
    for (int i = 0; i < ui.getNumProperties(); i++) {
      const auto name = ui.getPropertyName(i);
      if (name == juce::Identifier("enginePattern")) pattern = ui[name].toString();
      else if (name == juce::Identifier("engineSlots")) slots = ui[name].toString();
      else uiState.set(name, ui[name]);
    }
    lastPatternJson = pattern;
    lastSlotsJson = slots;
  }
  // The engine gets its pattern and matrix even if the editor is never opened.
  if (pattern.isNotEmpty()) applyPattern(juce::JSON::parse(pattern));
  if (slots.isNotEmpty()) applyModSlots(juce::JSON::parse(slots));
  for (size_t i = 0; i < defs.size(); i++) dirty[i] = true;
  anyDirty = true;
  stateGeneration++;
}

} // namespace mt::plugin

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new mt::plugin::MeatThumbProcessor(); }
