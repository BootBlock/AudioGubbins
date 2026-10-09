#!/usr/bin/env node
/**
 * Owns the manifest and compiler configuration of every workspace package.
 *
 * The package dependency graph is an architectural contract (REQ-REPO-154,
 * REQ-EXEC-184), so it is declared once, here, and the per-package files are
 * generated from it. Adding a dependency therefore means editing this
 * declaration, which is the deliberate reviewable step REQ-EXEC-175 asks for,
 * rather than quietly appending a line to one package.json.
 *
 * The `lib` setting is part of the enforcement, not a convenience: a package
 * that must not touch the DOM is compiled without the DOM type definitions, so
 * `document.querySelector` in domain code is a type error long before it
 * reaches a lint rule or a reviewer.
 *
 * Usage:
 *   node tools/sync-workspace-graph.mjs           write the generated files
 *   node tools/sync-workspace-graph.mjs --check   exit non-zero if any is stale
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const PRODUCT_VERSION = JSON.parse(readFileSync(join(REPO_ROOT, 'version.json'), 'utf8')).product;

/**
 * One workspace package. `deps` are the AudioGubbins packages it runs with;
 * `devDeps` those only its tests take, declared as development dependencies
 * and referenced by its compiler project, since its tests compile with it.
 * `devDeps` names the fixtures package alone (ADR-0019).
 *
 * @typedef {object} PackageSpec
 * @property {string} dir
 * @property {string} name
 * @property {string} description
 * @property {boolean} dom
 * @property {boolean} jsx
 * @property {string[]} deps
 * @property {string[]} devDeps
 * @property {Record<string, string>} external
 * @property {Record<string, string>} externalDev
 * @property {boolean} [portable] runs in any global scope, so its source is
 *   compiled a second time with no host's globals at all
 * @property {Record<string, ThreadScope>} [threads] the global scope each
 *   module under `src/threads/` runs in, by file name
 * @property {Record<string, string>} [entries] further entry points, by
 *   subpath, each one module that another package's thread imports without the
 *   main entry, whose page-only modules that thread's scope could not compile
 * @property {boolean} [javascript] holds modules written in JavaScript with
 *   their types in JSDoc, which the package's compiler checks: a grammar a
 *   tool loads in Node, which runs no compiler, as well as the package
 */

/**
 * The global scopes a module can run in, beside the page's, and the library
 * each is compiled with. A package compiled with the DOM's definitions, or
 * with Node's, which load unasked where nothing names `types`, would let a
 * module call what its scope lacks and fail only when it runs there: an
 * AudioWorkletGlobalScope has no `setTimeout`, `TextDecoder`, `performance` or
 * `self`. So each is compiled again, in a project of its own, with the
 * definitions of its scope and nothing else; `declarations` names the file,
 * beside that project, declaring the scope's globals that no library does.
 *
 * @typedef {'any' | 'audio-worklet' | 'dedicated-worker'} ThreadScope
 * @type {Record<ThreadScope, { lib: string[], declarations?: string }>}
 */
const SCOPES = {
  // What every scope has: the language, and nothing of a host.
  any: { lib: ['ES2023'] },
  'audio-worklet': { lib: ['ES2023'], declarations: 'audio-worklet-global-scope.d.ts' },
  'dedicated-worker': { lib: ['ES2023', 'WebWorker'] },
};

/**
 * Whether a package ships stylesheets of its own.
 *
 * Read from the tree rather than declared, so a package that gains or loses a
 * stylesheet gains or loses the entry point for it without anyone remembering.
 *
 * @param {PackageSpec} spec
 */
function hasStylesheets(spec) {
  return existsSync(join(REPO_ROOT, spec.dir, 'src', 'styles'));
}

/**
 * Whether a package has modules that run in another global scope.
 *
 * An AudioWorklet processor or a worker is loaded by URL, not imported, so
 * the application hands the bundler a path to it; ADR-0030 puts such modules
 * under `src/threads/` and declares them as an entry point, so that path
 * stops at the package's boundary rather than reaching into its source.
 *
 * @param {PackageSpec} spec
 */
function hasThreadEntries(spec) {
  return existsSync(join(REPO_ROOT, spec.dir, 'src', 'threads'));
}

/**
 * Whether a package offers its test support to another package's tests.
 *
 * Read from the tree, like the stylesheets: the entry point exists exactly
 * where `src/testing/index.ts` does. Most packages keep test support of their
 * own that no other package's tests need, so declaring it everywhere would
 * offer public paths to nothing.
 *
 * @param {PackageSpec} spec
 */
function hasTestSupportEntry(spec) {
  return existsSync(join(REPO_ROOT, spec.dir, 'src', 'testing', 'index.ts'));
}

