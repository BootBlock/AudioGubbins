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
 *   timeline        the time axis as values: viewport, formats, ruler, the
 *                   selection set and snapping; depends on domain alone, knows
 *                   no thread or browser (ADR-0040)
 *   waveform        the peak pyramid, its worker, cache format and column
 *                   reads; depends on domain + audio-engine, knows no browser
 *                   (ADR-0043)
 *   renderer        frames as values and the WebGPU, WebGL2 and Canvas 2D
 *                   backends; depends on domain, reads no global (ADR-0044)
 *   commands        typed command contracts; depends on domain + diagnostics +
 *                   input + text + version
 *   capabilities    the only sanctioned browser-capability adapter; depends on
 *                   diagnostics + text, whose check of how names compare it
 *                   probes
 *   design-system   React/Radix presentation; depends on version, knows nothing
 *                   of the domain
 *   workspace       docking; depends on diagnostics + text + version
 *   test-fixtures   deterministic fixtures and the measures of a cost; depends
 *                   on domain; never shipped
 *   apps/web        composition root; may depend on every public entry point
 *
 * The tests of the text and diagnostics packages may take the fixtures package,
 * which their own rules below leave out of what they refuse, and so may the
 * tests of every package no such rule governs (ADR-0019): what a test runs with
 * reaches no one who uses the package, and `fixtures-are-test-only` keeps it
 * out of every production file. The tests of the input and version packages may
 * not, and the domain package's cannot, since the fixtures package depends on
 * it.
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
        path: '^packages/(audio-engine|audio-graph|domain|commands|input|renderer|text|timeline|version|waveform)/',
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
        'planned on any thread.',
      from: { path: '^packages/audio-graph/' },
      to: { path: '^packages/(?!(audio-graph|domain)/)' },
    },
    {
      name: 'audio-engine-owns-nothing-else',
      severity: 'error',
      comment:
        'The engine runs on the audio thread, in workers and in tests, so it may know nothing of ' +
        'the browser, the interface or storage: it depends on the domain and the graph alone, ' +
        'and the runtime that hosts it sits above it (ADR-0030).',
      from: { path: '^packages/audio-engine/' },
      to: { path: '^packages/(?!(audio-engine|audio-graph|domain)/)' },
    },
    {
      name: 'audio-runtime-owns-nothing-else',
      severity: 'error',
      comment:
        'The browser host of the engine is given what the device offers and runs the engine in ' +
        'the audio thread and in workers (ADR-0030). It depends on the two audio packages below ' +
        'it, the domain, diagnostics and the capabilities it is told, and on no interface, ' +
        'storage or command package.',
      from: { path: '^packages/audio-runtime/' },
      to: {
        path: '^packages/(?!(audio-runtime|audio-engine|audio-graph|capabilities|diagnostics|domain)/)',
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
      name: 'waveform-owns-nothing-else',
      severity: 'error',
      comment:
        'Peaks are derived from sources the engine reads and are drawn by the views above them ' +
        '(ADR-0043). The package depends on the domain and the engine alone, and knows no ' +
        'interface or storage: the cache is kept through a port the application implements.',
      from: { path: '^packages/waveform/' },
      to: { path: '^packages/(?!(waveform|audio-engine|domain)/)' },
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
        ],
      },
    },
    {
      name: 'fixtures-are-test-only',
      severity: 'error',
      comment:
        'REQ-REPO-191: deterministic fixtures exist for tests. Shipping one in production code ' +
        'would be exactly the fabricated production data REQ-EXEC-181 forbids.',
      from: { pathNot: '\\.(test|spec|bench)\\.(ts|tsx)$|^tests/|^packages/test-fixtures/' },
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
