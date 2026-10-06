# Meat Thumb

A software synth: a very fat oscillator with a wavefolder, a resonant filter, a tempo-synced tape delay, a black-hole-sized reverb, a mod matrix fed by a qubit and a strange attractor, and a step sequencer that mutates itself by quantum walk.

```
unison osc → wavefolder (+ sub) → filter → amp env → drive → delay → quantum reverb → out
                                     ↑
                    filter env + key track + LFO 1

mod matrix: LFO 1 · LFO 2 · Qubit · Lorenz · Dice  →  ~30 knobs across every section
```

```
npm start        # → http://localhost:5173   (or: python3 -m http.server 5173)
```

## Audio Unit (Logic Pro / GarageBand)

```
plugin/build.sh install   # builds, installs to ~/Library/Audio/Plug-Ins/Components, runs auval
```

Needs Xcode or the Command Line Tools, plus CMake (`python3 -m pip install --user cmake ninja`
works). JUCE 8 is fetched automatically, or set `JUCE_DIR`. In Logic: new Software Instrument
track → Instrument slot → **AU Instruments → Meat Thumb**.

- The C++ engine (`plugin/Source/dsp`) is a sample-exact port of `src/dsp`. `plugin/tests/run_parity.sh`
  renders 23 scenarios through both and checks they match (they're bit-identical).
- The plugin's UI is this web UI, zipped into the AU and shown in a WebView (`src/host.js` is the bridge).
  Every knob is a host-automatable parameter. Pattern and mod matrix save with your project.
- Sequencer: **Play** arms it. With *follow host transport* on, it starts and stops with Logic and
  locks to the bar; off, it free-runs at the host tempo.

## The Specimen

The thumb is cut from the on-model sheet `art/meat-thumb-sheet-v2.png` by `python3 art/extract.py`
(needs pillow, numpy, scipy) into `assets/thumbs/`, registered on the fist so the seven states
crossfade cleanly. To swap in revised art, replace the sheet, check the crop boxes and fist
anchors at the top of the script, and re-run it.

## Web version

Click **POWER**, then play with `A`–`K` (white keys), `W E T Y U O` (black keys),
`Z`/`X` to shift octave, the on-screen keys, or any MIDI controller (Chrome/Edge).
`Space` starts/stops the sequencer.

## Oscillator

| Section | What makes it fat |
|---|---|
| **Wave** | PolyBLEP band-limited saw, pulse (with PW), triangle — clean at high notes |
| **Unison** | 1–9 stacked oscillators, symmetric detune on a curve (up to ±60¢), alternating stereo pan, center/side **Blend**, power-normalized so more voices = thicker, not louder |
| **Drift** | Each unison voice wanders independently in pitch, like analog VCOs |
| **Random phase** | Every note starts with scattered phases — no phasey "zip" on the attack |
| **Sub** | Sine or square, 1 or 2 octaves down, mono-centered |
| **Drive** | Asymmetric tanh saturation (adds even harmonics) + DC blocker |

8-voice polyphony with a simple ADSR so it's playable.

### Wavefolder

**Fold** drives each voice's unison stack into `sin(π/2·(g·x + sym))`, folding
the wave back on itself; **Sym** offsets it for even harmonics. Anti-aliased
with first-order ADAA (average of sin over each sample interval, via its
antiderivative −cos) at 2× oversampling with a 16-tap windowed-sinc decimator.
Off-harmonic (aliased) energy on a hard-folded 2.5kHz tone: naive −5.7dB,
ADAA −10.3dB, ADAA ×2 −20.4dB. The dry path is delayed to match the
decimator's 4-sample latency, so Fold can be modulated across zero without clicks.

## Filter

Per voice and stereo (each voice's unison spread survives the filter).

| Mode | |
|---|---|
| **LP24** | 4-pole zero-delay-feedback ladder with tanh saturation in the loop. Bass is compensated as resonance rises; self-oscillates at the top of the Res knob |
| **LP12 / BP / HP** | 2-pole state-variable filter |

**Cutoff** 20Hz–20kHz · **Res** · **Env** (bipolar, ±6 octaves) · **Key** tracking
(100% = cutoff follows pitch exactly) · its own **ADSR**. Cutoff is modulated
per sample, so hard sweeps don't zipper.

## LFO → cutoff

Shapes: sine, triangle, falling saw, square, sample & hold. **Rate** 0.05–30Hz,
or tick **sync to tempo** to lock it to the sequencer's BPM in note divisions
(4 bars down to 1/32, including dotted and triplets). When synced, the LFO
phase resets when the sequencer starts, so wobbles land on the bar. **Amount**
is bipolar (±4 octaves). **Retrigger** restarts the LFO on every note.

## Mod sources & matrix

8 slots, each **source → destination × amount** (bipolar). A slot adds
`amount × source × half the knob's range` to wherever the knob is set, then
clamps. Destinations cover pitch, PW, fold, unison, filter, LFO 1, volume, and
every delay and reverb knob. Cutoff modulation is smoothed per sample.

| Source | What it is |
|---|---|
| **LFO 1** | The filter LFO (its own Amount still goes to cutoff) |
| **LFO 2** | Second LFO: shape, rate, or tempo-sync |
| **Qubit** | A spin-½ state precessing on the Bloch sphere (Rabi oscillation about an axis **Tilt**ed from z toward x). At Poisson-random moments (**Measure** per second) it's projectively measured along z and collapses to \|0⟩ or \|1⟩ with Born-rule probability (1 ± z)/2. Output ⟨σz⟩. Turn Measure up and it freezes at a pole — the **quantum Zeno effect** (measured: 20% of time near a pole unmeasured → 100% at 200 measurements/s) |
| **Lorenz** | The Lorenz attractor (σ=10, ρ=28, β=8/3), RK2-integrated. Smooth deterministic chaos that never repeats |
| **Dice** | New random value on every played step or note, with **Slew** |

## Sequencer: probability, ratchets, mutation

- **PROB** lane: click to cycle 100 → 75 → 50 → 25% (shift-click reverses). The engine rolls once when the playhead reaches the step; a step that had notes but didn't play shows a dashed playhead
- **RATCH** lane: 1–4 evenly spaced hits within the step
- **Mutate**: at the end of every loop, each step mutates with this probability. A note takes a **quantum walk** of **Spread** steps over the scale degrees and is measured: Hadamard coin, unitary shift with reflecting walls, Born-rule sampling. Interference makes a quantum walk spread linearly (σ = 3.35 degrees after 6 steps vs. 2.45 classically) with probability piled at the leading edges, so notes *leap*. Steps can also empty (annihilation), fill in (creation, walking out from the previous note), or change ratchet
- **MUTATE NOW** runs one generation; **REVERT** restores your hand-made pattern. Any edit you make becomes the new original

## Delay

Synced to the sequencer's BPM by default (1/1 down to 1/32, dotted and
triplet), or free 10–2000ms with **sync to tempo** off.

| Control | What it does |
|---|---|
| **Stereo / Ping-pong** | Independent L/R repeats, or mono-in bouncing L → R → L |
| **Feedback** | Up to 110%. The loop soft-saturates, so past 100% it swells into a bounded dub runaway instead of exploding |
| **Tone** | Low-pass inside the loop (500Hz–20kHz): each repeat gets darker |
| **Wow** | Tape wow, flutter and drift on the delay time |
| **Duck** | Pushes the echoes down while you play; they bloom in the gaps |
| **Mix** | Echo level (dry stays at full level) |

Changing the time — or the BPM — glides the delay like tape, bending repeats in pitch.

## Quantum Reverb

A 16-line feedback delay network (FDN) after the drive stage.

| Control | What it does |
|---|---|
| **Mix** | Dry/wet (equal power) |
| **Size** | Delay line lengths, ~20ms → ~600ms. Sweeping it bends pitch like tape |
| **Decay** | RT60 from 0.3s to ~2 minutes |
| **Damp** | High-frequency loss inside the loop (18kHz → 600Hz) |
| **Pre** | Pre-delay, up to 500ms |
| **Mod** | Slow per-line chorus to keep long tails from ringing metallic |
| **Shimmer** | Octave-up pitch shifter fed back into the tank; tails climb. At long decays it becomes self-sustaining — pull Decay down to let it go |
| **Quantum** | Lines are entangled in pairs. At random moments a pair "tunnels" to new delay offsets in opposite directions — individual lines warble and smear while the overall pitch stays centred |
| **Gravity** | Inverts the envelope: the input feeds a cloud of 24 taps over 0.25–4s with exponentially rising gain, so the tank gets a crescendo — sound swells in, then collapses into the tail. Crossfades from normal → full swell as you turn it up |
| **Freeze** | Closes the input and makes the loop lossless. Play over the drone |

Before the tank, a 4-stage Hadamard diffuser turns transients into a dense wash.
A soft ceiling on the master keeps everything under 0dBFS. The event horizon
display shows wet energy, and each quantum jump appears as a particle falling in.

## Sequencer

16-step, polyphonic, scale-aware grid.

- **Rows are scale degrees** (two octaves + root). Change Root, Oct or Scale and the pattern re-maps musically
- Click or drag to paint cells; bottom row is **accent** (full velocity vs. 60%)
- **BPM** 40–240, **Swing** (pushes off-beats late), **Gate** (note length; max = tie), **Steps** 1–16 for odd meters
- **Random** writes a pattern weighted toward root and fifth; **Clear** wipes it
- The pattern saves in your browser

The clock runs inside the AudioWorklet and splits each audio block at note
boundaries, so timing is sample-accurate — no main-thread jitter.

## Layout

- `src/dsp/meat-thumb-processor.js` — voices, drive, master (AudioWorklet, plain JS, no deps; ports directly to C++)
- `src/dsp/folder.js` — ADAA ×2 wavefolder
- `src/dsp/mod-sources.js` — Qubit, Lorenz, Dice
- `src/dsp/mod-matrix.js` — source/destination tables (shared with UI)
- `src/dsp/filter.js` — ladder + SVF filter
- `src/dsp/envelope.js` — ADSR shared by amp and filter
- `src/dsp/lfo.js` — LFO shapes and sync divisions
- `src/dsp/tempo-delay.js` — tempo delay
- `src/dsp/quantum-reverb.js` — the reverb (imported by the processor)
- `src/dsp/sequencer.js` — sample-accurate sequencer clock (imported by the processor)
- `src/ui/sequencer.js` — sequencer grid, lanes, mutation
- `src/ui/quantum-walk.js` — Hadamard quantum walk + measurement
- `src/ui/mod-matrix.js` — matrix slots, Bloch sphere and Lorenz displays
- `src/main.js` — UI wiring, keyboard, MIDI, scope
- `src/ui/knob.js` — knob control (drag, shift-drag for fine, wheel, arrows, double-click reset)
