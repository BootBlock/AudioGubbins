/**
 * Executable architecture constraints for AudioGubbins (REQ-EXEC-184).
 *
 * Every rule here corresponds to a written architectural invariant. A rule is
 * removed or weakened only through a deliberate ADR and architecture review, as
 * REQ-EXEC-184 requires. Adding an exception to silence a violation is not a
 * fix.
 *
 * Layering, from the bottom up:
 *
 *   version         generated product and format versions; no AudioGubbins deps
 *   text            the rules a sentence shown to a reader is held to, and the
 *                   characters a reader sees; zero AudioGubbins deps
 *   domain          framework-agnostic project model, zero AudioGubbins deps
 *   input           mouse, touch, pen and keyboard as values; depends on text
 *   diagnostics     structured local logging, redaction and bundles; depends on
 *                   text + version
 *   audio-graph     the processing graph as a value, its validation, latency
 *                   and plan; depends on domain alone, knows no thread, browser
 *                   or buffer (ADR-0030)
 *   audio-engine    the audio core that runs on any thread; depends on domain
 *                   and audio-graph, knows no browser (ADR-0030)
 *   audio-runtime   the browser host of the engine: context, worklet, render
 *                   worker and their messages; depends on domain, diagnostics,
 *                   capabilities, audio-graph and audio-engine (ADR-0030)
 *   ml-runtime      local inference: the port, its adapter over ONNX Runtime
 *                   Web, which alone imports the runtime and only by import(),
 *                   and the worker that hosts it; depends on domain alone
 *                   (ADR-0062)
 *   timeline        the time axis as values: viewport, formats, ruler, the
 *                   selection set and snapping; depends on domain alone, knows
 *                   no thread or browser (ADR-0040)
 *   recording       the session and monitoring states, capture profiles,
 *                   calibration and diagnostics; depends on domain + text,
 *                   knows no browser, storage or audio host (ADR-0070)
 *   waveform       the peak pyramid, its worker, cache format and column
 *                   reads; depends on domain + audio-engine, knows no browser
 *                   (ADR-0043)
 *   renderer        frames as values and the WebGPU, WebGL2 and Canvas 2D
 *                   backends; depends on domain, reads no global (ADR-0044)
 *   video-reference picture bound to the media clock, frame arithmetic and
 *                   sync; depends on domain + timeline (ADR-0046)
 *   editor-view     one view as values: state, lanes, tools, hit testing,
 *                   snapping and frame composition; depends on domain, input,
 *                   timeline, waveform and renderer (ADR-0040)
 *   commands        typed command contracts; depends on domain + diagnostics +
 *                   input + text + version
 *   capabilities    the only sanctioned browser-capability adapter; depends on
 *                   domain, whose results the media input answers in, and
 *                   diagnostics + text, whose check of how names compare it
 *                   probes
 *   design-system   React/Radix presentation; depends on version, knows nothing
 *                   of the domain
 *   workspace       docking; depends on diagnostics + text + version
 *   test-fixtures   deterministic fixtures and the measures of a cost; depends
 *                   on domain; never shipped
 *   apps/web        composition root; may depend on every public entry point,
 *                   but takes only types and listed values from the packages
 *                   that keep projects, whose core runs in the storage worker
 *                   (ADR-0022; tests/architecture/dependency-rules.test.ts)
 *
 * Phase 02's packages sit between the domain and the application (ADR-0020):
 *
 * - project-format: the authoritative, versioned project and the forms it is
 *   written in; depends on domain + text + version.
 * - project-commands: the commands that change a project; depends on domain +
 *   commands + project-format + text.
 * - history: branching history as values; depends on domain + commands +
 *   project-format.
 * - media-store: content-addressed source media; depends on domain +
 *   project-format.
 * - model-packs: model packs (ADR-0062): the manifest, the install state
 *   machine, the integrity check, the installer over a source port and a store
 *   port, the download over HTTP, one of the two modules that reach the
 *   network, and the streaming SHA-256 the integrity check runs on; depends on
 *   domain + ml-runtime + project-format.
 * - storage: keeping projects, and the model packs installed, over a backend
 *   port; depends on domain + codecs + commands + diagnostics + history +
 *   media-store + model-packs + project-format + version, and on no browser
 *   API.
 * - browser-storage: the browser beneath the storage ports; depends on
 *   diagnostics + media-store + project-format + storage.
 * - storage-runtime: the browser host of project storage, its worker, the port
 *   to the page and the page's client (ADR-0022); depends on browser-storage,
 *   capabilities, commands, diagnostics, domain, history, media-store,
 *   project-commands, project-format, recording and storage, and on
 *   audio-runtime's capture channel reader alone (ADR-0070).
 *
 * The tests of the text and diagnostics packages, and of each Phase 02 package,
 * may take the fixtures package, which their own rules below leave out of what
 * they refuse, and so may the tests of every package no such rule governs
 * (ADR-0019): what a test runs with reaches no one who uses the package, and
 * `fixtures-are-test-only` keeps it out of every production file. The tests of
 * the input and version packages may not, and the domain package's cannot,
 * since the fixtures package depends on it.
 */

