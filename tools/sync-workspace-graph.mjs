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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 */

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
    deps: ['@audiogubbins/domain'],
    devDeps: [],
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
    deps: ['@audiogubbins/domain', '@audiogubbins/audio-graph'],
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
    deps: ['@audiogubbins/diagnostics', '@audiogubbins/text'],
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
    scripts: {
      typecheck: 'tsc --build',
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
    include: ['src/**/*.ts', ...(spec.jsx ? ['src/**/*.tsx'] : [])],
    exclude: ['dist', ...(spec.bundled ? ['build'] : [])],
    references: [...spec.deps, ...spec.devDeps].map((name) => ({
      path: `${toRoot}${DIR_BY_NAME.get(name)}`,
    })),
  };

  if (spec.jsx) {
    config.compilerOptions.jsx = 'react-jsx';
  }
  if (config.references.length === 0) delete config.references;

  return config;
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
    ...PACKAGES.map((spec) => ({ path: `./${spec.dir}` })),
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