/** @type {PackageSpec[]} */
const PACKAGES = [
  {
    dir: 'packages/domain',
    name: '@audiogubbins/domain',
    description:
      'Framework-agnostic AudioGubbins project and domain model. Owns domain truth; depends on nothing.',
    dom: false,
    jsx: false,
    portable: true,
    deps: [],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // The product version and the version of every persisted format, generated
    // from version.json. A leaf, like the Rust crate it mirrors, so that a
    // package which stores something can say which format it wrote without
    // depending on the logging package to find out.
    dir: 'packages/version',
    name: '@audiogubbins/version',
    description:
      'The AudioGubbins product version and the independent version of every persisted format, generated from version.json.',
    dom: false,
    jsx: false,
    deps: [],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // The rules for text a reader is shown, or read: one responsibility, from
    // how its characters are counted to the identifier a name is held under
    // (ADR-0018). A leaf, because the packages that need them share nothing
    // else: written where one of them happened to need it first, the rule for
    // the characters a reader sees and the rule for quoting a value could not
    // reach each other, and the quoting bound would count code units for want
    // of the first.
    dir: 'packages/text',
    name: '@audiogubbins/text',
    description:
      'The rules for text a reader is shown, from how its characters are counted to the identifier a name is held under.',
    dom: false,
    jsx: false,
    // The engine's packages run on the audio thread and in workers, and word
    // a count by it (ADR-0030), so it reads no host's globals.
    portable: true,
    deps: [],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // Mouse, touch, pen and keyboard input, as values, with nothing of the
    // browser in them: one model for every device (ADR-0017).
    dir: 'packages/input',
    name: '@audiogubbins/input',
    description:
      'Mouse, touch, pen and keyboard input as values: pointer samples, gestures and key presses. Nothing of the browser.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/text'],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    dir: 'packages/diagnostics',
    name: '@audiogubbins/diagnostics',
    description:
      'Structured local diagnostic logging, redaction and bundle assembly. No network path exists.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/text', '@audiogubbins/version'],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The processing graph as a value, and what can be decided from it
    // without running it (ADR-0030). No thread, browser or buffer, so the
    // engine can check and plan a graph wherever it runs.
    dir: 'packages/audio-graph',
    name: '@audiogubbins/audio-graph',
    description:
      'The typed directed audio processing graph as a value, and every decision made from it without running it.',
    dom: false,
    jsx: false,
    portable: true,
    deps: ['@audiogubbins/domain', '@audiogubbins/text'],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // The read contract for audio files: recognition by content, the format
    // descriptor and readers that read frames on demand at the native rate
    // (ADR-0050, ADR-0052). Bytes reach it through a port, so it runs in any
    // scope.
    dir: 'packages/codecs',
    name: '@audiogubbins/codecs',
    description:
      'The read contract for audio files: recognising a format by its contents, describing it, and reading its frames on demand at the rate it was recorded at.',
    dom: false,
    jsx: false,
    portable: true,
    deps: ['@audiogubbins/domain'],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The audio core that runs on any thread: blocks and sources, the canonical
    // DSP port, graph execution, transport, offline render, profiles and
    // scheduling (ADR-0030). No browser, so it runs in an AudioWorklet, a
    // worker and a test alike.
    dir: 'packages/audio-engine',
    name: '@audiogubbins/audio-engine',
    description:
      'The audio engine core that runs on any thread: it moves, processes and renders audio through the processing graph.',
    dom: false,
    jsx: false,
    portable: true,
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/audio-graph',
      '@audiogubbins/codecs',
      '@audiogubbins/text',
    ],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // Local inference (ADR-0062): the port a machine-learning processor runs a
    // model through, its adapter over ONNX Runtime Web, which alone names the
    // runtime and loads it on the first session, and the worker that hosts it.
    // The port and the worker's client know no browser, so they run in any
    // scope; what the device offers the runtime is given, never probed. The
    // worker reads the runtime's WebAssembly from the application's origin, in
    // one of the two modules in the repository that reach the network.
    dir: 'packages/ml-runtime',
    name: '@audiogubbins/ml-runtime',
    description:
      'Local inference: the port a machine-learning processor runs a model through, its adapter over ONNX Runtime Web, and the worker that hosts it.',
    dom: false,
    jsx: false,
    portable: true,
    threads: { 'inference-worker.ts': 'dedicated-worker' },
    deps: ['@audiogubbins/domain'],
    devDeps: [],
    // Both MIT, and pinned exactly. A pinned render names the runtime build it
    // ran on (REQ-AUDIO-145), so its version changes deliberately, never by a
    // range; the hashes check its WebAssembly against that name before it runs.
    external: { '@noble/hashes': '2.4.0', 'onnxruntime-web': '1.30.0' },
    externalDev: {},
  },
  {
    // The processor types: each one object that states its descriptor and
    // makes its kernel on the engine (ADR-0061). No browser, so a processor
    // runs on the feeder, the render worker and the worklet alike. A
    // machine-learning processor runs its model through the inference port
    // (ADR-0062), the entry of ml-runtime alone, never its adapter or worker.
    dir: 'packages/processors',
    name: '@audiogubbins/processors',
    description:
      'The processor types: each states its descriptor, parameters, layouts, latency and versions, and makes its canonical kernel on the audio engine.',
    dom: false,
    jsx: false,
    portable: true,
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/audio-graph',
      '@audiogubbins/audio-engine',
      '@audiogubbins/ml-runtime',
    ],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The effect rack: a chain realised as the engine's processing graph,
    // its slots, parallel groups, bypass, solo and wet/dry aligned by the
    // graph's own delay compensation, and run over a stream (ADR-0060).
    dir: 'packages/effect-rack',
    name: '@audiogubbins/effect-rack',
    description:
      'The effect rack: a chain of processors realised as the processing graph, with parallel groups, bypass, solo and wet/dry, run over a stream.',
    dom: false,
    jsx: false,
    portable: true,
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/audio-graph',
      '@audiogubbins/audio-engine',
      '@audiogubbins/processors',
    ],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The browser host of the audio engine: the audio context and its
    // lifecycle, the AudioWorklet processor, the feeder worker and the render
    // worker with their typed messages, and the feed of source frames into the
    // worklet (ADR-0030). Given what the device offers, never probing it.
    dir: 'packages/audio-runtime',
    name: '@audiogubbins/audio-runtime',
    description:
      'The browser host of the audio engine: the audio context, the AudioWorklet processor, the render worker and their typed messages.',
    dom: true,
    jsx: false,
    threads: {
      'engine-processor.ts': 'audio-worklet',
      'capture-processor.ts': 'audio-worklet',
      'feeder-worker.ts': 'dedicated-worker',
      'render-worker.ts': 'dedicated-worker',
      'preview-worker.ts': 'dedicated-worker',
    },
    entries: { './capture-channel': './src/capture/capture-reader.ts' },
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/diagnostics',
      '@audiogubbins/capabilities',
      '@audiogubbins/audio-graph',
      '@audiogubbins/audio-engine',
      '@audiogubbins/effect-rack',
      '@audiogubbins/processors',
      '@audiogubbins/ml-runtime',
    ],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // The time axis as values: zoom and the viewport's exact conversions,
    // frame rates and timecode, time formats, the ruler, the selection set
    // with its command-target precedence, and snapping (ADR-0040, ADR-0041,
    // ADR-0042). No browser, so it runs in any scope.
    dir: 'packages/timeline',
    name: '@audiogubbins/timeline',
    description:
      'The editor timeline as values: sample-accurate viewport coordinates, time formats, the ruler, the selection set and snapping.',
    dom: false,
    jsx: false,
    portable: true,
    deps: ['@audiogubbins/domain'],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // The recording session and monitoring as state machines, capture
    // profiles and their comparison with what the browser granted, the
    // latency calibration's analysis, the recording diagnostics and the
    // scheduling of a controlled recording (ADR-0070). It knows no browser,
    // storage or audio host: the application composes it with them.
    dir: 'packages/recording',
    name: '@audiogubbins/recording',
    description:
      'Recording as values: the session and monitoring state machines, capture profiles, latency calibration, diagnostics and controlled recording.',
    dom: false,
    jsx: false,
    portable: true,
    deps: ['@audiogubbins/domain', '@audiogubbins/text'],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The multi-resolution peak pyramid, made off the page by the peak worker
    // and shared among views by source identity and revision, with its
    // disposable cache format and the zero-crossing search (ADR-0040,
    // ADR-0043). No browser: the worker's scope is declared by its shape.
    dir: 'packages/waveform',
    name: '@audiogubbins/waveform',
    description:
      'Waveform peaks: the multi-resolution pyramid, its worker, its disposable cache and the column reads a view draws from.',
    dom: false,
    jsx: false,
    portable: true,
    threads: { 'peak-worker.ts': 'dedicated-worker' },
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/audio-engine',
      '@audiogubbins/effect-rack',
      '@audiogubbins/processors',
      '@audiogubbins/ml-runtime',
    ],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // The detection worker: a target's processed audio read through the
    // engine, the detectors and assistants run over it in one pass, and the
    // findings and recommendations answered as data (ADR-0061, ADR-0062).
    // No browser: the worker's scope is declared by its shape.
    dir: 'packages/detection-runtime',
    name: '@audiogubbins/detection-runtime',
    description:
      "The detection worker: a target's processed audio read once, its detectors and assistants run over it, and the findings and recommendations answered as data.",
    dom: false,
    jsx: false,
    portable: true,
    threads: { 'detection-worker.ts': 'dedicated-worker' },
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/audio-engine',
      '@audiogubbins/effect-rack',
      '@audiogubbins/processors',
      '@audiogubbins/ml-runtime',
    ],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // The renderer contract and its WebGPU, WebGL2 and Canvas 2D backends,
    // with the choice among them and recovery from a lost device (ADR-0040,
    // ADR-0044). Given its canvases and the GPU object; it reads no global.
    dir: 'packages/renderer',
    name: '@audiogubbins/renderer',
    description:
      'The editor renderer: frames as values, WebGPU, WebGL2 and Canvas 2D backends, and recovery from a lost device.',
    dom: true,
    jsx: false,
    deps: ['@audiogubbins/domain'],
    devDeps: [],
    // The WebGPU definitions the backend compiles against, which the DOM's
    // lack; types alone, so nothing of it reaches the bundle.
    external: { '@webgpu/types': '0.1.74' },
    externalDev: {},
  },
  {
    // Picture as reference media: its binding to the shared media clock,
    // frame arithmetic, calibration and the synchronisation policy (ADR-0040,
    // ADR-0046). The video element belongs to the application.
    dir: 'packages/video-reference',
    name: '@audiogubbins/video-reference',
    description:
      'Video as reference media: its binding to the media clock, exact frame arithmetic, calibration and synchronisation.',
    dom: false,
    jsx: false,
    portable: true,
    deps: ['@audiogubbins/domain', '@audiogubbins/timeline'],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    // One editor view as values: presentation state, lanes, hit testing, the
    // tools' interpretation of a pointer, snap targets and the composition of
    // a render frame (ADR-0040). No framework and no browser global.
    dir: 'packages/editor-view',
    name: '@audiogubbins/editor-view',
    description:
      'One editor view as values: its presentation state, lanes, tools, hit testing, snapping and the frames it draws.',
    dom: true,
    jsx: false,
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/input',
      '@audiogubbins/timeline',
      '@audiogubbins/waveform',
      '@audiogubbins/renderer',
    ],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    dir: 'packages/commands',
    name: '@audiogubbins/commands',
    description:
      'Typed command contracts, registry, validation and execution. The only sanctioned route to a project mutation.',
    dom: false,
    jsx: false,
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/diagnostics',
      '@audiogubbins/input',
      '@audiogubbins/text',
      '@audiogubbins/version',
    ],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    dir: 'packages/capabilities',
    name: '@audiogubbins/capabilities',
    description:
      'Runtime capability detection and degradation descriptors. The only package that probes the browser directly.',
    dom: true,
    jsx: false,
    deps: ['@audiogubbins/domain', '@audiogubbins/diagnostics', '@audiogubbins/text'],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    dir: 'packages/design-system',
    name: '@audiogubbins/design-system',
    description:
      'AudioGubbins semantic design tokens, theme engine and accessible React primitives. Knows nothing of the domain.',
    dom: true,
    jsx: true,
    deps: ['@audiogubbins/version'],
    devDeps: [],
    // Motion, which ADR-0001 names for shell animation, is not declared here
    // until something imports it. A dependency a package does not use is an
    // install and a supply-chain surface it does not need, and the themes'
    // motion levels are carried by CSS transitions today.
    external: { 'radix-ui': '1.6.7', react: '19.3.0', 'react-dom': '19.3.0' },
    externalDev: {},
  },
  {
    dir: 'packages/workspace',
    name: '@audiogubbins/workspace',
    description:
      'Dockable workspace contracts, layout persistence and presets, with Dockview contained behind an adapter.',
    dom: true,
    jsx: true,
    deps: ['@audiogubbins/diagnostics', '@audiogubbins/text', '@audiogubbins/version'],
    devDeps: ['@audiogubbins/test-fixtures'],
    // REQ-ARCH-151 names Dockview as the docking engine. From version 8 the
    // React bindings are published separately from the framework-agnostic core,
    // so both are declared; they are one project at one version.
    external: {
      dockview: '8.3.1',
      'dockview-react': '8.3.1',
      react: '19.3.0',
      'react-dom': '19.3.0',
    },
    externalDev: {},
  },
  {
    // The authoritative, versioned project and every form it is written in:
    // the aggregate the history and the journal replay, its runtime-validated
    // document, content identity, the portable bundle and the unpacked tree
    // (ADR-0015, ADR-0020). Pure: bytes reach it through ports.
    dir: 'packages/project-format',
    name: '@audiogubbins/project-format',
    description:
      'The authoritative, versioned AudioGubbins project and the forms it is written in: its validated document, content identity, the portable bundle and the unpacked tree.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/domain', '@audiogubbins/text', '@audiogubbins/version'],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The commands that change a project, as the packet's
    // `packages/commands/project` asks, in a package of their own so the
    // architecture rules read it apart from the machinery (ADR-0020).
    dir: 'packages/project-commands',
    name: '@audiogubbins/project-commands',
    description:
      'The typed commands that change an AudioGubbins project, each with its inverse, deterministic under replay.',
    dom: false,
    jsx: false,
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/commands',
      '@audiogubbins/project-format',
      '@audiogubbins/text',
    ],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // What copying and pasting audio mean: the payload a copy takes from an
    // edit plan, and how a paste fits it to the asset it joins (ADR-0053).
    dir: 'packages/clipboard',
    name: '@audiogubbins/clipboard',
    description:
      'Copying and pasting audio: the payload a copy takes from an edit plan, with the records of the media it reads, and how a paste fits it to its destination.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/domain', '@audiogubbins/project-format', '@audiogubbins/text'],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // Branching history as values: the graph of changes, where the project
    // stands in it, named snapshots, A/B comparison and what compaction may
    // remove (ADR-0006, ADR-0020).
    dir: 'packages/history',
    name: '@audiogubbins/history',
    description:
      'The branching project history: its graph of changes, the current node, named snapshots, whole-project comparison and the planning of compaction.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/domain', '@audiogubbins/commands', '@audiogubbins/project-format'],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // Source media by content: the shared object store, how an external file
    // is known again, and which objects anything still reaches (ADR-0020).
    dir: 'packages/media-store',
    name: '@audiogubbins/media-store',
    description:
      'Content-addressed source media: the shared object store, external source identity and reachability.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/domain', '@audiogubbins/project-format'],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // Model packs (ADR-0062): the manifest and its reader, the install state
    // machine, the integrity check and the streaming SHA-256 it runs on, the
    // installer over a source port and a store port, and which processors a
    // pack makes available. The download adapter is one of the two modules in
    // the repository that reach the network. Not portable: its ports speak the
    // project format's byte ports, which the storage packages implement, and
    // the storage package keeps packs.
    dir: 'packages/model-packs',
    name: '@audiogubbins/model-packs',
    description:
      'Model packs: the manifest, the install state machine, the integrity check, the installer, the download adapter and which processors a pack makes available.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/domain', '@audiogubbins/ml-runtime', '@audiogubbins/project-format'],
    devDeps: [],
    // MIT, audited, with no dependencies: the streaming SHA-256 the integrity
    // check runs, the same code in the browser and in Node, since Web Crypto
    // hashes only a whole buffer. Pinned exactly, as every dependency is.
    external: { '@noble/hashes': '2.4.0' },
    externalDev: {},
    // The pack path, version, tier, capability and limit grammars, which the
    // pack build tool loads in Node and the build's configuration bundles.
    javascript: true,
  },
  {
    // Keeping projects: the journal, snapshots, sessions, leases, backups and
    // cleanup, over a backend port, so no browser API is reached from here
    // (ADR-0002, ADR-0020).
    dir: 'packages/storage',
    name: '@audiogubbins/storage',
    description:
      'Keeping AudioGubbins projects safe over a storage backend port: journal, snapshots, sessions, write leases, backups and cleanup.',
    dom: false,
    jsx: false,
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/codecs',
      '@audiogubbins/commands',
      '@audiogubbins/diagnostics',
      '@audiogubbins/history',
      '@audiogubbins/media-store',
      '@audiogubbins/model-packs',
      '@audiogubbins/project-format',
      '@audiogubbins/text',
      '@audiogubbins/version',
    ],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The browser beneath the storage ports: the origin-private file system
    // through a worker, Web Locks, kept file handles and the pickers
    // (ADR-0020).
    dir: 'packages/browser-storage',
    name: '@audiogubbins/browser-storage',
    description:
      'The browser implementations of the storage ports: the origin-private file system, Web Locks, kept file handles and the file pickers.',
    dom: true,
    jsx: false,
    deps: [
      '@audiogubbins/diagnostics',
      '@audiogubbins/media-store',
      '@audiogubbins/project-format',
      '@audiogubbins/storage',
    ],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: {},
    externalDev: {},
  },
  {
    // The browser host of project storage: the storage worker, the typed port
    // between it and the page, and the page's client (ADR-0022).
    dir: 'packages/storage-runtime',
    name: '@audiogubbins/storage-runtime',
    description:
      "The browser host of project storage: the storage worker, the typed messages between it and the page, and the page's client.",
    dom: true,
    jsx: false,
    threads: { 'storage-worker.ts': 'dedicated-worker' },
    deps: [
      '@audiogubbins/domain',
      '@audiogubbins/diagnostics',
      '@audiogubbins/capabilities',
      '@audiogubbins/commands',
      '@audiogubbins/history',
      '@audiogubbins/project-format',
      '@audiogubbins/project-commands',
      '@audiogubbins/media-store',
      '@audiogubbins/storage',
      '@audiogubbins/browser-storage',
      '@audiogubbins/processors',
      '@audiogubbins/model-packs',
      '@audiogubbins/text',
    ],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    dir: 'packages/test-fixtures',
    name: '@audiogubbins/test-fixtures',
    description:
      'Deterministic reusable fixtures for AudioGubbins tests, and the measures of what a piece of work costs: its processor time against another, and the comparisons of names it makes. Never imported by production code.',
    dom: false,
    jsx: false,
    deps: ['@audiogubbins/domain'],
    devDeps: [],
    external: {},
    externalDev: {},
  },
  {
    dir: 'apps/web',
    name: '@audiogubbins/web',
    description: 'The AudioGubbins progressive web application shell.',
    dom: true,
    jsx: true,

    // The bundler owns `dist/`, and a static host uploads whatever is in it.
    // The declaration output and the incremental build state have to go
    // somewhere else, or `pnpm typecheck` would publish them and `pnpm build`
    // would delete them, depending on which ran last.
    bundled: true,
    deps: [
      '@audiogubbins/commands',
      '@audiogubbins/capabilities',
      '@audiogubbins/design-system',
      '@audiogubbins/workspace',
      '@audiogubbins/diagnostics',
      '@audiogubbins/input',
      '@audiogubbins/text',
      '@audiogubbins/version',
      '@audiogubbins/domain',
      '@audiogubbins/project-format',
      '@audiogubbins/project-commands',
      '@audiogubbins/history',
      '@audiogubbins/media-store',
      '@audiogubbins/storage',
      '@audiogubbins/browser-storage',
      '@audiogubbins/storage-runtime',
      '@audiogubbins/audio-graph',
      '@audiogubbins/audio-engine',
      '@audiogubbins/audio-runtime',
      '@audiogubbins/timeline',
      '@audiogubbins/waveform',
      '@audiogubbins/renderer',
      '@audiogubbins/editor-view',
      '@audiogubbins/video-reference',
      '@audiogubbins/clipboard',
      '@audiogubbins/processors',
      '@audiogubbins/detection-runtime',
      '@audiogubbins/ml-runtime',
      '@audiogubbins/model-packs',
    ],
    devDeps: ['@audiogubbins/test-fixtures'],
    external: { react: '19.3.0', 'react-dom': '19.3.0' },
    externalDev: {
      '@vitejs/plugin-react': '6.1.1',
      vite: '8.3.0',
      'vite-plugin-pwa': '1.3.0',
    },
  },
];

