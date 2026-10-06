// Meat Thumb AU — the editor is the web UI (index.html + src/ + assets/),
// embedded in the plugin as a zip and shown in a WKWebView. See src/host.js
// for the message protocol.
#pragma once

#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

#include <map>

namespace mt::plugin {

class MeatThumbEditor : public juce::AudioProcessorEditor, private juce::Timer {
public:
  explicit MeatThumbEditor(MeatThumbProcessor&);
  ~MeatThumbEditor() override;

  void resized() override;

private:
  void timerCallback() override;
  void handle(const juce::var& msg);
  void emit(const juce::var& msg);
  std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url);

  MeatThumbProcessor& proc;
  std::map<juce::String, juce::WebBrowserComponent::Resource> files;
  juce::WebBrowserComponent browser;
  bool pageReady = false;
  int seenGeneration = 0;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MeatThumbEditor)
};

} // namespace mt::plugin
