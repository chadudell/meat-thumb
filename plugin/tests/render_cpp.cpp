// Renders plugin/tests/scenarios.txt through mt::Engine (the C++ port).
//
//   render_cpp <scenarios.txt> <outDir> [scenarioName|all] [hostBlock]
//
// With hostBlock (e.g. 512 or 100) process() is called with that many frames
// and note events carry their exact sampleOffset inside the host block, which
// exercises the sample-accurate MIDI segment splitting. Non-note commands are
// applied at the start of the host block containing them, so only scenarios
// whose non-note commands are all at block 0 are comparable in that mode
// (the program prints "comparable"/"not comparable").
//
// Writes <outDir>/<name>.f32: Float32 little-endian, all L samples then all R —
// the same layout as render_js.mjs. Note on/off/allOff go through the
// MidiEvent path (offset 0 of the block) to exercise process()'s event handling.
#include "../Source/dsp/Engine.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

struct Cmd {
  int block;
  std::vector<std::string> tok;
};
struct Scenario {
  std::string name;
  int blocks = 0;
  std::vector<Cmd> cmds;
};

static std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : s) {
    if (c == sep) {
      out.push_back(cur);
      cur.clear();
    } else {
      cur += c;
    }
  }
  out.push_back(cur);
  return out;
}

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "usage: %s scenarios.txt outDir [name]\n", argv[0]);
    return 1;
  }
  std::string only = argc > 3 ? argv[3] : "";
  if (only == "all") only.clear();
  const int hostBlock = argc > 4 ? std::atoi(argv[4]) : 128;
  std::ifstream in(argv[1]);
  std::vector<Cmd> prelude;
  std::vector<Scenario> scenarios;
  Scenario cur;
  bool inScenario = false;
  std::string line;
  while (std::getline(in, line)) {
    auto hash = line.find('#');
    if (hash != std::string::npos) line = line.substr(0, hash);
    std::istringstream ss(line);
    std::vector<std::string> tok;
    std::string t;
    while (ss >> t) tok.push_back(t);
    if (tok.empty()) continue;
    if (tok[0] == "scenario") {
      cur = Scenario();
      cur.name = tok[1];
      cur.blocks = std::atoi(tok[2].c_str());
      inScenario = true;
    } else if (tok[0] == "end") {
      scenarios.push_back(cur);
      inScenario = false;
    } else if (inScenario) {
      Cmd c;
      c.block = std::atoi(tok[0].c_str());
      c.tok.assign(tok.begin() + 1, tok.end());
      cur.cmds.push_back(c);
    } else {
      prelude.push_back({0, tok});
    }
  }

  const double SR = 48000;
  const int BLOCK = 128;
  for (const Scenario& sc : scenarios) {
    if (!only.empty() && sc.name != only) continue;
    auto engine = std::make_unique<mt::Engine>();
    mt::Engine& e = *engine;
    e.prepare(SR);
    mt::SeqPattern staged;
    for (int i = 0; i < mt::kMaxSeqSteps; i++) staged.steps[i] = mt::SeqStep();
    std::vector<Cmd> cmds = prelude;
    cmds.insert(cmds.end(), sc.cmds.begin(), sc.cmds.end());
    const int frames = sc.blocks * BLOCK;
    std::vector<float> out(static_cast<size_t>(frames) * 2);
    std::vector<mt::MidiEvent> events;
    bool comparable = true;
    for (const Cmd& c : sc.cmds) {
      const std::string& op = c.tok[0];
      if (c.block != 0 && op != "noteOn" && op != "noteOff" && op != "allOff") comparable = false;
    }
    for (int F = 0; F < frames; F += hostBlock) {
      const int n = std::min(hostBlock, frames - F);
      events.clear();
      for (const Cmd& c : cmds) {
        const int at = c.block * BLOCK;
        if (at < F || at >= F + n) continue;
        const auto& k = c.tok;
        const std::string& op = k[0];
        const int offset = at - F;
        if (op == "param" || op == "delayParam" || op == "reverbParam") {
          std::string key = op == "param" ? k[1] : (op == "delayParam" ? "delay:" : "reverb:") + k[1];
          if (!mt::setParamByKey(e.params, key.c_str(), std::atof(k[2].c_str())))
            std::fprintf(stderr, "unknown param %s\n", key.c_str());
        } else if (op == "modSlots") {
          mt::ModSlot slots[mt::kModSlots];
          for (int i = 0; i < mt::kModSlots && i + 1 < (int)k.size(); i++) {
            auto parts = split(k[i + 1], ':');
            std::string dest = parts[1];
            for (size_t j = 2; j + 1 < parts.size(); j++) dest += ":" + parts[j];
            slots[i].src = std::atoi(parts[0].c_str());
            slots[i].dest = mt::modDestIndex(dest.c_str());
            slots[i].amt = std::atof(parts.back().c_str());
            if (slots[i].dest < 0) std::fprintf(stderr, "unknown dest %s\n", dest.c_str());
          }
          e.setModSlots(slots);
        } else if (op == "seqStep") {
          mt::SeqStep& st = staged.steps[std::atoi(k[1].c_str())];
          st.accent = k[2] == "1";
          st.prob = std::atof(k[3].c_str());
          st.ratchet = std::atoi(k[4].c_str());
          st.numNotes = 0;
          if (k[5] != "-")
            for (auto& nn : split(k[5], ',')) st.notes[st.numNotes++] = std::atoi(nn.c_str());
        } else if (op == "seq") {
          staged.numSteps = 16;
          staged.swing = std::atof(k[2].c_str());
          staged.gate = std::atof(k[3].c_str());
          staged.length = std::atoi(k[4].c_str());
          e.setBpm(std::atof(k[1].c_str()));
          e.setPattern(staged);
        } else if (op == "seqPlay") {
          e.seqStart();
        } else if (op == "seqStop") {
          e.seqStop();
        } else if (op == "noteOn") {
          events.push_back({offset, mt::MIDI_NOTE_ON, std::atoi(k[1].c_str()), std::atof(k[2].c_str()), 0});
        } else if (op == "noteOff") {
          events.push_back({offset, mt::MIDI_NOTE_OFF, std::atoi(k[1].c_str()), 0, 0});
        } else if (op == "allOff") {
          events.push_back({offset, mt::MIDI_ALL_OFF, 0, 0, 0});
        } else {
          std::fprintf(stderr, "unknown command %s\n", op.c_str());
          return 1;
        }
      }
      // Planar output: L in [0, frames), R in [frames, 2*frames).
      std::vector<float> l(n), r(n);
      e.process(l.data(), r.data(), n, events.data(), (int)events.size());
      std::copy(l.begin(), l.end(), out.begin() + F);
      std::copy(r.begin(), r.end(), out.begin() + frames + F);
    }
    const std::string path = std::string(argv[2]) + "/" + sc.name + ".f32";
    FILE* f = std::fopen(path.c_str(), "wb");
    std::fwrite(out.data(), sizeof(float), out.size(), f);
    std::fclose(f);
    std::printf("%s: %d frames (host block %d%s)\n", sc.name.c_str(), frames, hostBlock,
                hostBlock == BLOCK ? "" : (comparable ? ", comparable" : ", not comparable"));
  }
  return 0;
}