const DIR_BY_NAME = new Map(PACKAGES.map((p) => [p.name, p.dir]));

const SPEC_BY_NAME = new Map(PACKAGES.map((p) => [p.name, p]));

/**
 * Whether a package's own modules, or a package it reaches through its
 * dependencies, are written in JavaScript. A dependency's types reach an
 * editor and the type-aware linter through its source, which they read with
 * the dependent's own options, so a dependent that did not allow JavaScript
 * would read those modules' JSDoc types as nothing and every value they type
 * as one it cannot resolve.
 *
 * @param {PackageSpec} spec
 * @param {Set<string>} [seen]
 * @returns {boolean}
 */
function readsJavaScript(spec, seen = new Set()) {
  if (spec.javascript === true) return true;
  return [...spec.deps, ...spec.devDeps].some((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    const dependency = SPEC_BY_NAME.get(name);
    return dependency !== undefined && readsJavaScript(dependency, seen);
  });
}

/**
 * Tooling every package needs to typecheck and test itself. REQ-REPO-186
 * prohibits relying on an undeclared transitive dependency, and pnpm's isolated
 * node_modules means a package really cannot resolve what it has not declared.
 */
const UNIVERSAL_DEV_DEPENDENCIES = { vitest: '5.0.1' };

/** A package with no tests of its own declares no test runner. */
const WITHOUT_TESTS = new Set(['@audiogubbins/version']);