/** Packages that are allowed to hold React components. */
const UI_PACKAGES = '^(apps/web|packages/(design-system|workspace))/';

/**
 * A third-party package, as the path a dependency on it resolves to.
 *
 * A rule's `to.path` is matched against the resolved file, which for a package
 * is under `node_modules/`, and through pnpm under
 * `node_modules/.pnpm/<name>@<version>/node_modules/<name>/`. A rule naming a
 * package as `^react` or `^dockview` against that path can never match, and
 * passes whatever imports the package. A package the importer does not declare
 * cannot be resolved from it, and keeps its bare name, which is matched as
 * well.
 */
function thirdParty(names) {
  return `^(${names})(/|$)|(^|/)node_modules/(${names})/`;
}

/**
 * Every kind of dependency on a third-party package, declared or not. A rule
 * that reads only the declared kinds lets an undeclared import through to the
 * rule about declarations, which says nothing of what the import breaks.
 */
const THIRD_PARTY = [
  'npm',
  'npm-dev',
  'npm-optional',
  'npm-peer',
  'npm-no-pkg',
  'npm-unknown',
  'unknown',
];

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular package and module dependencies are prohibited (REQ-REPO-154). A cycle means ' +
        'the ownership boundary between the two modules is wrong, not that the import is awkward.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        'An unreachable module is either dead code or a missing wiring-up. Both are defects; ' +
        'REQ-EXEC-181 forbids leaving speculative production modules behind.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)(eslint|vitest|vite|playwright|prettier)\\.config\\.(js|cjs|mjs|ts)$',
          '^tools/',
          '^tests/',
        ],
      },
      to: {},
    },
    {
      name: 'domain-is-framework-agnostic',
      severity: 'error',
      comment:
        'REQ-ARCH-151 and REQ-EXEC-136.4: the domain model must stay independently testable ' +
        'without rendering a component. It must never import a UI framework or a DOM library.',
      from: {
        path: '^packages/(audio-engine|audio-graph|clipboard|codecs|commands|detection-runtime|domain|editor-view|effect-rack|history|input|media-store|ml-runtime|model-packs|processors|project-commands|project-format|recording|renderer|storage|text|timeline|version|video-reference|waveform)/',
      },
      to: {
        dependencyTypes: THIRD_PARTY,
        path: thirdParty(
          'react|react-dom|radix-ui|@radix-ui/[^/]+|dockview(-core|-react)?|motion|framer-motion',
        ),
      },
    },
    {
      name: 'domain-owns-nothing-else',
      severity: 'error',
      comment:
        'The domain package sits at the bottom of the graph. If it needs something from another ' +
        'AudioGubbins package, the concept belongs in the domain or the dependency is inverted.',
      from: { path: '^packages/domain/' },
      to: { path: '^packages/(?!domain/)' },
    },
    {
      name: 'audio-graph-owns-nothing-else',
      severity: 'error',
      comment:
        'The processing graph is a value and the decisions made from it, below the engine that ' +
        'runs it and the browser runtime that hosts it (ADR-0030). It depends on the domain alone, ' +
        'whose channel layouts and sample counts it is written in, so it can be checked and ' +
        'planned on any thread. It words a count by the text package (ADR-0030 amended).',
      from: { path: '^packages/audio-graph/' },
      to: { path: '^packages/(?!(audio-graph|domain|text)/)' },
    },
    {
      name: 'audio-engine-owns-nothing-else',
      severity: 'error',
      comment:
        'The engine runs on the audio thread, in workers and in tests, so it may know nothing of ' +
        'the browser, the interface or storage: it depends on the domain, the graph and the read ' +
        'contract an edited source reads its files through, and the runtime that hosts it sits ' +
        'above it (ADR-0030, ADR-0052). It words a count by the text package (ADR-0030 amended).',
      from: { path: '^packages/audio-engine/' },
      to: { path: '^packages/(?!(audio-engine|audio-graph|codecs|domain|text)/)' },
    },
    {
      name: 'audio-runtime-owns-nothing-else',
      severity: 'error',
      comment:
        'The browser host of the engine is given what the device offers and runs the engine in ' +
        'the audio thread and in workers (ADR-0030). It depends on the two audio packages below ' +
        'it, the domain, diagnostics and the capabilities it is told, and on no interface, ' +
        'storage or command package. Its thread entries also make the effect rack its workers ' +
        'run chains with (ADR-0061), and the model channel its models run through (ADR-0062).',
      from: { path: '^packages/audio-runtime/' },
      to: {
        path: '^packages/(?!(audio-runtime|audio-engine|audio-graph|capabilities|diagnostics|domain|effect-rack|ml-runtime|processors)/)',
      },
    },
    {
      name: 'ml-runtime-owns-nothing-else',
      severity: 'error',
      comment:
        'Local inference is a port, its adapter over the runtime and the worker that hosts it ' +
        '(ADR-0062). It depends on the domain alone, whose results and cancellation it speaks, ' +
        'so the processors that call it and the application that starts its worker sit above it.',
      from: { path: '^packages/ml-runtime/' },
      to: { path: '^packages/(?!(ml-runtime|domain)/)' },
    },
    {
      name: 'processors-reach-inference-through-its-port',
      severity: 'error',
      comment:
        'A machine-learning processor runs its model through the inference port (ADR-0062): the ' +
        "entry of ml-runtime, and in its tests that package's test support. Its adapter, worker " +
        "and protocol are the application's to start, so a processor runs on any thread and in " +
        'tests with a fake runtime.',
      from: { path: '^packages/processors/' },
      to: {
        path: '^packages/ml-runtime/',
        pathNot: '^packages/ml-runtime/src/(index|testing/index)\\.ts$',
      },
    },
    {
      name: 'onnx-runtime-stays-behind-its-adapter',
      severity: 'error',
      comment:
        'ADR-0062: only the adapter knows ONNX Runtime Web, so replacing the runtime is a change ' +
        'to one module, and the port, the worker client and every processor know none of it.',
      from: { pathNot: '^packages/ml-runtime/src/adapter/onnx-runtime\\.ts$' },
      to: { dependencyTypes: THIRD_PARTY, path: thirdParty('onnxruntime-(web|common)') },
    },
    {
      name: 'sha256-library-stays-behind-its-adapters',
      severity: 'error',
      comment:
        'The hash library is named in two modules alone: the streaming SHA-256 the model packs ' +
        "check their files with, and the adapter that checks the runtime's WebAssembly before " +
        'the runtime has it (ADR-0062), so replacing the library is a change to those two.',
      from: {
        pathNot:
          '^packages/(model-packs/src/adapter/noble-sha256|ml-runtime/src/adapter/onnx-runtime)\\.ts$',
      },
      to: { dependencyTypes: THIRD_PARTY, path: thirdParty('@noble/hashes') },
    },
    {
      name: 'onnx-runtime-loaded-only-when-used',
      severity: 'error',
      comment:
        'REQ-AUDIO-139: the base bundle carries none of the runtime. Its adapter imports it by a ' +
        'dynamic import() on the first session, never statically, so the bundler splits it out.',
      from: { path: '^packages/ml-runtime/src/adapter/onnx-runtime\\.ts$' },
      to: {
        dependencyTypes: THIRD_PARTY,
        path: thirdParty('onnxruntime-(web|common)'),
        dynamic: false,
      },
    },
    {
      name: 'vite-configuration-loads-in-node',
      severity: 'error',
      comment:
        "Vite bundles its configuration's own files but loads a package it imports through Node, " +
        'with no compiler, and a workspace package is TypeScript source: a value imported from ' +
        'one stops `vite`, `vite build` and every browser test before they start. A type is ' +
        "erased, so it may be imported. The model packs' path grammar is imported by its path, " +
        'which Vite bundles, so the development server holds requests to the one grammar.',
      from: { path: '^apps/web/[^/]+[.][cm]?ts$' },
      to: {
        path: '^packages/',
        pathNot: '^packages/model-packs/src/pack-path[.]js$',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'tools-load-only-javascript-grammars',
      severity: 'error',
      comment:
        'A tool runs in Node with no compiler, and a workspace package is TypeScript source, so ' +
        "a tool imports only the model packs' path, version, tier, capability and limit " +
        'grammars, which are JavaScript for that reason: the pack build holds a definition to ' +
        'the package’s own.',
      from: { path: '^tools/' },
      to: {
        path: '^packages/',
        pathNot: '^packages/model-packs/src/pack-(path|version|tier|capability|limits)[.]js$',
      },
    },
    {
      name: 'vite-bundled-grammar-imports-nothing-else',
      severity: 'error',
      comment:
        "The model packs' path, version, tier, capability and limit grammars are loaded by the " +
        "pack build tool in Node and bundled into Vite's configuration by their paths, so they " +
        'import only one another: a package they named would be loaded through Node with no ' +
        'compiler.',
      from: { path: '^packages/model-packs/src/pack-(path|version|tier|capability|limits)[.]js$' },
      to: { pathNot: '^packages/model-packs/src/pack-(path|version|tier|capability|limits)[.]js$' },
    },
    {
      name: 'rack-made-only-in-thread-entries',
      severity: 'error',
      comment:
        'A worker that reads edited sound is given the effect rack as a port (ADR-0060): only the ' +
        'module that starts the thread, and the test support that composes it as that module ' +
        'does, make it, so the cores that render, feed and summarise depend on the port and run ' +
        'in tests with any processing. The same modules give the thread its model channel ' +
        '(ADR-0062), so no core imports the inference runtime (ADR-0030, ADR-0040).',
      from: { path: '^packages/(audio-runtime|waveform)/src/', pathNot: '/src/(threads|testing)/' },
      to: { path: '^packages/(effect-rack|processors|ml-runtime)/' },
    },
    {
      name: 'codecs-owns-nothing-else',
      severity: 'error',
      comment:
        'The read contract parses bytes it is handed through a port into values of the domain, ' +
        'so every thread that plays, renders or summarises a file reads it alike (ADR-0052).',
      from: { path: '^packages/codecs/' },
      to: { path: '^packages/(?!(codecs|domain)/)', pathNot: '^packages/test-fixtures/' },
    },
    {
      name: 'clipboard-owns-nothing-else',
      severity: 'error',
      comment:
        'Copying and pasting read edit plans and the records of the media they name, and nothing ' +
        'that keeps or shows a project (ADR-0053).',
      from: { path: '^packages/clipboard/' },
      to: {
        path: '^packages/(?!(clipboard|domain|project-format|text)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'timeline-owns-nothing-else',
      severity: 'error',
      comment:
        'The timeline is the time axis of the editor as values, below every view that draws it and ' +
        'every command that reads its selection (ADR-0040). It depends on the domain alone, whose ' +
        'sample counts and identifiers it is written in, so it runs in any scope.',
      from: { path: '^packages/timeline/' },
      to: { path: '^packages/(?!(timeline|domain)/)' },
    },
    {
      name: 'recording-owns-nothing-else',
      severity: 'error',
      comment:
        'Recording as values: the session and monitoring states, capture profiles, the ' +
        "calibration's analysis and the diagnostics (ADR-0070). It depends on the domain and text " +
        'alone and knows no browser, storage or audio host; the application composes it with them.',
      from: { path: '^packages/recording/' },
      to: {
        path: '^packages/(?!(recording|domain|text)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'waveform-owns-nothing-else',
      severity: 'error',
      comment:
        'Peaks are derived from sources the engine reads and are drawn by the views above them ' +
        '(ADR-0043). The package depends on the domain and the engine, and its worker entry on ' +
        'the effect rack it reads chains with; it knows no interface or storage: the cache is ' +
        'kept through a port the application implements. Its worker entry runs models through ' +
        'the model channel (ADR-0062).',
      from: { path: '^packages/waveform/' },
      to: {
        path: '^packages/(?!(waveform|audio-engine|domain|effect-rack|ml-runtime|processors)/)',
      },
    },
    {
      name: 'detection-runtime-owns-nothing-else',
      severity: 'error',
      comment:
        "The detection worker reads a target's processed audio through the engine and runs the " +
        'detectors and assistants over it (ADR-0061, ADR-0062). It depends on the domain, the ' +
        'engine and the processors whose detectors and learners it runs, and its thread entry ' +
        'and test support on the effect rack an edited sound is read with, and the entry on the ' +
        'model channel its models run through (ADR-0062); it knows no interface, storage or ' +
        'command package.',
      from: { path: '^packages/detection-runtime/' },
      to: {
        path: '^packages/(?!(detection-runtime|audio-engine|domain|effect-rack|ml-runtime|processors)/)',
      },
    },
    {
      name: 'detection-rack-made-only-in-thread-entries',
      severity: 'error',
      comment:
        'The detection core is given the effect rack as a port (ADR-0060): only the module that ' +
        'starts the worker, and the test support that composes it as that module does, make it, ' +
        'so the core runs in tests with any processing. The same modules give the worker its ' +
        'model channel (ADR-0062), so the core imports no inference runtime (ADR-0061).',
      from: { path: '^packages/detection-runtime/src/', pathNot: '/src/(threads|testing)/' },
      to: { path: '^packages/(effect-rack|ml-runtime)/' },
    },
    {
      name: 'renderer-owns-nothing-else',
      severity: 'error',
      comment:
        'The renderer draws the frames views compose and holds no editor state (ADR-0044, ' +
        'REQ-AUDIO-152). It depends on the domain alone, for its results, and knows no timeline, ' +
        'waveform, command or interface package.',
      from: { path: '^packages/renderer/' },
      to: { path: '^packages/(?!(renderer|domain)/)' },
    },
    {
      name: 'video-reference-owns-nothing-else',
      severity: 'error',
      comment:
        'Video is reference media bound to the media clock, never an editable video domain ' +
        '(REQ-AUDIO-156, ADR-0046). The package depends on the domain and the timeline alone, ' +
        'whose positions and frame rates it is written in.',
      from: { path: '^packages/video-reference/' },
      to: { path: '^packages/(?!(video-reference|timeline|domain)/)' },
    },
    {
      name: 'editor-view-owns-nothing-else',
      severity: 'error',
      comment:
        'A view composes frames from state and turns pointer input into intents the application ' +
        'carries out through commands (ADR-0040). It depends on the packages it is drawn from and ' +
        'knows no command, storage or interface package.',
      from: { path: '^packages/editor-view/' },
      to: {
        path: '^packages/(?!(editor-view|domain|input|timeline|waveform|renderer)/)',
      },
    },
    {
      name: 'input-owns-nothing-else',
      severity: 'error',
      comment:
        'The input model sits below the command layer, which binds its key presses to commands, ' +
        'so it can depend on no AudioGubbins package but the text leaf below it, which owns the ' +
        'characters a reader sees (ADR-0017, amended by ADR-0018).',
      from: { path: '^packages/input/' },
      to: { path: '^packages/(?!(input|text)/)' },
    },
    {
      name: 'version-owns-nothing-else',
      severity: 'error',
      comment:
        'The version package is generated from version.json and is a leaf, like the Rust crate ' +
        'it mirrors. Every package that stores something depends on it, so it can depend on none.',
      from: { path: '^packages/version/' },
      to: { path: '^packages/(?!version/)' },
    },
    {
      name: 'text-owns-nothing-else',
      severity: 'error',
      comment:
        'The text rules sit below every package that reads them, so the package can depend ' +
        'on no AudioGubbins package: whatever it reached would sit below each of its readers, ' +
        'or close a cycle through one of them (ADR-0018). Its tests may take the fixtures ' +
        'package alone, which nothing it ships imports (ADR-0019).',
      from: { path: '^packages/text/' },
      to: { path: '^packages/(?!text/)', pathNot: '^packages/test-fixtures/' },
    },
    {
      name: 'diagnostics-owns-nothing-else',
      severity: 'error',
      comment:
        'Diagnostics sits below everything that logs. Logging from a package it depended on ' +
        'would create a cycle the moment that package logged anything, so it depends on the ' +
        'version package and the text leaf alone, and neither logs anything. Its tests may ' +
        'take the fixtures package as well, which nothing it ships imports (ADR-0019).',
      from: { path: '^packages/diagnostics/' },
      to: {
        path: '^packages/(?!(diagnostics|text|version)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'project-format-owns-nothing-else',
      severity: 'error',
      comment:
        'The project format sits just above the domain it writes, so every Phase 02 package ' +
        'can read it and it can read none of them (ADR-0020); it reads the text leaf for the ' +
        'rule a given name is held to. Its tests may take the fixtures package.',
      from: { path: '^packages/project-format/' },
      to: {
        path: '^packages/(?!(domain|project-format|text|version)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'project-commands-owns-nothing-else',
      severity: 'error',
      comment:
        'A project command reads the project it changes and the command contract, and nothing ' +
        'that keeps or shows a project: replay stays deterministic (ADR-0020). It reads the text ' +
        'leaf for the count a description says (ADR-0018).',
      from: { path: '^packages/project-commands/' },
      to: {
        path: '^packages/(?!(commands|domain|project-commands|project-format|text)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'history-owns-nothing-else',
      severity: 'error',
      comment:
        'History may reference command and domain identifiers but not renderer or interface ' +
        'internals, nor storage: it is the model the journal persists (Phase 02 packet).',
      from: { path: '^packages/history/' },
      to: {
        path: '^packages/(?!(commands|domain|history|project-format)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'media-store-owns-nothing-else',
      severity: 'error',
      comment:
        'Media by content depends on the format that names content and nothing that keeps a ' +
        'project, so storage reads it and not the reverse (ADR-0020).',
      from: { path: '^packages/media-store/' },
      to: {
        path: '^packages/(?!(domain|media-store|project-format)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'model-packs-owns-nothing-else',
      severity: 'error',
      comment:
        'Model packs speak the domain, the identity of the runtime a pack runs on and the ' +
        "project format's byte ports, and keep packs through a store port that storage " +
        'implements from above, so they know no storage, browser or interface (ADR-0062).',
      from: { path: '^packages/model-packs/' },
      to: { path: '^packages/(?!(domain|ml-runtime|model-packs|project-format)/)' },
    },
    {
      name: 'storage-owns-nothing-else',
      severity: 'error',
      comment:
        'Storage depends on domain and project-format contracts, and on the read contract an ' +
        'import opens a file with, not the interface, and on no browser adapter: the browser ' +
        'implements its ports from above (Phase 02 packet, ADR-0020, ADR-0052). It keeps model ' +
        "packs through the model packs' store port (ADR-0062).",
      from: { path: '^packages/storage/' },
      to: {
        path: '^packages/(?!(codecs|commands|diagnostics|domain|history|media-store|model-packs|project-format|storage|text|version)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'browser-storage-owns-nothing-else',
      severity: 'error',
      comment:
        'The browser adapters implement the storage ports and know nothing of the interface ' +
        'that composes them (ADR-0020).',
      from: { path: '^packages/browser-storage/' },
      to: {
        path: '^packages/(?!(browser-storage|diagnostics|media-store|project-format|storage)/)',
        pathNot: '^packages/test-fixtures/',
      },
    },
    {
      name: 'storage-runtime-owns-nothing-else',
      severity: 'error',
      comment:
        'The browser host of project storage composes the storage packages and their browser ' +
        "adapters in a worker and serves them to the page (ADR-0022), the model packs' installer " +
        'among them (ADR-0062), and records what the capture worklet sends it (ADR-0071). It ' +
        'knows nothing of the interface that calls it, nor of the audio packages beyond the ' +
        "capture channel's reader (ADR-0070).",
      from: { path: '^packages/storage-runtime/' },
      to: {
        path: '^packages/(?!(audio-runtime|browser-storage|capabilities|commands|diagnostics|domain|history|media-store|model-packs|processors|project-commands|project-format|recording|storage|storage-runtime|text)/)',
      },
    },
    {
      name: 'storage-runtime-reads-only-the-capture-channel',
      severity: 'error',
      comment:
        "The storage worker reads the capture worklet's channel with the audio runtime's reader " +
        '(ADR-0070, ADR-0071), its `./capture-channel` entry, which compiles in a worker; the ' +
        'rest of the audio runtime makes audio nodes and runs on the page.',
      from: { path: '^packages/storage-runtime/' },
      to: {
        path: '^packages/audio-runtime/',
        pathNot: '^packages/audio-runtime/src/capture/capture-reader\\.ts$',
      },
    },
    {
      name: 'design-system-knows-no-domain',
      severity: 'error',
      comment:
        'REQ-UX-155: the design system owns presentation. A design-system component that knows ' +
        'about projects, assets or commands cannot be reused or themed independently.',
      from: { path: '^packages/design-system/' },
      to: { path: '^packages/(domain|commands|workspace|capabilities)/' },
    },
    {
      name: 'dockview-stays-behind-workspace',
      severity: 'error',
      comment:
        'REQ-ARCH-151 and REQ-UX-057: Dockview is wrapped behind AudioGubbins-owned workspace ' +
        'contracts. Importing it anywhere else couples the application to the docking engine.',
      // The adapter module alone, not the directory it is in. Its siblings hold
      // no engine type and none of them may start to, which is what keeps the
      // arrangement reader apart from it.
      from: { pathNot: '^packages/workspace/src/adapter/dockview-adapter\\.tsx$' },
      to: { dependencyTypes: THIRD_PARTY, path: thirdParty('dockview(-core|-react)?') },
    },
    {
      name: 'radix-stays-behind-design-system',
      severity: 'error',
      comment:
        'REQ-UX-155: AudioGubbins builds its own design system on top of Radix. Consuming Radix ' +
        'directly from a feature bypasses the token system and the accessibility wrappers.',
      from: { pathNot: '^packages/design-system/src/primitives/' },
      to: { dependencyTypes: THIRD_PARTY, path: thirdParty('radix-ui|@radix-ui/[^/]+') },
    },
    {
      name: 'no-deep-cross-package-imports',
      severity: 'error',
      comment:
        'REQ-REPO-186 and REQ-EXEC-136.3: cross-package access uses the public entry point. ' +
        'Reaching into another package src/ makes its internals a de facto public contract. ' +
        'A package importing its own modules is not a cross-package import, so the rule ' +
        'compares the owning package of both ends; a rule that did not would report ' +
        'every ordinary import inside every package.',
      from: { path: '^(?:apps|packages)/([^/]+)/' },
      to: {
        path: '^packages/([^/]+)/src/',
        pathNot: [
          // The same package. `$1` is the package name captured from `from`.
          '^packages/$1/',

          // The public entry point, which is what a cross-package import resolves to.
          '^packages/[^/]+/src/index\\.ts$',

          // A stylesheet the package declares as an entry point in its exports map.
          '^packages/[^/]+/src/styles/[^/]+\\.css$',

          // Test support a package declares as an entry point. Reaching it
          // from production code is refused by the rule below, not by this
          // one, so the path being public costs nothing.
          '^packages/[^/]+/src/testing/index\\.ts$',

          // A module a package declares as a thread entry point, which the
          // browser loads by URL in its own global scope (ADR-0030).
          '^packages/[^/]+/src/threads/[^/]+\\.ts$',

          // The model packs' path grammar, which the build's configuration
          // bundles by its path (rule vite-configuration-loads-in-node).
          '^packages/model-packs/src/pack-path\\.js$',

          // The audio runtime's capture channel reader, its `./capture-channel`
          // entry, which the storage worker reads a take with (ADR-0070).
          '^packages/audio-runtime/src/capture/capture-reader\\.ts$',
        ],
      },
    },
    {
      name: 'fixtures-are-test-only',
      severity: 'error',
      comment:
        'REQ-REPO-191: deterministic fixtures exist for tests. Shipping one in production code ' +
        'would be exactly the fabricated production data REQ-EXEC-181 forbids.',
      // Support under `src/testing/` is test code here, as it is to the
      // architecture tests, which refuse a production import of it.
      from: {
        pathNot: '\\.(test|spec|bench)\\.(ts|tsx)$|/testing/|^tests/|^packages/test-fixtures/',
      },
      to: { path: '^packages/test-fixtures/' },
    },
    {
      name: 'no-ui-in-non-ui-packages',
      severity: 'error',
      comment:
        'React belongs in the UI layer. A .tsx file elsewhere signals that presentation has ' +
        'leaked into a package that should stay renderable-free.',
      from: { path: '^packages/', pathNot: UI_PACKAGES },
      to: { path: '\\.tsx$' },
    },
    {
      name: 'no-dev-dep-in-production-code',
      severity: 'error',
      comment:
        'REQ-REPO-186: application dependencies, tooling and test-only dependencies stay separate. ' +
        'A devDependency reached from shipped code breaks a production install.',
      from: {
        path: '^(apps|packages)/[^/]+/src/',

        // Tests and the modules that exist only to support them legitimately
        // reach for test tooling. `src/testing/` is where that support lives,
        // and the architecture tests exclude the same directory from what they
        // treat as production source, so the two agree about what ships.
        pathNot: '\\.(test|spec|bench)\\.(ts|tsx)$|/__tests__/|/testing/',
      },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-undeclared-dependencies',
      severity: 'error',
      comment:
        'REQ-REPO-186 prohibits relying on an undeclared transitive dependency. Declare it in ' +
        "the importing package's own package.json.",
      from: {},
      to: {
        dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'],

        // A workspace package resolves through a pnpm symlink to a path inside
        // the repository rather than inside node_modules, so dependency-cruiser
        // cannot attribute it to a manifest entry and reports it as
        // undetermined. Those dependencies are declared, as `workspace:*`.
        //
        // What this exclusion costs, said exactly. pnpm's strict layout stops
        // most of it: hoisting is off, so nothing resolves a transitive
        // dependency it did not declare. Not all of it — the root manifest
        // declares three workspace packages for the tests project, so those
        // three are reachable from any file by the upward lookup every resolver
        // makes. What stops those is the rule in
        // tests/architecture/dependency-rules.test.ts that a package imports no
        // AudioGubbins package its manifest does not declare: it reads every
        // file under each package's and the application's `src/`, tests and
        // test support with them. The composite build stops them again, since
        // the importing package references no project the source is in, so the
        // typecheck fails.
        //
        // The application's own build also serves a module no manifest can
        // declare: the canonical DSP module's bytes, built from the crates by
        // the Vite configuration's plugin under the `virtual:audiogubbins/`
        // prefix, which only that plugin resolves.
        pathNot: ['^packages/[^/]+/src/', '^virtual:audiogubbins/'],
      },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    // Generated output, never source. `build/` holds the bundled application's
    // declaration output, which is kept out of `dist/` because a static host
    // uploads `dist/` verbatim. The repository's own, not a package's: most
    // packages resolve to a file under their own `dist/`, and were that
    // excluded, every dependency on one would be dropped from the graph before
    // any rule read it.
    exclude: {
      path: '^(?:(?:apps|packages|tools)/[^/]+|tests)/(dist|dist-pages|dev-dist|build|coverage)/|^(dist|dist-pages|dev-dist|build|coverage|target|playwright-report|test-results)/',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'types', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
