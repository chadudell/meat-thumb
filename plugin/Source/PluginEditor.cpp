#include "PluginEditor.h"

#include "BinaryData.h"

#include <cmath>

namespace mt::plugin {

namespace {

const juce::Identifier kEvent{"mt"};

const char* mimeFor(const juce::String& path) {
  const auto ext = path.fromLastOccurrenceOf(".", false, false).toLowerCase();
  if (ext == "html") return "text/html";
  if (ext == "js" || ext == "mjs") return "text/javascript";
  if (ext == "css") return "text/css";
  if (ext == "webp") return "image/webp";
  if (ext == "png") return "image/png";
  if (ext == "svg") return "image/svg+xml";
  if (ext == "json") return "application/json";
  return "application/octet-stream";
}

juce::var arrayOf(const double* v, int n) {
  juce::Array<juce::var> a;
  for (int i = 0; i < n; i++) a.add(v[i]);
  return a;
}

} // namespace

MeatThumbEditor::MeatThumbEditor(MeatThumbProcessor& p)
    : AudioProcessorEditor(p),
      proc(p),
      browser(juce::WebBrowserComponent::Options{}
                  .withNativeIntegrationEnabled()
                  .withKeepPageLoadedWhenBrowserIsHidden()
                  .withResourceProvider([this](const juce::String& url) { return resource(url); })
                  .withEventListener(kEvent, [this](const juce::var& msg) { handle(msg); })) {
  // The UI ships inside the plugin as one zip (built from index.html, src/, assets/).
  juce::MemoryInputStream zipStream(BinaryData::ui_zip, (size_t)BinaryData::ui_zipSize, false);
  juce::ZipFile zip(zipStream);
  for (int i = 0; i < zip.getNumEntries(); i++) {
    const auto* entry = zip.getEntry(i);
    if (entry->filename.endsWithChar('/')) continue;
    std::unique_ptr<juce::InputStream> in(zip.createStreamForEntry(i));
    if (!in) continue;
    juce::MemoryBlock data;
    in->readIntoMemoryBlock(data);
    const auto* bytes = static_cast<const std::byte*>(data.getData());
    files[entry->filename] = {std::vector<std::byte>(bytes, bytes + data.getSize()), mimeFor(entry->filename)};
  }

  seenGeneration = proc.stateGeneration.load();
  addAndMakeVisible(browser);
  browser.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

  setResizable(true, true);
  setResizeLimits(960, 640, 2400, 1800);
  setSize(1280, 860);
  startTimerHz(30);
}

MeatThumbEditor::~MeatThumbEditor() { stopTimer(); }

void MeatThumbEditor::resized() { browser.setBounds(getLocalBounds()); }

std::optional<juce::WebBrowserComponent::Resource> MeatThumbEditor::resource(const juce::String& url) {
  auto path = url.upToFirstOccurrenceOf("?", false, false).trimCharactersAtStart("/");
  if (path.isEmpty()) path = "index.html";
  if (const auto it = files.find(path); it != files.end()) return it->second;
  return std::nullopt;
}

void MeatThumbEditor::emit(const juce::var& msg) { browser.emitEventIfBrowserIsVisible(kEvent, msg); }

void MeatThumbEditor::handle(const juce::var& msg) {
  const auto type = msg["type"].toString();

  if (type == "ready") {
    pageReady = true;
    auto* init = new juce::DynamicObject();
    init->setProperty("type", "init");
    init->setProperty("params", proc.paramValuesForUi());
    init->setProperty("ui", proc.uiStateForUi());
    proc.changedParamValuesForUi(); // everything is in the init; drop pending echoes
    emit(juce::var(init));
  } else if (type == "param" || type == "delayParam" || type == "reverbParam") {
    const juce::String prefix = type == "delayParam" ? "delay:" : type == "reverbParam" ? "reverb:" : "";
    proc.setParamFromUi(prefix + msg["name"].toString(), (double)msg["value"]);
  } else if (type == "gesture") {
    proc.gestureFromUi(msg["key"].toString(), (bool)msg["on"]);
  } else if (type == "uiState") {
    proc.setUiState(msg["key"].toString(), msg["value"].toString());
  } else if (type == "seq") {
    proc.setPatternFromUi(msg);
  } else if (type == "modSlots") {
    proc.setModSlotsFromUi(msg);
  } else if (type == "noteOn") {
    proc.noteFromUi(MIDI_NOTE_ON, (int)msg["note"], msg.hasProperty("velocity") ? (double)msg["velocity"] : 1.0);
  } else if (type == "noteOff") {
    proc.noteFromUi(MIDI_NOTE_OFF, (int)msg["note"], 0);
  } else if (type == "allOff") {
    proc.noteFromUi(MIDI_ALL_OFF, 0, 0);
  } else if (type == "seqPlay" || type == "seqStop") {
    proc.requestSeq(type == "seqPlay");
  }
}

void MeatThumbEditor::timerCallback() {
  // A preset or project load replaced the state: rebuild the UI from it.
  if (const int gen = proc.stateGeneration.load(); gen != seenGeneration) {
    seenGeneration = gen;
    pageReady = false;
    browser.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
    return;
  }
  if (!pageReady) return;

  if (auto changed = proc.changedParamValuesForUi(); changed.isObject()) {
    auto* m = new juce::DynamicObject();
    m->setProperty("type", "params");
    m->setProperty("values", changed);
    emit(juce::var(m));
  }

  MeatThumbProcessor::Meter meter;
  if (proc.takeMeter(meter)) {
    const auto& d = meter.data;
    auto* m = new juce::DynamicObject();
    m->setProperty("type", "meter");
    m->setProperty("rms", d.rms);
    m->setProperty("jumps", d.jumps);
    m->setProperty("lfo", d.lfo);
    m->setProperty("mods", arrayOf(d.mods, 5));
    m->setProperty("bloch", arrayOf(d.bloch, 3));
    m->setProperty("collapses", d.collapses);
    m->setProperty("lorenz", arrayOf(d.lorenz, 2));
    m->setProperty("level", meter.level);
    m->setProperty("bpm", meter.bpm);
    m->setProperty("seqPlaying", meter.seqPlaying);
    m->setProperty("seqArmed", meter.seqArmed);

    constexpr int kScope = 1024;
    float buf[kScope];
    proc.readScope(buf, kScope);
    juce::Array<juce::var> scope;
    scope.ensureStorageAllocated(kScope);
    for (float v : buf) scope.add(std::round(v * 1000.0f) / 1000.0);
    m->setProperty("scope", scope);
    emit(juce::var(m));
  }

  std::array<std::pair<int, bool>, 64> steps;
  const int n = proc.popSteps(steps);
  for (int i = 0; i < n; i++) {
    auto* m = new juce::DynamicObject();
    m->setProperty("type", "step");
    m->setProperty("step", steps[(size_t)i].first);
    m->setProperty("played", steps[(size_t)i].second);
    emit(juce::var(m));
  }
}

} // namespace mt::plugin
