// Where the engine lives. The same UI runs in two places:
//
//   web    — the AudioWorklet in this page (src/dsp/meat-thumb-processor.js)
//   plugin — the C++ engine inside the Meat Thumb AU (plugin/), talking over
//            JUCE's WebView bridge (window.__JUCE__.backend)
//
// Both speak the same messages ('param', 'noteOn', 'seq', 'modSlots', …) and
// send back 'meter' and 'step'. The plugin adds a few of its own:
//   UI → plugin: 'ready', 'gesture' {key, on}, 'uiState' {key, value}
//   plugin → UI: 'init' {params, ui}, 'params' {values}
// In the plugin the AU owns all state (so it saves with your Logic project),
// and storage goes there instead of localStorage.

const EVENT = 'mt';

export function createHost() {
  const backend = window.__JUCE__?.backend;
  return backend ? pluginHost(backend) : webHost();
}

function pluginHost(backend) {
  const listeners = new Set();
  let ui = {};
  let resolveInit;
  const init = new Promise((r) => (resolveInit = r));

  backend.addEventListener(EVENT, (msg) => {
    if (msg.type === 'init') {
      ui = msg.ui || {};
      resolveInit(msg);
      return;
    }
    for (const fn of listeners) fn(msg);
  });

  const post = (msg) => backend.emitEvent(EVENT, msg);

  return {
    kind: 'plugin',
    post,
    onMessage: (fn) => listeners.add(fn),
    // Resolves with { params: {key: value} } once the AU has sent its state.
    async start() {
      post({ type: 'ready' });
      return init;
    },
    gesture: (key, on) => post({ type: 'gesture', key, on }),
    storage: {
      get: (key) => ui[key] ?? null,
      set: (key, value) => {
        ui[key] = value;
        post({ type: 'uiState', key, value });
      },
    },
  };
}

function webHost() {
  const listeners = new Set();
  let ctx = null;
  let node = null;
  let analyser = null;

  return {
    kind: 'web',
    post: (msg) => node?.port.postMessage(msg),
    onMessage: (fn) => listeners.add(fn),
    // Web audio can only start from a click, so main.js calls this lazily.
    async start() {
      return { params: null };
    },
    gesture: () => {},
    storage: {
      get: (key) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          localStorage.setItem(key, value);
        } catch {}
      },
    },
    // ---- web-only: the AudioContext lifecycle ------------------------------
    get running() {
      return ctx?.state === 'running';
    },
    get started() {
      return !!ctx;
    },
    async boot() {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule('src/dsp/meat-thumb-processor.js');
      node = new AudioWorkletNode(ctx, 'meat-thumb', { outputChannelCount: [2] });
      node.port.onmessage = ({ data }) => {
        for (const fn of listeners) fn(data);
      };
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      node.connect(analyser);
      analyser.connect(ctx.destination);
    },
    suspend: () => ctx.suspend(),
    resume: () => ctx.resume(),
    get latency() {
      return ctx ? (ctx.baseLatency || 0) + (ctx.outputLatency || 0) : 0;
    },
    readScope(buf) {
      if (!analyser) return false;
      analyser.getFloatTimeDomainData(buf);
      return true;
    },
  };
}