/** Additional tooling for packages that render React components in tests. */
const REACT_TEST_DEV_DEPENDENCIES = {
  '@testing-library/react': '16.3.3',
  '@testing-library/user-event': '14.6.7',
  '@testing-library/jest-dom': '7.0.1',
  '@types/react': '19.3.0',
  '@types/react-dom': '19.3.0',
  jsdom: '30.1.0',
};

/** Package manifest. Internal packages are consumed as TypeScript source. */
function manifestFor(spec) {
  const dependencies = Object.fromEntries([
    ...spec.deps.map((name) => [name, 'workspace:*']),
    ...Object.entries(spec.external),
  ]);

  const manifest = {
    name: spec.name,
    version: PRODUCT_VERSION,
    private: true,
    description: spec.description,
    license: 'Apache-2.0',
    type: 'module',
    exports: {
      '.': {
        types: './src/index.ts',
        default: './src/index.ts',
      },

      // Stylesheets are a declared entry point rather than a deep path into
      // src/. The architecture rules forbid reaching past a package's public
      // entry, and a bundler enforces the same thing through this map. Declared
      // only by a package that has stylesheets: declared by every package, it
      // would give each leaf without one a public path to a directory it does
      // not have.
      ...(hasStylesheets(spec) ? { './styles/*.css': './src/styles/*.css' } : {}),

      // Modules the browser loads as a worklet or a worker, by URL.
      ...(hasThreadEntries(spec) ? { './threads/*': './src/threads/*' } : {}),

      // Modules another package's thread imports on their own.
      ...Object.fromEntries(
        Object.entries(spec.entries ?? {}).map(([path, module]) => [
          path,
          { types: module, default: module },
        ]),
      ),

      // Test support another package's tests take, where there is any. No
      // production module may import it, whatever path it uses, which an
      // architecture rule refuses rather than this map.
      ...(hasTestSupportEntry(spec)
        ? {
            './testing': {
              types: './src/testing/index.ts',
              default: './src/testing/index.ts',
            },
          }
        : {}),
    },
    main: './src/index.ts',
    types: './src/index.ts',
    files: ['src'],
    // What the bundler may drop when nothing uses it. A package without the
    // browser runs nothing when it is imported, so all of it may go; a
    // package with thread entries runs those, as their global scope loads
    // them, and nothing else. Undeclared elsewhere, where a stylesheet or a
    // registration may run on import, so the bundler keeps what it cannot
    // prove unused. Declared, the first paint no longer carries the audio
    // engine the shell only loads when audio is first used.
    sideEffects: spec.dom ? (hasThreadEntries(spec) ? ['./src/threads/*'] : undefined) : false,
    scripts: {
      typecheck: 'tsc --build',
      // Runs the package's own project from the root configuration, so that
      // `pnpm test --filter <package>` runs its tests: without a script of its
      // own a filtered run selects the package, finds nothing to run and
      // passes.
      test: `vitest run --root ${'../'.repeat(spec.dir.split('/').length)} --project ${vitestProjectFor(spec).name}`,
    },
  };

  const devDependencies = {
    ...Object.fromEntries(spec.devDeps.map((name) => [name, 'workspace:*'])),
    ...(WITHOUT_TESTS.has(spec.name) ? {} : UNIVERSAL_DEV_DEPENDENCIES),
    ...(spec.jsx ? REACT_TEST_DEV_DEPENDENCIES : {}),
    ...spec.externalDev,
  };

  if (Object.keys(dependencies).length > 0) manifest.dependencies = dependencies;
  // Omitted rather than written empty, as `dependencies` is: a package with no
  // test runner declares nothing, and an empty object says it considered it.
  if (Object.keys(devDependencies).length > 0) {
    manifest.devDependencies = Object.fromEntries(
      Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  if (spec.name === '@audiogubbins/web') {
    manifest.exports = undefined;
    manifest.main = undefined;
    manifest.types = undefined;
    manifest.files = undefined;
    manifest.scripts = {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
      typecheck: 'tsc --build',
      test: manifest.scripts.test,
    };
  }

  return Object.fromEntries(Object.entries(manifest).filter(([, v]) => v !== undefined));
}

/**
 * The Vitest project a package's tests run in.
 *
 * The environment follows from the two facts the declaration already carries.
 * A package that touches no DOM runs under Node, so a test cannot prove domain
 * code works by leaning on a browser global the package is forbidden to use
 * (REQ-ARCH-151, REQ-EXEC-184); one that probes the browser gets jsdom and the
 * global stubs; one that renders React gets jsdom, the React setup and `.tsx`
 * files as well.
 *
 * Generated rather than written out again: written by hand, as arrays in
 * `vitest.config.ts`, the list could leave a package out, and a test added
 * there would be collected by no project and reported missing by nothing.
 *
 * @param {PackageSpec} spec
 */
function vitestProjectFor(spec) {
  const depth = spec.dir.split('/').length;
  const setup = `${'../'.repeat(depth)}tests/setup/`;
  return {
    name: spec.dir.split('/').at(-1),
    root: spec.dir,
    environment: spec.dom ? 'jsdom' : 'node',
    include: [spec.jsx ? 'src/**/*.test.{ts,tsx}' : 'src/**/*.test.ts'],
    ...(spec.jsx
      ? { setupFiles: [`${setup}react-testing.ts`] }
      : spec.dom
        ? { setupFiles: [`${setup}browser-globals.ts`] }
        : {}),
  };
}

/** Compiler configuration. `lib` and `references` encode the architecture. */
function tsconfigFor(spec) {
  const depth = spec.dir.split('/').length;
  const toRoot = '../'.repeat(depth);

  const lib = spec.dom ? ['ES2023', 'DOM', 'DOM.Iterable'] : ['ES2023'];

  // A bundled application's `dist/` is what a static host serves, so the
  // compiler writes its declarations and its build state beside it rather than
  // into it. A library package has no deployable output, so `dist/` is its own.
  const output = spec.bundled ? './build' : './dist';

  const config = {
    extends: `${toRoot}tsconfig.base.json`,
    compilerOptions: {
      lib,
      outDir: `${output}/types`,
      rootDir: './src',
      tsBuildInfoFile: `${output}/tsconfig.tsbuildinfo`,
      emitDeclarationOnly: true,
    },
    include: [
      'src/**/*.ts',
      ...(spec.jsx ? ['src/**/*.tsx'] : []),
      ...(spec.javascript === true ? ['src/**/*.js'] : []),
    ],
    exclude: ['dist', ...(spec.bundled ? ['build'] : [])],
    references: [...spec.deps, ...spec.devDeps].map((name) => ({
      path: `${toRoot}${DIR_BY_NAME.get(name)}`,
    })),
  };

  if (spec.jsx) {
    config.compilerOptions.jsx = 'react-jsx';
  }
  if (readsJavaScript(spec)) config.compilerOptions.allowJs = true;
  // Checked where they are written; a dependent reads them as checked.
  if (spec.javascript === true) config.compilerOptions.checkJs = true;
  if (config.references.length === 0) delete config.references;

  return config;
}

/**
 * The modules under a package's `src/threads/`, read from the tree, which are
 * the ones a global scope other than the page's loads.
 *
 * @param {PackageSpec} spec
 */
function threadEntries(spec) {
  const threads = join(REPO_ROOT, spec.dir, 'src', 'threads');
  if (!existsSync(threads)) return [];
  return readdirSync(threads)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}

/**
 * The projects that compile a package's modules again in the global scopes
 * they run in, one in `scopes/<scope>/` for each: a portable package's whole
 * source in `any`, and each thread entry, with everything it imports from the
 * package, in the scope declared for it. They check and emit nothing more,
 * and read the packages they import as those packages' own projects built
 * them, so each package's source is checked in its scope by its own project.
 *
 * @param {PackageSpec} spec
 * @returns {[ThreadScope, Record<string, unknown>][]}
 */
function scopeProjectsFor(spec) {
  const toRoot = '../'.repeat(spec.dir.split('/').length + 2);
  /**
   * @param {ThreadScope} scope
   * @param {Record<string, string[]>} sources
   */
  const project = (scope, sources) => {
    const { lib, declarations } = SCOPES[scope];
    return [
      scope,
      {
        $comment: `Generated by tools/sync-workspace-graph.mjs. The package's modules that run in the ${scope} scope, checked with that scope's definitions and no others.`,
        extends: `${toRoot}tsconfig.base.json`,
        compilerOptions: {
          composite: false,
          declaration: false,
          declarationMap: false,
          noEmit: true,
          lib,
          types: [],
          tsBuildInfoFile: `../../dist/scope-${scope}.tsbuildinfo`,
        },
        ...(declarations === undefined
          ? sources
          : { ...sources, files: [...(sources.files ?? []), declarations] }),
        references: spec.deps.map((name) => ({ path: `${toRoot}${DIR_BY_NAME.get(name)}` })),
      },
    ];
  };

  const projects = [];
  if (spec.portable) {
    projects.push(
      project('any', {
        include: ['../../src/**/*.ts'],
        exclude: ['../../src/**/*.test.ts', '../../src/testing/**'],
      }),
    );
  }
  const entriesByScope = new Map();
  for (const entry of threadEntries(spec)) {
    const scope = spec.threads?.[entry];
    entriesByScope.set(scope, [...(entriesByScope.get(scope) ?? []), entry]);
  }
  for (const [scope, entries] of entriesByScope) {
    projects.push(project(scope, { files: entries.map((entry) => `../../src/threads/${entry}`) }));
  }
  return projects;
}

/**
 * A portable package whose dependency is not portable, or a thread entry
 * whose scope is not declared, would leave code unchecked in the scope it
 * runs in, so the declaration is refused before anything is written.
 */
const unscoped = PACKAGES.flatMap((spec) => [
  ...(spec.portable
    ? spec.deps
        .filter((name) => !PACKAGES.find((one) => one.name === name)?.portable)
        .map((name) => `  - ${spec.name} is portable, but depends on ${name}, which is not`)
    : []),
  ...threadEntries(spec)
    .filter((entry) => !Object.hasOwn(SCOPES, spec.threads?.[entry] ?? ''))
    .map((entry) => `  - ${spec.name}: src/threads/${entry} declares no scope in \`threads\``),
  ...Object.keys(spec.threads ?? {})
    .filter((entry) => !threadEntries(spec).includes(entry))
    .map((entry) => `  - ${spec.name}: \`threads\` names src/threads/${entry}, which is absent`),
]);
if (unscoped.length > 0) {
  console.error(
    `The workspace graph leaves code unchecked in the scope it runs in:\n${unscoped.join('\n')}`,
  );
  process.exit(1);
}

/**
 * The one AudioGubbins package a package's tests may take without the package
 * running with it (ADR-0019). Any other named in `devDeps` would let the
 * package's tests import it past the layering, so the declaration is refused
 * before anything is written or checked.
 */
const FIXTURES = '@audiogubbins/test-fixtures';

const refused = PACKAGES.flatMap((spec) =>
  spec.devDeps.filter((name) => name !== FIXTURES).map((name) => `  - ${spec.name}: ${name}`),
);
if (refused.length > 0) {
  console.error(
    `The workspace graph declares for tests a package other than ${FIXTURES}:\n` +
      refused.join('\n') +
      '\n\nA package declares in `devDeps` the fixtures package alone (ADR-0019).\n' +
      'Declare a package it runs with in `deps`, where the layering holds it.',
  );
  process.exit(1);
}

const stale = [];

function syncJson(path, value) {
  const desired = `${JSON.stringify(value, null, 2)}\n`;
  let current = null;
  try {
    current = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current === desired) return;

  stale.push(relative(REPO_ROOT, path).replaceAll('\\', '/'));
  if (!CHECK_ONLY) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, desired, 'utf8');
  }
}

for (const spec of PACKAGES) {
  const root = join(REPO_ROOT, spec.dir);
  if (!CHECK_ONLY) mkdirSync(join(root, 'src'), { recursive: true });
  syncJson(join(root, 'package.json'), manifestFor(spec));
  syncJson(join(root, 'tsconfig.json'), tsconfigFor(spec));
  for (const [scope, config] of scopeProjectsFor(spec)) {
    syncJson(join(root, 'scopes', scope, 'tsconfig.json'), config);
  }
}

// The projects `vitest.config.ts` runs each package's tests in.
syncJson(join(REPO_ROOT, 'vitest.projects.json'), {
  $comment:
    'Generated from the PACKAGES declaration in tools/sync-workspace-graph.mjs. One project per workspace package, in the environment its `dom` and `jsx` flags ask for. Run `pnpm graph:sync` after changing a package.',
  projects: PACKAGES.map(vitestProjectFor),
});

// The root solution file drives `tsc --build` across every package in order.
syncJson(join(REPO_ROOT, 'tsconfig.build.json'), {
  $comment:
    'Solution file for `pnpm typecheck`. Project references give tsc the package dependency order, which is the same order the architecture rules enforce.',
  files: [],
  references: [
    ...PACKAGES.flatMap((spec) => [
      { path: `./${spec.dir}` },
      // Each package's modules again, in the global scopes they run in.
      ...scopeProjectsFor(spec).map(([scope]) => ({ path: `./${spec.dir}/scopes/${scope}` })),
    ]),
    // Repository-level tests and shared test setup. Not a package: it ships
    // nothing and nothing imports it, but it is typechecked to the same
    // standard as the code it verifies (REQ-EXEC-180).
    { path: './tests' },
  ],
});

if (stale.length === 0) {
  console.log(`Workspace graph is current: ${PACKAGES.length} packages at ${PRODUCT_VERSION}.`);
} else if (CHECK_ONLY) {
  console.error(
    `The workspace graph is stale in ${stale.length} file(s):\n` +
      stale.map((p) => `  - ${p}`).join('\n') +
      '\n\nThese files are generated from the PACKAGES declaration in\n' +
      'tools/sync-workspace-graph.mjs. Change a package dependency there, run\n' +
      '`pnpm graph:sync`, and commit the result.',
  );
  process.exitCode = 1;
} else {
  console.log(`Updated ${stale.length} file(s):\n` + stale.map((p) => `  - ${p}`).join('\n'));
}
