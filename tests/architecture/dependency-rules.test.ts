import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPOSITORY_ROOT, forwardSlashes, inRepository } from '../repository.js';
import {
  Counted,
  ORDINALS,
  asLines,
  correctionMarkers,
  countedAs,
  countsByNumber,
  countsByOrdinal,
  numberOfWords,
  roundHeadings,
  roundOfOrdinal,
  sectionCounts,
  sentenceOpening,
} from './correction-counts.js';
import { pathUses } from './path-reading.js';
import { BUILD_OUTPUT_DIRECTORIES, EXCLUDED_AT_THE_ROOT, isTestCode } from './source-kinds.js';
import {
  EVERY_WRITTEN_FILE,
  PRODUCTION_FILES,
  TEST_CODE_FILES,
  parse,
  productionSources,
  read,
  sourcesMatching,
} from './source-reading.js';
import { valuesTaken } from './value-imports.js';

/**
 * Executable architecture constraints (REQ-EXEC-184).
 *
 * dependency-cruiser checks the import graph, and `pnpm test:architecture` runs
 * it alongside this file. These are the constraints a module graph cannot
 * express: which globals a file may use, which text may appear in which
 * package, and whether the layering the rules describe is the layering the
 * manifests declare.
 *
 * Every rule here corresponds to a written invariant. REQ-EXEC-184 forbids
 * weakening one to make a build pass; the way past a failure is to fix the code
 * or to change the architecture deliberately through an ADR.
 *
 * A rule that cannot see a violation passes while the violation is in the tree.
 * So the rules read imports through {@link IMPORT_FORMS} below rather than by
 * matching the literal `from`, which would leave a side-effect import, a
 * dynamic import and a subpath import unseen, and a positive control holds
 * every form.
 */

/**
 * Each file's code, read by the first rule that asks for it and kept for the
 * rest: a file does not change while the rules run, and most of them read the
 * same production files.
 */
const CODE = new Map<string, string>();

/**
 * A source file with its comments removed.
 *
 * The rules about what the code *does* have to read the code. Several files
 * here deliberately name the forbidden APIs in their own documentation,
 * explaining why they are absent, and a rule that read the comments would
 * report every one of those explanations as a violation. The rules about what a
 * file *says*, such as the British-English check, read the whole file instead.
 */
function readCode(path: string): string {
  let code = CODE.get(path);
  if (code === undefined) {
    code = read(path)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n');
    CODE.set(path, code);
  }
  return code;
}

/**
 * Every way a module specifier can be written.
 *
 * The rules below read the specifiers a file imports rather than matching the
 * literal `from`. A matcher anchored on `from` would leave five import forms
 * unseen by every rule built on it, including both of the ones that police
 * cross-package access: a side-effect import, a dynamic import, and the same
 * two written as `export … from`. `apps/web/src/app.tsx` imports its three
 * cross-package stylesheets by side effect.
 *
 * The quote style matters too. A rule written for single quotes alone would be
 * evaded by typing a double quote: `import { Dialog } from "radix-ui"` inside
 * the commands package would pass it. Prettier rewrites that to single quotes,
 * but an architecture rule that only holds once a formatter has run is not a
 * rule.
 */
const IMPORT_FORMS: readonly RegExp[] = [
  // `import … from 'x'` and `export … from 'x'`.
  /\bfrom\s*['"`]([^'"`]+)['"`]/g,

  // `import 'x'`, which runs a module for its side effects alone. This is how
  // every stylesheet in the application is imported.
  /\bimport\s*['"`]([^'"`]+)['"`]/g,

  // `import('x')`, whose specifier the bundler still resolves statically when
  // it is a literal.
  /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

  // `require('x')`, for the tooling that is still CommonJS.
  /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

  // `@import 'x'` in a stylesheet, which is how the docking engine's own
  // stylesheet reaches the build.
  /@import\s*(?:url\(\s*)?['"]([^'"]+)['"]/g,
];

/** Every module specifier in a piece of source text. */
function specifiersIn(code: string): readonly string[] {
  return IMPORT_FORMS.flatMap((pattern) =>
    [...code.matchAll(pattern)].map((match) => match[1] ?? ''),
  );
}

/** Each file's module specifiers, kept as {@link CODE} keeps its code. */
const IMPORTS = new Map<string, readonly string[]>();

/**
 * A triple-slash directive that names a package of type definitions, such as
 * the WebGPU definitions the renderer compiles against. It is a comment to
 * the code reader and a dependency to the compiler, so it is read from the
 * file's text, where it can only stand at the top.
 */
const TYPES_REFERENCE = /^\/\/\/\s*<reference\s+types\s*=\s*['"]([^'"]+)['"]\s*\/>/gmu;

/**
 * Every module specifier a source file imports, comments excluded, with the
 * type packages it references, read once for every rule.
 */
function importsOf(path: string): readonly string[] {
  let specifiers = IMPORTS.get(path);
  if (specifiers === undefined) {
    const referenced = [...read(path).matchAll(TYPES_REFERENCE)].map((match) => match[1] ?? '');
    specifiers = [...specifiersIn(readCode(path)), ...referenced];
    IMPORTS.set(path, specifiers);
  }
  return specifiers;
}

/**
 * The package a specifier names, or `undefined` when it names no package.
 *
 * A subpath belongs to its package: `dockview-core/dist/styles.css` is an
 * import of the docking engine, and a rule that contains the engine has to say
 * so. A pattern anchored at both ends of the package name, matched against the
 * whole specifier, would let every subpath import escape it, so the package is
 * named first.
 */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return undefined;

  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    const [scope, name] = parts;
    return name === undefined ? undefined : `${scope ?? ''}/${name}`;
  }
  return parts[0];
}

/**
 * Whether a file imports a package whose name the pattern matches.
 *
 * The pattern is matched against the package name alone, so it is written
 * anchored and a subpath cannot evade it.
 */
function importsPackage(path: string, pattern: RegExp): boolean {
  return importsOf(path).some((specifier) => {
    const name = packageOf(specifier);
    return name !== undefined && pattern.test(name);
  });
}

/** Every test-support file, which production code may not reach into. */
const TEST_SUPPORT = sourcesMatching('{apps,packages}/*/src/testing/**/*.{ts,tsx}');

/** Every production source file in the workspace. */
const ALL_SOURCES = productionSources('{apps,packages}/*/src/**/*.{ts,tsx}');

/** Every source file in the workspace, its tests and test support with it. */
const EVERY_SOURCE = sourcesMatching('{apps,packages}/*/src/**/*.{ts,tsx}');

/**
 * Every stylesheet the application and its packages ship.
 *
 * Read by the containment rules because a stylesheet imports packages too. The
 * docking engine's own stylesheet is reached by a CSS `@import` and by nothing
 * else, so a rule that read only TypeScript could not see the one import of the
 * engine that exists outside its adapter.
 */
const ALL_STYLESHEETS = sourcesMatching('{apps,packages}/*/src/**/*.css');

/** What each package is allowed to depend on. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  '@audiogubbins/version': [],
  '@audiogubbins/text': [],
  '@audiogubbins/input': ['@audiogubbins/text'],
  '@audiogubbins/domain': [],
  '@audiogubbins/diagnostics': ['@audiogubbins/text', '@audiogubbins/version'],
  '@audiogubbins/audio-graph': ['@audiogubbins/domain', '@audiogubbins/text'],
  '@audiogubbins/codecs': ['@audiogubbins/domain'],
  '@audiogubbins/ml-runtime': ['@audiogubbins/domain'],
  '@audiogubbins/clipboard': [
    '@audiogubbins/domain',
    '@audiogubbins/project-format',
    '@audiogubbins/text',
  ],
  '@audiogubbins/timeline': ['@audiogubbins/domain'],
  '@audiogubbins/renderer': ['@audiogubbins/domain'],
  '@audiogubbins/editor-view': [
    '@audiogubbins/domain',
    '@audiogubbins/input',
    '@audiogubbins/timeline',
    '@audiogubbins/waveform',
    '@audiogubbins/renderer',
  ],
  '@audiogubbins/video-reference': ['@audiogubbins/domain', '@audiogubbins/timeline'],
  '@audiogubbins/waveform': [
    '@audiogubbins/domain',
    '@audiogubbins/audio-engine',
    '@audiogubbins/effect-rack',
    '@audiogubbins/processors',
  ],
  '@audiogubbins/audio-engine': [
    '@audiogubbins/domain',
    '@audiogubbins/audio-graph',
    '@audiogubbins/codecs',
    '@audiogubbins/text',
  ],
  '@audiogubbins/processors': [
    '@audiogubbins/domain',
    '@audiogubbins/audio-graph',
    '@audiogubbins/audio-engine',
  ],
  '@audiogubbins/effect-rack': [
    '@audiogubbins/domain',
    '@audiogubbins/audio-graph',
    '@audiogubbins/audio-engine',
    '@audiogubbins/processors',
  ],
  '@audiogubbins/audio-runtime': [
    '@audiogubbins/domain',
    '@audiogubbins/diagnostics',
    '@audiogubbins/capabilities',
    '@audiogubbins/audio-graph',
    '@audiogubbins/audio-engine',
    '@audiogubbins/effect-rack',
    '@audiogubbins/processors',
  ],
  '@audiogubbins/commands': [
    '@audiogubbins/domain',
    '@audiogubbins/diagnostics',
    '@audiogubbins/input',
    '@audiogubbins/text',
    '@audiogubbins/version',
  ],
  '@audiogubbins/capabilities': ['@audiogubbins/diagnostics', '@audiogubbins/text'],
  '@audiogubbins/design-system': ['@audiogubbins/version'],
  '@audiogubbins/workspace': [
    '@audiogubbins/diagnostics',
    '@audiogubbins/text',
    '@audiogubbins/version',
  ],
  '@audiogubbins/project-format': [
    '@audiogubbins/domain',
    '@audiogubbins/text',
    '@audiogubbins/version',
  ],
  '@audiogubbins/project-commands': [
    '@audiogubbins/domain',
    '@audiogubbins/commands',
    '@audiogubbins/project-format',
    '@audiogubbins/text',
  ],
  '@audiogubbins/history': [
    '@audiogubbins/domain',
    '@audiogubbins/commands',
    '@audiogubbins/project-format',
  ],
  '@audiogubbins/media-store': ['@audiogubbins/domain', '@audiogubbins/project-format'],
  '@audiogubbins/model-packs': [
    '@audiogubbins/domain',
    '@audiogubbins/ml-runtime',
    '@audiogubbins/project-format',
  ],
  '@audiogubbins/storage': [
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
  '@audiogubbins/browser-storage': [
    '@audiogubbins/diagnostics',
    '@audiogubbins/media-store',
    '@audiogubbins/project-format',
    '@audiogubbins/storage',
  ],
  '@audiogubbins/storage-runtime': [
    '@audiogubbins/browser-storage',
    '@audiogubbins/capabilities',
    '@audiogubbins/commands',
    '@audiogubbins/diagnostics',
    '@audiogubbins/domain',
    '@audiogubbins/history',
    '@audiogubbins/media-store',
    '@audiogubbins/processors',
    '@audiogubbins/project-commands',
    '@audiogubbins/project-format',
    '@audiogubbins/storage',
    '@audiogubbins/text',
  ],
  '@audiogubbins/test-fixtures': ['@audiogubbins/domain'],
};

/**
 * The one AudioGubbins package a package or the application may declare for its
 * tests alone (ADR-0019).
 */
const FIXTURES = '@audiogubbins/test-fixtures';

/**
 * The packages whose own rule in the cruise leaves the fixtures package out of
 * what it refuses, so that their tests may take it (ADR-0019). Every other
 * package a rule of its own governs refuses it: no test of the input or version
 * package needs it, and the domain package's tests cannot take it, since the
 * fixtures package depends on the domain package.
 */
const TESTS_TAKE_THE_FIXTURES: ReadonlySet<string> = new Set([
  'browser-storage',
  'clipboard',
  'codecs',
  'diagnostics',
  'history',
  'media-store',
  'project-commands',
  'project-format',
  'storage',
  'text',
]);

/** A rule of the cruise, as much of it as the rules here read. */
interface CruiserRule {
  readonly name: string;
  readonly from: { readonly path?: string };
  readonly to: { readonly path?: string; readonly pathNot?: string };
}

/** The dependency-cruiser configuration, loaded as the cruise loads it. */
const CRUISER = createRequire(inRepository('package.json'))('./.dependency-cruiser.cjs') as {
  readonly forbidden: readonly CruiserRule[];
};

/**
 * The packages a cruiser path names, whether it names them to match them,
 * `^packages/(a|b)/`, or to leave them out, `^packages/(?!(a|b)/)`, sorted.
 */
function packagesNamed(pattern: string | undefined): readonly string[] {
  const named = /^\^packages\/(?:\(\?!)?\(?([a-z|-]+)\)?\/\)?$/u.exec(pattern ?? '');
  if (named?.[1] === undefined) throw new Error(`Not a path over packages: ${String(pattern)}`);
  return named[1].split('|').sort();
}

/** The applications, whose manifests the rules read beside the packages'. */
const APPLICATION_MANIFESTS: readonly string[] = ['apps/web/package.json'];

/**
 * Every package manifest, and the application's.
 *
 * Refuses to answer with fewer or more than the layering and the application
 * list name. The rules that loop over these manifests assert nothing per
 * manifest when the list is empty, so a glob that stops matching would let
 * every one of them pass having read no manifest at all.
 */
function manifests(): readonly string[] {
  const found = sourcesMatching('{apps,packages}/*/package.json').map((path) =>
    forwardSlashes(path),
  );

  const expected = APPLICATION_MANIFESTS.length + Object.keys(ALLOWED).length;
  const missing = APPLICATION_MANIFESTS.filter((manifest) => !found.includes(manifest));
  if (found.length !== expected || missing.length > 0) {
    throw new Error(
      `Expected ${String(expected)} manifests, including ${APPLICATION_MANIFESTS.join(', ')}; ` +
        `found ${String(found.length)}: ${found.join(', ')}`,
    );
  }

  return found;
}

/** Every package manifest, without the application's. */
function packageManifests(): readonly string[] {
  return manifests().filter((manifest) => manifest.startsWith('packages/'));
}

/**
 * The first cycle in a dependency graph, as the path that closes it, or
 * nothing when the graph has none.
 *
 * One walk, shared by the rule and by the control that proves the rule can
 * fail, so the control exercises the code the rule rests on rather than a copy.
 */
function findCycle(graph: Readonly<Record<string, readonly string[]>>): string[] | undefined {
  const finished = new Set<string>();

  const visit = (name: string, path: readonly string[]): string[] | undefined => {
    if (path.includes(name)) return [...path, name];
    if (finished.has(name)) return undefined;

    for (const dependency of graph[name] ?? []) {
      const cycle = visit(dependency, [...path, name]);
      if (cycle !== undefined) return cycle;
    }

    finished.add(name);
    return undefined;
  };

  for (const name of Object.keys(graph)) {
    const cycle = visit(name, []);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

/** The packages an installed dependency requires its consumer to provide. */
function peersOf(root: string, dependency: string): Readonly<Record<string, string>> {
  const manifest = JSON.parse(read(`${root}node_modules/${dependency}/package.json`)) as {
    peerDependencies?: Record<string, string>;
  };
  return manifest.peerDependencies ?? {};
}

describe('the source set the architecture rules run against', () => {
  it('finds the source files, so a passing rule is not passing vacuously', () => {
    // A glob that matched nothing would make every rule below pass while
    // checking nothing at all.
    expect(ALL_SOURCES.length).toBeGreaterThan(30);
  });

  it('covers every package in the workspace, and the application', () => {
    // The set is compared with the layering's own list, which is the one place
    // the workspaces are enumerated, rather than named here one by one. A list
    // written here would fall behind the workspaces, and moving or renaming the
    // source directory of one it left out would leave every rule below passing
    // having read nothing at all from it, while the count stayed comfortably
    // over its floor.
    const packages = new Set(ALL_SOURCES.map((path) => path.split('/').slice(0, 2).join('/')));
    const expected = new Set([
      ...Object.keys(ALLOWED).map((name) => `packages/${name.replace('@audiogubbins/', '')}`),
      'apps/web',
    ]);

    expect([...packages].sort()).toEqual([...expected].sort());

    // And each of them holds something to read.
    for (const one of expected) {
      expect(ALL_SOURCES.filter((path) => path.startsWith(`${one}/`)).length).toBeGreaterThan(0);
    }
  });

  it('finds the stylesheets, which import packages of their own', () => {
    expect(ALL_STYLESHEETS.length).toBeGreaterThan(2);
  });

  it('strips comments before reading code, so documentation is not a violation', () => {
    // The stripper is what lets a file explain why it does not call `fetch`.
    // The file names the API in its documentation, or its code without it
    // would say nothing about the stripper.
    const path = 'packages/diagnostics/src/index.ts';
    const stripped = readCode(path);

    expect(read(path)).toContain('sendBeacon');
    expect(stripped).not.toContain('sendBeacon');
    expect(stripped).toContain('export');
  });
});

describe('the import matcher sees every form an import can take', () => {
  /**
   * The positive controls for the seven rules built on it.
   *
   * Each of these forms is one that a matcher anchored on the literal `from`,
   * or written for one quote style, can miss. A rule that cannot see an import
   * is a rule that passes while the violation it exists to catch is in the
   * tree, and the application writes its three cross-package stylesheet imports
   * as side-effect imports.
   */
  const FORMS: readonly (readonly [string, string, string])[] = [
    ['a static import', "import { a } from 'dockview-core';", 'dockview-core'],
    ['a type-only import', "import type { A } from 'dockview-core';", 'dockview-core'],
    ['a re-export', "export { a } from 'dockview-core';", 'dockview-core'],
    [
      'a side-effect import',
      "import '@audiogubbins/design-system/styles/tokens.css';",
      '@audiogubbins/design-system/styles/tokens.css',
    ],
    ['a dynamic import', "const m = await import('dockview-core');", 'dockview-core'],
    ['a CommonJS require', "const m = require('dockview-core');", 'dockview-core'],
    [
      'a stylesheet import',
      "@import 'dockview/dist/styles/dockview.css';",
      'dockview/dist/styles/dockview.css',
    ],
    ['a double-quoted import', 'import { a } from "dockview-core";', 'dockview-core'],
  ];

  for (const [description, code, specifier] of FORMS) {
    it(`finds the specifier in ${description}`, () => {
      expect(specifiersIn(code)).toContain(specifier);
    });
  }

  it('attributes a subpath import to its package', () => {
    // A pattern anchored at both ends of the package name would let
    // `dockview-core/dist/styles.css` escape the containment rule, so the
    // package is named first.
    expect(packageOf('dockview-core/dist/styles.css')).toBe('dockview-core');
    expect(packageOf('@audiogubbins/design-system/styles/tokens.css')).toBe(
      '@audiogubbins/design-system',
    );
    expect(packageOf('radix-ui')).toBe('radix-ui');
  });

  it('attributes no package to a relative specifier', () => {
    expect(packageOf('./shell/shell.css')).toBeUndefined();
    expect(packageOf('../panel.js')).toBeUndefined();
  });

  it('reads the application, which imports stylesheets by side effect', () => {
    // A control on the whole path, not just the regular expressions: if the
    // application ever stopped writing these, the rules would be passing over a
    // file with no cross-package import left to check.
    expect(importsOf('apps/web/src/app.tsx')).toContain(
      '@audiogubbins/design-system/styles/tokens.css',
    );
  });
});

/**
 * The files outside a package's source that still decide what the page does.
 *
 * The page itself, the build configuration that writes into it with every
 * module beside it that it loads, such as the preview server's request log,
 * and the tools the build runs. Read over package source alone, the rules
 * below would pass a script tag in the page, a request made while building or
 * serving, or a tool that sent something home.
 */
const PAGE_AND_BUILD = [
  'apps/web/index.html',
  ...sourcesMatching('apps/*/*.{ts,mjs,js}'),
  ...sourcesMatching('tools/*.{mjs,js,ts}').map((path) => forwardSlashes(path)),
];

describe('no telemetry can exist (REQ-PRIV-161, REQ-PRIV-162)', () => {
  /**
   * The ways code can reach another machine, or put code there that could.
   *
   * Matched so that a variable called `fetchedAssets` does not trip the rule
   * while `fetch(` does. The list reaches past the six request APIs to a peer
   * connection, a WebTransport session, a script loaded from elsewhere by
   * `import()`, a worker or an element pointed at another origin, and markup
   * written as text, which is how a script is injected: each is a way out that
   * a list of the six alone would pass.
   */
  const NETWORK_APIS: readonly RegExp[] = [
    /\bfetch\s*\(/,
    /\bnew\s+XMLHttpRequest\b/,
    /\bnew\s+WebSocket\b/,
    /\bnew\s+EventSource\b/,
    /\bnavigator\s*\.\s*sendBeacon\b/,
    /\bnavigator\s*\.\s*connection\b/,
    /\bnew\s+(?:webkit)?RTCPeerConnection\b/,
    /\bnew\s+WebTransport\b/,
    /\bimportScripts\s*\(/,
    // A module from another origin, or from a specifier nobody can read.
    /\bimport\s*\(\s*['"`](?:https?:)?\/\//,
    /\bimport\s*\(\s*[^'"`\s)]/,
    /\bnew\s+(?:Shared)?Worker\s*\(\s*['"`](?:https?:)?\/\//,
    // An element told to load something from elsewhere.
    /\.(?:src|href|action|data)\s*=\s*['"`](?:https?:)?\/\//,
    // Markup written as text, which is how a script is injected.
    /\bcreateElement\s*\(\s*['"`]script['"`]/,
    /\b(?:inner|outer)HTML\s*=/,
    /\binsertAdjacentHTML\s*\(/,
    /\bdangerouslySetInnerHTML\b/,
    /\bdocument\s*\.\s*write(?:ln)?\s*\(/,
    // A request API declared by its shape, as a module compiled without the
    // browser's definitions names a global, which it then calls by any name.
    /\bdeclare\s+(?:const|let|var|function)\s+(?:fetch|XMLHttpRequest|WebSocket|EventSource|(?:webkit)?RTCPeerConnection|WebTransport|importScripts)\b/,
  ];

  /**
   * The first of the two modules that may reach the network: the download of
   * a model pack's files (ADR-0062), which asks the catalogue the build
   * configures for the pack and sends nothing else. ESLint's network rule
   * excepts it too.
   */
  const DOWNLOAD = 'packages/model-packs/src/adapter/http-pack-source.ts';

  /**
   * The second: the read of the inference runtime's WebAssembly (ADR-0062),
   * which asks the application's own origin for the file and sends nothing
   * else, so the runtime fetches nothing itself. ESLint's network rule
   * excepts it too.
   */
  const RUNTIME_FILES = 'packages/ml-runtime/src/adapter/origin-runtime-files.ts';

  it.each([
    ['a fetch', "await fetch('/log');"],
    ['a beacon', "navigator.sendBeacon('/log', body);"],
    ['a peer connection', 'const peer = new RTCPeerConnection(configuration);'],
    ['a WebTransport session', "new WebTransport('https://example.com');"],
    ['a remote module', "await import('https://example.com/module.js');"],
    ['a computed module', 'await import(location);'],
    ['a remote worker', "new Worker('https://example.com/worker.js');"],
    ['a remote image', "pixel.src = 'https://example.com/pixel.gif';"],
    ['an injected script', "document.createElement('script');"],
    ['markup written as text', 'panel.innerHTML = markup;'],
    ['markup handed to React', '<div dangerouslySetInnerHTML={{ __html: markup }} />'],
    ['a request API declared by its shape', 'declare const fetch: Fetch;'],
    ['a socket declared by its shape', 'declare function WebSocket(url: string): Socket;'],
  ])('recognises %s', (_form, code) => {
    expect(NETWORK_APIS.some((pattern) => pattern.test(code))).toBe(true);
  });

  it.each([
    ['a variable named after fetching', 'const fetchedAssets = [];'],
    ['a local module', "await import('./app.js');"],
    ['a local worker', "new Worker(new URL('./decode.ts', import.meta.url));"],
    ['a download link', 'link.href = url;'],
  ])('does not mistake %s for a way out', (_form, code) => {
    expect(NETWORK_APIS.some((pattern) => pattern.test(code))).toBe(false);
  });

  it('has no network call in production source but the two modules excepted', () => {
    const offenders = ALL_SOURCES.filter((path) => {
      const code = readCode(path);
      return NETWORK_APIS.some((pattern) => pattern.test(code));
    });

    expect(offenders.toSorted()).toEqual([RUNTIME_FILES, DOWNLOAD]);
  });

  it.each([
    ['the download', DOWNLOAD],
    ['the read of the runtime’s files', RUNTIME_FILES],
  ])('lets %s reach the network by its declared fetch and by nothing else', (_name, path) => {
    const code = readCode(path);
    expect(NETWORK_APIS.filter((pattern) => pattern.test(code))).toHaveLength(1);
    expect(code).toMatch(/\bdeclare\s+const\s+fetch\b/);
    expect(code).not.toMatch(/\bdeclare\s+(?:const|let|var|function)\s+(?!fetch\b)\w+/);
  });

  it('has none in the page, the build configuration or the tools either', () => {
    expect(PAGE_AND_BUILD).toContain('apps/web/index.html');
    expect(PAGE_AND_BUILD).toContain('apps/web/vite.config.ts');
    expect(PAGE_AND_BUILD).toContain('apps/web/preview-request-log.ts');
    expect(PAGE_AND_BUILD.length).toBeGreaterThan(3);

    const offenders = PAGE_AND_BUILD.filter((path) => {
      const code = readCode(path);
      return NETWORK_APIS.some((pattern) => pattern.test(code));
    });

    expect(offenders).toEqual([]);
  });

  it('loads nothing into the page from another origin', () => {
    // A script, a stylesheet or a font from anywhere else is a request the
    // user never agreed to, made before any code of ours has run.
    const page = read('apps/web/index.html');
    const remote = [...page.matchAll(/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']*/g)];
    const inlineScripts = [...page.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)];

    expect(remote.map((match) => match[0])).toEqual([]);
    expect(inlineScripts.map((match) => match[0])).toEqual([]);
  });

  it('imports no analytics or telemetry service', () => {
    // A dependency that phoned home would arrive as an import long before it
    // arrived as a `fetch`, and REQ-PRIV-162 requires build tooling and
    // dependencies to be reviewed for exactly this.
    //
    // Matched against import specifiers rather than against any occurrence of
    // the name. Several of these words are ordinary English: a signal fixture's
    // `amplitude` parameter is not a reporting service, and a rule that said it
    // was would be switched off within a week.
    const services =
      'google-analytics|googletagmanager|gtag|segment|mixpanel|amplitude|sentry|bugsnag|datadog|posthog|hotjar|fullstory';
    const asPackage = new RegExp(services);
    const asAddress = new RegExp(`https?://[^\\s'"\`]*(${services})`, 'i');

    const offenders = [...ALL_SOURCES, ...ALL_STYLESHEETS, ...PAGE_AND_BUILD].filter(
      (path) => importsPackage(path, asPackage) || asAddress.test(readCode(path)),
    );

    expect(offenders).toEqual([]);
  });

  it('installs no analytics package that has not been reviewed, even transitively', () => {
    // REQ-PRIV-162 requires build tooling and dependencies to be reviewed so
    // that analytics are not introduced transitively without deliberate
    // approval. The manifest rule below reads what AudioGubbins declares, and a
    // dependency can bring an analytics module in underneath it, visible only
    // in the lockfile, as the service worker generator does. This reads the
    // lockfile, and each package found must be named here with the reason it is
    // inert.
    const REVIEWED: Readonly<Record<string, string>> = {
      'workbox-google-analytics':
        'Installed by workbox-build, which vite-plugin-pwa uses to write the development ' +
        'service worker. Nothing imports it, the analytics option that would is never set, ' +
        'the production build ships no worker, and the build-output gate refuses its host.',
    };
    // The vendors, and the words a vendor's package is named after,
    // `opentelemetry` among them: `@opentelemetry/api` is declared as an
    // optional peer of the test runner, and a list of vendors alone would match
    // nothing in its name.
    const SERVICE_WORDS = new Set([
      'analytics',
      'telemetry',
      'opentelemetry',
      'tracking',
      'mixpanel',
      'amplitude',
      'sentry',
      'bugsnag',
      'datadog',
      'posthog',
      'hotjar',
      'fullstory',
      'segment',
      'gtag',
      'googletagmanager',
      'newrelic',
      'rollbar',
      'logrocket',
      'snowplow',
      'statsig',
      'plausible',
      'umami',
      'matomo',
      'clarity',
      'heap',
      'smartlook',
      'countly',
    ]);

    const installed = new Set(
      [...read('pnpm-lock.yaml').matchAll(/^ {2}'?((?:@[^/\s]+\/)?[^@\s':]+)@/gm)].map(
        (match) => match[1] ?? '',
      ),
    );
    expect(installed.size).toBeGreaterThan(100);

    // Compared by word, so a package named after `toStringTag` is not `gtag`.
    const found = [...installed].filter((name) =>
      name.split(/[@/._-]+/).some((word) => SERVICE_WORDS.has(word.toLowerCase())),
    );

    expect(found.sort()).toEqual(Object.keys(REVIEWED).sort());
  });

  it('declares no dependency that reports usage', () => {
    const forbidden =
      /(analytics|telemetry|mixpanel|amplitude|@sentry|bugsnag|datadog|posthog|hotjar|fullstory)/i;

    const offenders: string[] = [];
    for (const manifest of manifests()) {
      const parsed = JSON.parse(read(manifest)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      for (const name of [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
      ]) {
        if (forbidden.test(name)) offenders.push(`${manifest}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the domain stays framework and platform agnostic (REQ-ARCH-151)', () => {
  /**
   * The packages that render nothing and reach for no browser global, the text
   * package among them: it sits below two of the others, so a user-interface
   * import in it would reach every package that reads it. The cruise's
   * framework rule names the same set.
   */
  const FRAMEWORK_FREE_PACKAGES = [
    'audio-engine',
    'audio-graph',
    'clipboard',
    'codecs',
    'commands',
    'domain',
    'editor-view',
    'effect-rack',
    'history',
    'input',
    'media-store',
    'ml-runtime',
    'model-packs',
    'processors',
    'project-commands',
    'project-format',
    'renderer',
    'storage',
    'text',
    'timeline',
    'version',
    'video-reference',
    'waveform',
  ] as const;
  const FRAMEWORK_FREE = productionSources(
    `packages/{${FRAMEWORK_FREE_PACKAGES.join(',')}}/src/**/*.ts`,
  );

  it('finds the files it is checking, in each of the packages it names', () => {
    // Each package is looked for by name: a count alone would be satisfied by
    // some of them, so a package lost from the glob would go unnoticed.
    for (const name of FRAMEWORK_FREE_PACKAGES) {
      expect(
        FRAMEWORK_FREE.filter((path) => path.startsWith(`packages/${name}/`)).length,
        name,
      ).toBeGreaterThan(0);
    }
    expect(FRAMEWORK_FREE.length).toBeGreaterThan(5);
  });

  it('names the same packages as the rule the cruise holds them to', () => {
    const rule = CRUISER.forbidden.find((one) => one.name === 'domain-is-framework-agnostic');
    expect(packagesNamed(rule?.from.path)).toEqual([...FRAMEWORK_FREE_PACKAGES]);
  });

  it('imports no user-interface library', () => {
    const forbidden = /^(react|react-dom|radix-ui|@radix-ui\/.+|dockview.*|motion)$/;
    expect(FRAMEWORK_FREE.filter((path) => importsPackage(path, forbidden))).toEqual([]);
  });

  it('reaches for no browser global', () => {
    // The packages are also compiled without the DOM type definitions, so this
    // would be a type error first. The rule stays because the `lib` setting is
    // one line in a generated file, and this is a test that says why it
    // matters. A member of that name, such as an analysis's `window`, is not
    // the global.
    const forbidden = /(?<![\w$.])(window|document|localStorage|sessionStorage|navigator)\s*\./;
    expect(FRAMEWORK_FREE.filter((path) => forbidden.test(readCode(path)))).toEqual([]);
  });

  it('renders nothing, so no component file exists in it', () => {
    // The same packages the rules above read, named from the one list:
    // `FRAMEWORK_FREE` globs `.ts` alone, so a `.tsx` in any of them is read by
    // this rule or by none.
    expect(sourcesMatching(`packages/{${FRAMEWORK_FREE_PACKAGES.join(',')}}/src/**/*.tsx`)).toEqual(
      [],
    );
  });

  it("has a domain package that declares no runtime dependency, of the workspace or a third party; its tests' tooling is a development dependency", () => {
    // The bottom of the graph. Anything it needed from elsewhere as it runs
    // would either belong in the domain or point the dependency the wrong way.
    // The layering holds the workspace's packages; this holds a library's as
    // well, in each field whose packages whoever uses the domain receives or
    // must supply. What its own tests run with is a development dependency,
    // which reaches no one who uses it.
    const manifest = JSON.parse(read('packages/domain/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    expect({
      dependencies: Object.keys(manifest.dependencies ?? {}),
      peerDependencies: Object.keys(manifest.peerDependencies ?? {}),
      optionalDependencies: Object.keys(manifest.optionalDependencies ?? {}),
    }).toEqual({ dependencies: [], peerDependencies: [], optionalDependencies: [] });

    // The tools are read from the declarations that import or export from a
    // module in the tests and their support, parsed rather than matched in the
    // text, where a test's title can read as one. Any tool they take is held to
    // the manifest, and the test runner must be among them, or the rule would
    // hold nothing.
    const tooling = new Set(
      TEST_CODE_FILES.filter((path) => path.startsWith('packages/domain/'))
        .flatMap((path) => parse(path).statements)
        .map((statement) =>
          (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
          statement.moduleSpecifier !== undefined &&
          ts.isStringLiteral(statement.moduleSpecifier)
            ? packageOf(statement.moduleSpecifier.text)
            : undefined,
        )
        .filter(
          (name): name is string =>
            name !== undefined && !name.startsWith('node:') && name !== '@audiogubbins/domain',
        ),
    );
    expect(tooling).toContain('vitest');
    expect([...tooling].filter((name) => !(name in (manifest.devDependencies ?? {})))).toEqual([]);
  });
});

describe('third-party libraries stay behind their adapters', () => {
  it('imports the docking engine only from the workspace package', () => {
    // REQ-ARCH-151 keeps Dockview behind AudioGubbins-owned contracts. What
    // that buys, stated exactly: replacing the engine is a change to this one
    // module, the stylesheet that reaches the engine's own by `@import`, and
    // the two places that know the class names it draws, which the rule below
    // holds to a list.
    const importsDockview = [...ALL_SOURCES, ...ALL_STYLESHEETS].filter((path) =>
      importsPackage(path, /^dockview(-core|-react)?$/),
    );

    // The adapter holds the engine's components and types. The workspace
    // package's own stylesheet holds its stylesheet, because CSS cannot be
    // wrapped: an `@import` is the only way to reach it, and moving it to the
    // application would put the engine back in front of the contract rather
    // than behind it.
    expect(importsDockview.sort()).toEqual([
      'packages/workspace/src/adapter/dockview-adapter.tsx',
      'packages/workspace/src/styles/workspace.css',
    ]);
  });

  it("draws on the docking engine's own class names in four places, all of them listed", () => {
    // The containment above is about imports, and the browser suite imports
    // nothing from the engine while driving nineteen of its private class
    // names. Counting them is what makes the claim above measurable: the
    // adapter, the stylesheet that reaches the engine's own by `@import`, the
    // adapter's own test, which stands in for the engine, and the one helper
    // the browser suite asks for a group, a tab or a splitter through.
    const engineClass = /['"`.][\w-]*\bdv-[\w-]+/;
    const knowing = EVERY_WRITTEN_FILE.filter((path) => engineClass.test(read(path)));

    expect(knowing.toSorted()).toEqual([
      'packages/workspace/src/adapter/dockview-adapter.test.tsx',
      'packages/workspace/src/adapter/dockview-adapter.tsx',
      'packages/workspace/src/styles/workspace.css',
      'tests/e2e/dock.ts',
    ]);
  });

  it('imports the inference runtime only from its adapter, and there only when a session needs it', () => {
    // ADR-0062: only the adapter knows ONNX Runtime Web, and REQ-AUDIO-139
    // keeps the runtime out of the base bundle, so the adapter reaches it by
    // `import()` alone, which the bundler splits into chunks of its own.
    const runtime = /^onnxruntime-(web|common)$/;
    const importing = ALL_SOURCES.filter((path) => importsPackage(path, runtime));
    expect(importing).toEqual(['packages/ml-runtime/src/adapter/onnx-runtime.ts']);

    const staticImports = importing.flatMap((path) =>
      [...readCode(path).matchAll(/\b(?:from|import)\s*['"`](onnxruntime-[^'"`]+)['"`]/g)].map(
        (match) => match[1],
      ),
    );
    expect(staticImports).toEqual([]);
  });

  it('imports the primitive library only from the design system primitives', () => {
    // REQ-UX-155: a feature reaching for Radix directly would bypass the token
    // system and the accessibility wrappers.
    const importsRadix = [...ALL_SOURCES, ...ALL_STYLESHEETS].filter((path) =>
      importsPackage(path, /^(radix-ui|@radix-ui\/.+)$/),
    );

    for (const path of importsRadix) {
      expect(path.startsWith('packages/design-system/src/primitives/')).toBe(true);
    }
    expect(importsRadix.length).toBeGreaterThan(0);
  });

  /**
   * A name that is a browser global, or stands in for one.
   *
   * The package takes the global as an argument rather than reaching for it, so
   * its own probes are written on `navigatorLike`. An expression that knows the
   * literal `navigator` alone cannot see a line of `keyboard-layout-map.ts`,
   * the module whose whole purpose is probing.
   */
  const GLOBAL_LIKE = String.raw`[\w$]*(?:avigator|indow|lobalThis)[\w$]*`;

  /**
   * What asking the browser what it can do, or where it is running, looks like.
   *
   * Reading anything at all off `navigator` is asking the browser about itself,
   * so no member of it is listed: a list of members would pass whatever it left
   * out, the user agent the composition root parses or the `keyboard` a later
   * phase is likeliest to probe in the wrong place. A `typeof` test of a global
   * counts as well, which is how the design system's `matchMedia` check is
   * written. `window` keeps a list, because `window.localStorage` and
   * `window.location` are uses of the browser rather than questions about it.
   */
  const PROBE = new RegExp(
    [
      String.raw`\btypeof\s+(?:${GLOBAL_LIKE}|SharedArrayBuffer|Worker)\b`,
      String.raw`['"\`]\w+['"\`]\s+in\s+${GLOBAL_LIKE}\b`,
      String.raw`\b[\w$]*(?:avigator)[\w$]*\s*\.\s*[A-Za-z_$]`,
      String.raw`\b[\w$]*(?:indow|lobalThis)[\w$]*\s*\.\s*(?:crossOriginIsolated|matchMedia|isSecureContext)\b`,
      String.raw`\bReflect\s*\.\s*(?:get|has)\s*\(\s*${GLOBAL_LIKE}\b`,
    ].join('|'),
  );

  it.each([
    ['a type test of a global', "if (typeof window.matchMedia !== 'function') return;"],
    ['a membership test', "const hasPicker = 'showOpenFilePicker' in window;"],
    ['a media query', "window.matchMedia('(prefers-color-scheme: dark)')"],
    ['a user-agent read', 'const agent = navigator.userAgent;'],
    ['a touch-point read', 'navigator.maxTouchPoints > 1'],
    ['a storage probe', 'navigator.storage.estimate()'],
    // The layout map: a member of `navigator` on no list, read through
    // `Reflect` off a parameter standing in for the global. The second of these
    // is `keyboard-layout-map.ts`'s own line, copied rather than invented,
    // which is what stops a control being tuned to the expression. The first is
    // written here: the module cannot contain it, because the API is absent
    // from the DOM type definitions and is reached only through `Reflect`, and
    // the plain form is what a module that did have the types would write.
    ['a layout-map read', 'navigator.keyboard.getLayoutMap()'],
    [
      'a reflected read of a stand-in',
      "const keyboard: unknown = Reflect.get(navigatorLike, 'keyboard');",
    ],
    ['a reflected membership test', "if (!Reflect.has(globalThis, 'showOpenFilePicker')) return;"],
  ])('recognises %s as a probe', (_form, code) => {
    expect(PROBE.test(code)).toBe(true);
  });

  it.each([
    ['a storage read', "window.localStorage.getItem('audiogubbins.preferences')"],
    ['a reload', 'window.location.reload();'],
    ['a variable named after a capability', 'const userAgentText = summary.browser;'],
    ['a reflected read of something else', "const entries: unknown = Reflect.get(map, 'entries');"],
  ])('does not mistake %s for a probe', (_form, code) => {
    expect(PROBE.test(code)).toBe(false);
  });

  it('reads the package it guards, so the expression is proved against real code', () => {
    // Two files are named, so the expression is not passing on one module's
    // evidence while the package holds several probes.
    const probing = productionSources('packages/capabilities/src/**/*.ts').filter((path) =>
      PROBE.test(readCode(path)),
    );

    expect(probing).toContain('packages/capabilities/src/keyboard-layout-map.ts');
    expect(probing).toContain('packages/capabilities/src/browser-environment.ts');
  });

  it('probes browser globals only from the capabilities package', () => {
    // REQ-EXEC-136.4 keeps platform APIs from becoming implicit global
    // dependencies, and REQ-EXEC-216 requires each capability-sensitive
    // assumption to carry explicit fallback behaviour. Both hold only while
    // detection has one home.
    const offenders = ALL_SOURCES.filter(
      (path) => PROBE.test(readCode(path)) && !path.startsWith('packages/capabilities/src/'),
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * The values the page may take from the packages that keep projects, each
 * under the reason the work is the page's own (see the rule below).
 */
const PAGE_VALUES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  '@audiogubbins/storage': {
    'The kinds of cache and the order a cleanup offers them in, constants the storage commands and the peak cache name a cache by.':
      ['CACHE_CLEANUP_ORDER', 'CacheCategory'],
    'The scope of a cache kept for audio the storage does not hold, made from the digest of its identity: a pure function, which the peak cache names each cache by before the worker keeps it.':
      ['unstoredScope'],
    'The project a folder export was refused for holding, read from the refusal the worker answered: a pure function, which the transfer store asks the person about.':
      ['anotherProjectIn'],
    'Whether a write the session could not make was refused for want of room: a pure function over the failure the worker answered, beside the one that makes that failure, which the pressure relief answers by giving up caches.':
      ['isStorageFull'],
    'Why a write or a backup the worker answered was refused: pure functions over the failure, beside the ones that make it, which the backup notices word for the person.':
      ['storageRefusalOf', 'unreadableStateOf'],
  },
  '@audiogubbins/media-store': {
    'What became of a linked file and what the person may do about it: pure decisions over the identity the worker examined, which the source change store puts to the person.':
      ['classifySource', 'resolutionsFor'],
    "The choices of how a file is brought in, constants the person's setting holds so the import pipeline takes the choice the setting names.":
      ['SourceHandling'],
  },
  '@audiogubbins/browser-storage': {
    'The kept handles of linked files and of the backups folder, and the tokens they are kept under, which only the page may ask the person leave to use.':
      [
        'FileHandleKeeper',
        'FolderUse',
        'randomTokens',
        'reopenKeptFile',
        'reopenKeptFolder',
        'requestKeptFileAccess',
        'requestKeptFolderAccess',
      ],
    "The pickers and the page's own file input, which a browser opens only in the handler of the person's gesture.":
      ['filesFromInput', 'pickDirectory', 'pickFiles', 'pickSaveFile'],
    'The sinks and the folder over what the person chose, which the page lends the worker for one call.':
      ['BlobSink', 'openFileSink', 'openFileSinkIn', 'writableFolder'],
    "The browser's SHA-256, which names the caches the editor keeps.": ['webDigest'],
  },
};

describe('the page keeps no storage core of its own (ADR-0022)', () => {
  /** The values listed for a package, or none where it is not one that keeps projects. */
  const allowed = (pkg: string): ReadonlySet<string> =>
    new Set(Object.values(PAGE_VALUES[pkg] ?? {}).flat());

  // Every application file that ships, its tests and their support excluded:
  // a test world owns both ends of the port, and prepares storage as another
  // window would.
  const PAGE_FILES = PRODUCTION_FILES.filter((path) => path.startsWith('apps/web/src/'));

  /** Each value a page file takes from a package that keeps projects, or by a computed name. */
  const takenByThePage = (): readonly {
    readonly where: string;
    readonly pkg: string;
    readonly name: string;
  }[] =>
    PAGE_FILES.flatMap((path) =>
      valuesTaken(parse(path)).flatMap(({ module, name }) => {
        const pkg = module === '(computed)' ? module : packageOf(module);
        return pkg !== undefined && (pkg in PAGE_VALUES || pkg === '(computed)')
          ? [{ where: `${path}: ${module} ${name}`, pkg, name }]
          : [];
      }),
    );

  it('takes types from the packages that keep projects, and only the values listed with their reason', () => {
    // ADR-0022 keeps the storage core in one worker, so the page holds no
    // project, history, tree or store of its own and asks the worker for
    // everything through the storage runtime's client. The page may still name
    // what those packages describe, since a type is gone before the code runs,
    // but the only values it takes from them are the ones listed, each for work
    // that is the page's own. A value of the storage, such as `openProject` or
    // `ProjectRepository`, or of the tree beneath it, would be a storage core
    // on the page again.
    const unlisted = takenByThePage()
      .filter(({ pkg, name }) => !allowed(pkg).has(name))
      .map(({ where }) => where);

    expect(unlisted).toEqual([]);
  });

  it('takes every value it lists, so the list says what the page does', () => {
    const taken = new Set(takenByThePage().map(({ pkg, name }) => `${pkg} ${name}`));
    const listed = Object.entries(PAGE_VALUES).flatMap(([pkg, reasons]) =>
      Object.values(reasons)
        .flat()
        .map((name) => `${pkg} ${name}`),
    );

    expect(listed.filter((value) => !taken.has(value))).toEqual([]);
  });

  it('reads the page, which names many of their types and connects to the worker', () => {
    const naming = PAGE_FILES.filter((path) =>
      importsOf(path).some((specifier) => packageOf(specifier) === '@audiogubbins/storage'),
    );

    expect(naming.length).toBeGreaterThan(20);
    expect(
      valuesTaken(parse('apps/web/src/storage/project-services.ts')).map(({ name }) => name),
    ).toContain('connectStorage');
  });

  it.each([
    ['a named value', "import { openProject } from '@audiogubbins/storage';", ['openProject']],
    [
      'a value beside a type',
      "import { type ProjectSession, openProject as open } from '@audiogubbins/storage';",
      ['openProject'],
    ],
    ['a type alone', "import type { ProjectSession } from '@audiogubbins/storage';", []],
    ['types named one by one', "import { type ProjectSession } from '@audiogubbins/storage';", []],
    ['a default import', "import storage from '@audiogubbins/storage';", ['default']],
    ['a namespace', "import * as storage from '@audiogubbins/storage';", ['*']],
    ['an import for its effect', "import '@audiogubbins/storage';", ['(effect)']],
    ['a re-export', "export { openProject } from '@audiogubbins/storage';", ['openProject']],
    ['a re-export of everything', "export * from '@audiogubbins/storage';", ['*']],
    ['a re-export of types', "export type { ProjectSession } from '@audiogubbins/storage';", []],
    ['a dynamic import', "const storage = await import('@audiogubbins/storage');", ['*']],
  ])('reads %s as the values it takes', (_form, code, names) => {
    const file = ts.createSourceFile('control.ts', code, ts.ScriptTarget.Latest, true);

    expect(valuesTaken(file)).toEqual(
      names.map((name) => ({ module: '@audiogubbins/storage', name })),
    );
  });
});

describe('every colour comes from the token system (REQ-UX-155)', () => {
  /**
   * A colour written as a value rather than read from a token.
   *
   * The phase's own forbidden shortcut is "a hard-coded component colour system
   * bypassing semantic tokens", and this is the rule that looks for one: a
   * scrim, a shadow or a fallback palette written as a literal is that
   * shortcut. System colour keywords such as `Canvas` are not literals, because
   * the user's platform chooses them.
   */
  const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\s*\(/;

  /** The modules that compute the palette, which are where colours are made. */
  const TOKEN_MODULES = 'packages/design-system/src/tokens/';

  it.each([
    ['a hexadecimal colour', 'color: #1c1d22;'],
    ['a functional colour', 'background-color: oklch(0% 0 0 / 0.5);'],
    ['a colour in a component', "<div style={{ color: 'rgb(255, 0, 0)' }} />"],
  ])('recognises %s', (_form, code) => {
    expect(COLOUR_LITERAL.test(code)).toBe(true);
  });

  it.each([
    ['a token', 'color: var(--ag-chrome-text-primary);'],
    ['a system colour', 'background-color: ButtonFace;'],
    ['an identifier', 'const selectionColour = palette.selection.fill;'],
  ])('does not mistake %s for a colour literal', (_form, code) => {
    expect(COLOUR_LITERAL.test(code)).toBe(false);
  });

  it('writes no colour outside the token modules', () => {
    // The page's pre-paint colours and the manifest's are the one exception,
    // because they must exist before any script runs; a test in the
    // application holds each of them equal to the token system's answer.
    const offenders = [...ALL_SOURCES, ...ALL_STYLESHEETS]
      .filter((path) => !path.startsWith(TOKEN_MODULES))
      .filter((path) => COLOUR_LITERAL.test(readCode(path)));

    expect(offenders).toEqual([]);
  });
});

describe('cross-package access uses the public entry point (REQ-REPO-186)', () => {
  it('never reaches past another package into its src', () => {
    const deepImport = /^@audiogubbins\/[a-z-]+\/src\//;
    const offenders = [...ALL_SOURCES, ...ALL_STYLESHEETS].filter((path) =>
      importsOf(path).some((specifier) => deepImport.test(specifier)),
    );
    expect(offenders).toEqual([]);
  });

  it('imports a workspace package only by a path its manifest exports', () => {
    const exported = new Map<string, readonly string[]>();
    for (const manifest of sourcesMatching('packages/*/package.json')) {
      const parsed = JSON.parse(read(forwardSlashes(manifest))) as {
        name: string;
        exports?: Record<string, unknown>;
      };
      exported.set(parsed.name, Object.keys(parsed.exports ?? { '.': {} }));
    }

    const offenders: string[] = [];
    for (const path of [...ALL_SOURCES, ...ALL_STYLESHEETS]) {
      for (const specifier of importsOf(path)) {
        if (!specifier.startsWith('@audiogubbins/')) continue;

        const [scope, name, ...rest] = specifier.split('/');
        const packageName = `${scope ?? ''}/${name ?? ''}`;
        const subpath = rest.length === 0 ? '.' : `./${rest.join('/')}`;

        const allowed = exported.get(packageName);
        if (allowed === undefined) continue;

        // An export entry may be a pattern such as `./styles/*.css`.
        const permitted = allowed.some((entry) =>
          entry.includes('*')
            ? new RegExp(`^${entry.replaceAll('.', '\\.').replace('*', '.*')}$`).test(subpath)
            : entry === subpath,
        );

        if (!permitted) offenders.push(`${path} imports ${specifier}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('test fixtures never reach production code (REQ-EXEC-181)', () => {
  it('is imported by no production source', () => {
    // A fixture in a shipped build is the fabricated production data
    // REQ-EXEC-181 treats as a gate failure.
    const offenders = [...ALL_SOURCES, ...ALL_STYLESHEETS].filter((path) =>
      importsPackage(path, /^@audiogubbins\/test-fixtures$/),
    );
    expect(offenders).toEqual([]);
  });

  it('finds the test support it is guarding, so the rule is not vacuous', () => {
    expect(TEST_SUPPORT.length).toBeGreaterThan(2);
    expect(TEST_SUPPORT).toContain('apps/web/src/testing/shell-context.ts');
  });

  /** Whether a specifier written as a package name reaches another's test support. */
  const reachesTestSupport = (specifier: string): boolean =>
    specifier.includes('/testing/') || specifier.endsWith('/testing');

  it('is reached by no production source, whatever it is called', () => {
    // The fixtures package is refused by name above. The same risk lives in
    // `src/testing/`, which every other rule in this file deliberately skips,
    // so a production module importing `../testing/shell-context.js` is seen by
    // this rule or by none.
    //
    // A package may also declare `./testing` as an entry point, which the
    // cruiser's deep-import rule then exempts and the dependency rule does not
    // reach, because the package is an ordinary dependency. That form ends at
    // `testing` with no trailing slash, so a test for the directory alone says
    // no to it.
    const support = new Set(TEST_SUPPORT.map((path) => path.replace(/\.tsx?$/, '')));

    const offenders = ALL_SOURCES.filter((path) =>
      importsOf(path).some((specifier) => {
        if (!specifier.startsWith('.')) return reachesTestSupport(specifier);

        const from = path.slice(0, path.lastIndexOf('/'));
        const resolved = new URL(specifier.replace(/\.js$/, ''), `file:///${from}/`).pathname.slice(
          1,
        );
        return support.has(resolved) || support.has(`${resolved}/index`);
      }),
    );

    expect(offenders).toEqual([]);
  });

  it('reads a declared test-support entry point as test support, whichever form it takes', () => {
    // The controls, so the rule above is seen to answer for the path a manifest
    // offers as well as the path inside a package. Both are forms a production
    // module could really write: `@audiogubbins/domain/testing` is declared by
    // that package's manifest, and `@audiogubbins/domain/testing/unwrap.js` is
    // what a deeper reach would look like.
    expect(reachesTestSupport('@audiogubbins/domain/testing')).toBe(true);
    expect(reachesTestSupport('@audiogubbins/domain/testing/unwrap.js')).toBe(true);
    expect(reachesTestSupport('@audiogubbins/domain')).toBe(false);
    expect(reachesTestSupport('@audiogubbins/design-system/styles/tokens.css')).toBe(false);
  });

  it('is declared as a dependency by no application or package', () => {
    const offenders: string[] = [];

    for (const manifest of manifests()) {
      if (manifest.includes('test-fixtures')) continue;

      const parsed = JSON.parse(read(manifest)) as { dependencies?: Record<string, string> };
      if ('@audiogubbins/test-fixtures' in (parsed.dependencies ?? {})) offenders.push(manifest);
    }

    expect(offenders).toEqual([]);
  });
});

describe('no placeholder survives into production code (REQ-EXEC-181)', () => {
  it('holds no unresolved marker', () => {
    // The lint rule catches these where they are written. This catches one that
    // arrives in a file the linter is not run over, and states the requirement
    // as a test so a reviewer can see it was checked.
    const markers = /\b(TODO|FIXME|HACK|XXX)\b/;
    expect(ALL_SOURCES.filter((path) => markers.test(read(path)))).toEqual([]);
  });

  it('throws no "not implemented"', () => {
    const notImplemented = /throw\s+new\s+Error\(\s*['"`][^'"`]*[Nn]ot implemented/;
    expect(ALL_SOURCES.filter((path) => notImplemented.test(readCode(path)))).toEqual([]);
  });

  it('suppresses no type error', () => {
    const suppression = /@ts-(expect-error|ignore|nocheck)/;
    expect(ALL_SOURCES.filter((path) => suppression.test(read(path)))).toEqual([]);
  });

  it('disables no lint rule without naming it and saying why', () => {
    const offenders: string[] = [];

    for (const path of ALL_SOURCES) {
      for (const line of read(path).split('\n')) {
        if (!line.includes('eslint-disable')) continue;

        // A disable with no rule named switches off everything, and one with no
        // reason is a decision nobody can review.
        const namesARule = /eslint-disable(-next-line|-line)?\s+[@a-z]/.test(line);
        const givesAReason = line.includes('--');
        if (!namesARule || !givesAReason) offenders.push(`${path}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the user-facing text is British English (REQ-PRIV-164)', () => {
  /**
   * American spellings AudioGubbins does not use in its own prose.
   *
   * Deliberately narrow. A broad list would catch an external API name, a CSS
   * property or a package identifier, all of which REQ-PRIV-164 explicitly
   * exempts, and a rule that cries wolf is a rule that gets switched off.
   */
  const AMERICAN =
    /\b(colors?|favorite|customiz(e|ed|ing|ation)|behaviors?|analyz(e|ed|ing)|normaliz(e|ed|ing|ation)|organiz(e|ed|ing)|recogniz(e|ed|ing)|initializ(e|ed|ing))\b/;

  /**
   * Lines where a foreign spelling is required rather than chosen.
   *
   * REQ-PRIV-164 exempts external standards, browser APIs, third-party library
   * APIs, file-format field names, CSS properties and source identifiers.
   */
  function isRequiredSpelling(line: string): boolean {
    return (
      // A line that imports from a module, whose names are that module's. Only
      // those: exempting every line beginning `export` would let an American
      // spelling through in any exported identifier or its documentation.
      /^\s*(?:import|export)\b[^;]*\bfrom\s*['"`]/.test(line) ||
      /^\s*import\s*['"`]/.test(line) ||
      // Standard names that have no British spelling: a meta name, and the CSS
      // properties and keyword that carry the word.
      /\b(?:theme-color|color-scheme|currentcolor)\b/i.test(line) ||
      /\b[a-z-]*color[a-z-]*\s*[:=]/i.test(line) ||
      // The same property named in prose. This codebase quotes an API name in
      // backticks, and `color-scheme` has no British spelling to prefer.
      /`[a-z-]*color[a-z-]*`/i.test(line) ||
      // A call to the language's own `String.prototype.normalize`, a built-in
      // API: the call alone, so the word in a sentence is still caught.
      line.includes('.normalize(') ||
      line.includes('--dv-') ||
      line.includes('categories:')
    );
  }

  it('uses no American spelling in prose or user-facing text', () => {
    const offenders: string[] = [];

    // The stylesheets and the page carry prose and user-facing text too: the
    // page's description and its no-script message are the first words a
    // visitor reads. In a stylesheet the prose is the comments; everything else
    // is property names and values, whose spelling the language fixes.
    const proseOf = (path: string): string =>
      path.endsWith('.css')
        ? read(path).replace(
            /[^\n]*?(\/\*[\s\S]*?\*\/)|[^\n]+/g,
            (_line, comment?: string) => comment ?? '',
          )
        : read(path);

    for (const path of [...ALL_SOURCES, ...ALL_STYLESHEETS, 'apps/web/index.html']) {
      for (const [index, line] of proseOf(path).split('\n').entries()) {
        if (isRequiredSpelling(line)) continue;
        if (AMERICAN.test(line)) offenders.push(`${path}:${String(index + 1)}: ${line.trim()}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('exempts an import from a module and nothing else that merely begins with a keyword', () => {
    expect(isRequiredSpelling("import { normalize } from 'some-library';")).toBe(true);
    expect(isRequiredSpelling("import 'some-library/colors.css';")).toBe(true);
    expect(isRequiredSpelling('export function normalize(value: number): number {')).toBe(false);
    expect(isRequiredSpelling('export const favorite = true;')).toBe(false);
  });

  it('exempts the standard names that carry the word, and no sentence', () => {
    expect(isRequiredSpelling('.querySelector(\'meta[name="theme-color"]\')')).toBe(true);
    expect(isRequiredSpelling('<meta name="theme-color" content="#000000" />')).toBe(true);
    expect(isRequiredSpelling("label: 'Choose a color',")).toBe(false);
  });

  it('exempts a CSS colour property, which has no British spelling', () => {
    expect(isRequiredSpelling('  background-color: var(--ag-chrome-surface-base);')).toBe(true);
    expect(
      isRequiredSpelling('   * the overscroll area all read `color-scheme` from the root.'),
    ).toBe(true);
    expect(isRequiredSpelling('  // Choose your favorite colors')).toBe(false);
  });

  it("exempts a call to the language's own normalize, and not the word in a sentence", () => {
    expect(isRequiredSpelling("      .normalize('NFKC')")).toBe(true);
    expect(isRequiredSpelling("  return name.normalize('NFC');")).toBe(true);
    expect(isRequiredSpelling('  // We normalize the name first.')).toBe(false);
    expect(isRequiredSpelling('export function normalize(value: number): number {')).toBe(false);
  });
});

describe('the package layering matches what the rules describe', () => {
  it('declares no dependency the layering does not allow', () => {
    const offenders: string[] = [];

    for (const manifest of packageManifests()) {
      const parsed = JSON.parse(read(manifest)) as {
        name: string;
        dependencies?: Record<string, string>;
      };

      const allowed = ALLOWED[parsed.name];
      if (allowed === undefined) {
        offenders.push(`${parsed.name} is not covered by the layering`);
        continue;
      }

      for (const dependency of Object.keys(parsed.dependencies ?? {})) {
        if (!dependency.startsWith('@audiogubbins/')) continue;
        if (!allowed.includes(dependency)) offenders.push(`${parsed.name} -> ${dependency}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('imports no AudioGubbins package its manifest does not declare, from any package', () => {
    // The layering above reads manifests, and the cruise holds only a leaf
    // package's imports to nothing, so this holds what every other package
    // imports: without it, an undeclared `@audiogubbins/input` imported from
    // the workspace package would resolve through the root's link to its source
    // and fail the typecheck alone, and a relative path into another package's
    // source would fail nothing else. What a manifest may declare is held
    // above.
    //
    // Every file of the package, its tests and test support with it: two
    // packages publish `src/testing/`, and read over production files alone, an
    // undeclared import from a test or from test support would be left to the
    // typecheck alone. Test code may import what the package declares for its
    // development as well.
    const offenders: string[] = [];
    const checked = manifests();
    expect(checked.length).toBe(Object.keys(ALLOWED).length + 1);

    for (const manifest of checked) {
      const root = manifest.slice(0, -'package.json'.length);
      const parsed = JSON.parse(read(manifest)) as {
        name: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const declared = new Set(Object.keys(parsed.dependencies ?? {}));
      const declaredForTests = new Set([...declared, ...Object.keys(parsed.devDependencies ?? {})]);

      const own = [...EVERY_SOURCE, ...ALL_STYLESHEETS].filter((path) => path.startsWith(root));
      for (const path of own) {
        const allowed = isTestCode(path) ? declaredForTests : declared;
        for (const specifier of importsOf(path)) {
          const name = packageOf(specifier);
          if (
            name?.startsWith('@audiogubbins/') === true &&
            name !== parsed.name &&
            !allowed.has(name)
          ) {
            offenders.push(`${path} -> ${name}`);
          }

          const reached = specifier.startsWith('.')
            ? posix.join(posix.dirname(path), specifier)
            : undefined;
          if (
            reached !== undefined &&
            /^(?:apps|packages)\//u.test(reached) &&
            !reached.startsWith(root)
          ) {
            offenders.push(`${path} -> ${reached}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('declares no dependency its own source does not import', () => {
    // The layering above says what a package may depend on, which is a ceiling.
    // This is the floor: a declared dependency must be imported by some file of
    // the package. An edge nobody uses is an edge the layering has to allow for
    // no reason, and it hides the real shape of the graph from whoever reads
    // the manifests to learn it.
    const offenders: string[] = [];
    const checked = manifests();
    expect(checked.length).toBe(Object.keys(ALLOWED).length + 1);

    for (const manifest of checked) {
      const root = manifest.slice(0, -'package.json'.length);
      const parsed = JSON.parse(read(manifest)) as {
        name: string;
        dependencies?: Record<string, string>;
      };

      const declared = Object.keys(parsed.dependencies ?? {});
      const imported = new Set(
        [...ALL_SOURCES, ...ALL_STYLESHEETS]
          .filter((path) => path.startsWith(root))
          .flatMap((path) => importsOf(path).map(packageOf)),
      );

      // A library can require its consumer to provide a package it uses, as the
      // docking engine's React bindings require `react-dom`. pnpm resolves a
      // peer from the consumer's own declarations, so that edge is used even
      // though no file of the consumer names it.
      const required = new Set(
        declared.flatMap((dependency) => Object.keys(peersOf(root, dependency))),
      );

      for (const dependency of declared) {
        if (!imported.has(dependency) && !required.has(dependency)) {
          offenders.push(`${parsed.name} -> ${dependency}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('declares for its tests no AudioGubbins package but the fixtures package, and that only where a test takes it', () => {
    // The layering above reads the dependencies a package runs with. What its
    // tests alone take is declared as a development dependency, which reaches
    // no one who uses the package, and ADR-0019 opens that edge to the fixtures
    // package alone: any other AudioGubbins package declared there would let
    // the package's tests import it, past the layering, with no rule failing.
    // The declaration is held to a use as well, as a dependency is above: a
    // development dependency on the fixtures package that no test takes is an
    // edge the layering allows for no reason.
    const offenders: string[] = [];
    const declaring: string[] = [];
    const checked = manifests();
    expect(checked.length).toBe(Object.keys(ALLOWED).length + 1);

    for (const manifest of checked) {
      const root = manifest.slice(0, -'package.json'.length);
      const parsed = JSON.parse(read(manifest)) as {
        name: string;
        devDependencies?: Record<string, string>;
      };
      const taken = new Set(
        EVERY_SOURCE.filter((path) => path.startsWith(root) && isTestCode(path)).flatMap((path) =>
          importsOf(path).map(packageOf),
        ),
      );

      for (const dependency of Object.keys(parsed.devDependencies ?? {})) {
        if (!dependency.startsWith('@audiogubbins/')) continue;
        if (dependency !== FIXTURES) {
          offenders.push(`${parsed.name} -> ${dependency}: not the fixtures package`);
        } else if (!taken.has(dependency)) {
          offenders.push(`${parsed.name} -> ${dependency}: no test takes it`);
        } else {
          declaring.push(parsed.name);
        }
      }
    }

    // Named, so that a rule reading no development dependency would not pass.
    expect(declaring.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('keeps each package the layering gives no dependency a leaf in the import graph too', () => {
    // The manifests are read above, and the cruise's rule against an undeclared
    // dependency passes over another package's source, so each leaf is held in
    // the import graph by a rule of its own, and every package the layering
    // gives no dependency must have one: without it, a leaf such as the text
    // package, below four others, could import any of them with no architecture
    // rule failing.
    const suffix = '-owns-nothing-else';
    const rules = new Map(
      CRUISER.forbidden
        .filter((rule) => rule.name.endsWith(suffix))
        .map((rule) => [rule.name.slice(0, -suffix.length), rule] as const),
    );
    const short = (name: string): string => name.replace('@audiogubbins/', '');

    for (const [name, allowed] of Object.entries(ALLOWED)) {
      const rule = rules.get(short(name));
      if (allowed.length === 0) {
        expect(rule, `${short(name)} has no rule of its own in the cruise`).toBeDefined();
      }
      if (rule === undefined) continue;

      // And a package that has one is held to what the layering allows it,
      // with nothing left out of what the rule refuses but the fixtures
      // package, and that only where the package's tests may take it.
      expect(rule.from.path, short(name)).toBe(`^packages/${short(name)}/`);
      expect(packagesNamed(rule.to.path), short(name)).toEqual(
        [short(name), ...allowed.map(short)].sort(),
      );
      expect(rule.to.pathNot, short(name)).toBe(
        TESTS_TAKE_THE_FIXTURES.has(short(name)) ? '^packages/test-fixtures/' : undefined,
      );
    }
    expect(
      [...rules.keys()].filter((name) => ALLOWED[`@audiogubbins/${name}`] === undefined),
    ).toEqual([]);
    expect([...TESTS_TAKE_THE_FIXTURES].filter((name) => !rules.has(name))).toEqual([]);
  });

  it('covers every package in the workspace, so none escapes the layering', () => {
    const present = sourcesMatching('packages/*/package.json').map(
      (manifest) => (JSON.parse(read(forwardSlashes(manifest))) as { name: string }).name,
    );

    expect(present.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('has no cycle, because the layering is an order', () => {
    // dependency-cruiser also checks this over the import graph. This checks
    // the declared graph, which is what a consumer installing the packages
    // would get.
    expect(findCycle(ALLOWED)).toBeUndefined();
  });

  it('would find a cycle if one existed', () => {
    // The rule above passes trivially if the walk never recurses. This control
    // calls the walk the rule calls rather than a copy of it, so it proves the
    // code the rule rests on, against graphs that loop at different depths.
    expect(findCycle({ a: ['b'], b: ['a'] })).toEqual(['a', 'b', 'a']);
    expect(findCycle({ a: ['b'], b: ['c'], c: ['b'] })).toEqual(['a', 'b', 'c', 'b']);
    expect(findCycle({ a: ['a'] })).toEqual(['a', 'a']);
  });

  it('finds no cycle where paths only meet', () => {
    // Two routes to one package are a diamond, which the layering allows.
    expect(findCycle({ a: ['b', 'c'], b: ['d'], c: ['d'], d: [] })).toBeUndefined();
  });
});

describe('the workspace graph is what the tools generated', () => {
  it('gives every package the same product version', () => {
    const { product } = JSON.parse(read('version.json')) as { product: string };

    for (const manifest of manifests()) {
      const parsed = JSON.parse(read(manifest)) as { version: string };
      expect(parsed.version).toBe(product);
    }
  });

  it('keeps the licence on every package', () => {
    for (const manifest of manifests()) {
      expect((JSON.parse(read(manifest)) as { license: string }).license).toBe('Apache-2.0');
    }
  });

  it('declares a stylesheet entry point exactly when the package has stylesheets', () => {
    // A manifest that declares one without the directory offers a public path
    // to nothing, and the generator writes every manifest, so one mistake there
    // reaches every package. Read both ways, so neither a missing entry nor a
    // stray one passes.
    const declared = packageManifests().map((manifest) => {
      const exports = (JSON.parse(read(manifest)) as { exports: Record<string, unknown> }).exports;
      const directory = manifest.replace(/package\.json$/, 'src/styles');
      return {
        manifest,
        declares: './styles/*.css' in exports,
        has: existsSync(inRepository(directory)),
      };
    });

    expect(declared.filter((one) => one.declares !== one.has)).toEqual([]);
    // Both answers occur, so the comparison is not true of every package by
    // default.
    expect(declared.some((one) => one.has)).toBe(true);
    expect(declared.some((one) => !one.has)).toBe(true);
  });

  it('keeps every package private, because none is published yet', () => {
    for (const manifest of manifests()) {
      expect((JSON.parse(read(manifest)) as { private: boolean }).private).toBe(true);
    }
  });

  it('runs every package in exactly one Vitest project', () => {
    // A package in no Vitest project has its tests collected by nothing, run by
    // nothing and reported missing by nothing. The project list is generated
    // beside the declaration that owns the package list, and `pnpm graph:check`
    // fails when it is stale; this holds the generated file to the packages
    // themselves, and the configuration to the generated file.
    const { projects } = JSON.parse(read('vitest.projects.json')) as {
      projects: readonly { name: string; root: string; environment: string }[];
    };

    expect(projects.map((one) => one.root).toSorted()).toEqual(
      manifests()
        .map((manifest) => manifest.replace(/\/package\.json$/, ''))
        .toSorted(),
    );
    // Both environments occur, so the rule is not passing on one answer.
    expect(new Set(projects.map((one) => one.environment))).toEqual(new Set(['node', 'jsdom']));

    // And the configuration reads it: were the spread replaced by a
    // hand-written array, every package would be collected by nothing while the
    // generated file still matched the manifests.
    const config = read('vitest.config.ts');
    expect(config).toContain("from './vitest.projects.json'");
    expect(config).toContain('...generated.projects.map(');
  });
});

/**
 * Rules that hold two statements of one fact equal.
 *
 * A fact a build cannot derive is written in two places or three: a media
 * query cannot read a custom property, the cruiser's exclusions are its own
 * file's, and the redaction lists live in the package that reads no other
 * package's source. Each of these holds the statements together, so neither
 * can be edited alone.
 */
describe('one fact, held the same in every place it is written', () => {
  it('excludes from the cruise exactly what the rules read as build output', () => {
    // The two are one fact written twice: the rules call `dist`, `build` and
    // the rest build output, the cruiser excludes the same directories, and the
    // bundled application really does write its declarations to `build/`.
    //
    // Both of the exclusion's groups are read, the second of which adds a
    // tool's own output at the root, so an edit confined to either fails here.
    const groups = [...read('.dependency-cruiser.cjs').matchAll(/\((dist\|[^)]*)\)/g)].map(
      (group) => group[1]?.split('|') ?? [],
    );

    expect(groups).toEqual([
      [...BUILD_OUTPUT_DIRECTORIES],
      [...BUILD_OUTPUT_DIRECTORIES, ...EXCLUDED_AT_THE_ROOT],
    ]);
  });

  it('keeps out of the tree every directory the rules read as build output', () => {
    // And the third place each has to be: were one taken out of `.gitignore`,
    // the development server's output would leave the tree dirty after its next
    // run with every suite green.
    const ignored = new Set(
      read('.gitignore')
        .split(/\r?\n/u)
        .map((line) => line.trim()),
    );

    expect(
      [...BUILD_OUTPUT_DIRECTORIES, ...EXCLUDED_AT_THE_ROOT].filter(
        (directory) => !ignored.has(`${directory}/`),
      ),
    ).toEqual([]);
  });

  // It runs both checkers over the tree: about 1 s alone and several times that
  // under the whole suite's load, so it is given a budget of its own rather
  // than Vitest's five-second default.
  it(
    'keeps ESLint and Prettier out of every directory the cruise excludes',
    { timeout: 30_000 },
    async () => {
      // And the checkers are two more readers of the same directories: were one
      // left out of either, running the development server would fail the lint
      // gate on work nobody has done, as it would the cruise.
      //
      // Each tool is asked through its own API whether it reads a file there,
      // so a pattern written in a shape the tool does not match fails as a
      // missing one does. Prettier is asked of `.prettierignore` alone, the
      // list kept whole for it: its command line also reads `.gitignore`, which
      // the rule above holds, and asked of both, this rule would pass with
      // `.prettierignore` missing an entry.
      const eslint = new ESLint({ cwd: REPOSITORY_ROOT });
      const ignorePath = inRepository('.prettierignore');
      const readersOf = async (file: string): Promise<readonly string[]> => {
        const path = inRepository(file);
        const readers: string[] = [];
        if (!(await eslint.isPathIgnored(path))) readers.push(`ESLint reads ${file}`);
        if (!(await getFileInfo(path, { ignorePath })).ignored) {
          readers.push(`Prettier reads ${file}`);
        }
        return readers;
      };
      const readersOfEach = async (files: readonly string[]): Promise<readonly string[]> => {
        const readers: string[] = [];
        for (const file of files) readers.push(...(await readersOf(file)));
        return readers;
      };

      // A build writes at the root, under each package and application, and
      // under `tests/`, where the cruise excludes its output.
      const places = ['.', 'tests', ...manifests().map((manifest) => posix.dirname(manifest))];
      const excluded = [
        ...BUILD_OUTPUT_DIRECTORIES.flatMap((directory) =>
          places.map((place) => posix.join(place, directory, 'index.js')),
        ),
        ...EXCLUDED_AT_THE_ROOT.map((directory) => posix.join(directory, 'index.js')),
      ];
      expect(await readersOfEach(excluded)).toEqual([]);

      // Both tools read a source file in each place, so neither answer passes
      // by leaving everything unread.
      const sources = places.map((place) => posix.join(place, 'src', 'index.js'));
      expect(await readersOfEach(sources)).toHaveLength(sources.length * 2);
    },
  );

  it('logs no field name redaction would take for a secret', () => {
    // The redaction rules are kept narrow to protect the vocabulary this tree
    // writes, and this reads the tree to check: were `code` widened into a
    // secret name while the command registry logs a field of that name, every
    // report would say the record that explains a command doing nothing had a
    // credential removed from it. The names live beside the rule that reads
    // them, in `redaction.test.ts`, because that package reads no other
    // package's source; this holds that list to what the tree really logs.
    //
    // A call on a name ending `logger`, at a method the interface offers, with
    // its fields written out in place. A logger held under another name, or
    // fields passed as a variable, is read by nothing here.

    // Each method of `Logger` that takes fields, with the place its fields
    // argument sits in: `measured` takes an operation and a duration first.
    // Read from the interface rather than written out beside the rule, so the
    // set cannot hold a level the interface does not offer or leave out one it
    // does, such as `warning`: the names only a missing level's calls carry
    // would be invisible here, and redacted as a credential in every report.
    const levels = new Map<string, number>();
    const readLevels = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'Logger') {
        for (const member of node.members) {
          if (!ts.isMethodSignature(member)) continue;
          const at = member.parameters.findIndex(
            (parameter) => parameter.type?.getText() === 'LogFields',
          );
          if (at !== -1) levels.set(member.name.getText(), at);
        }
      }
      ts.forEachChild(node, readLevels);
    };
    readLevels(parse('packages/diagnostics/src/logger.ts'));
    expect(levels.size).toBeGreaterThan(0);

    const logged = new Set<string>();

    for (const path of PRODUCTION_FILES) {
      const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const at = node.expression.expression.getText().endsWith('logger')
            ? levels.get(node.expression.name.text)
            : undefined;
          const fields = at === undefined ? undefined : node.arguments[at];
          if (fields !== undefined && ts.isObjectLiteralExpression(fields)) {
            for (const property of fields.properties) {
              const name = property.name?.getText();
              if (name !== undefined) logged.add(name.replaceAll(/['"`]/g, ''));
            }
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(parse(path));
    }

    const declared = /const LOGGED_FIELD_NAMES = \[([^\]]*)\]/.exec(
      read('packages/diagnostics/src/redaction.test.ts'),
    );
    const names = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((one) => one[1]);
    expect(names.length).toBeGreaterThan(0);

    expect([...logged].toSorted()).toEqual(names);
  });

  it('names every round the review record does, in the note that says where the work is', () => {
    // The note says where the work is, and the record is where each stage of it
    // is written up, so this holds the note to the record: a commit that writes
    // up a new stage cannot leave the note's status line and its list behind.
    //
    // The rounds are read out of the record's own headings. Written out as a
    // list of ordinals, the rule would stop widening at the last one with
    // nothing to say so, and the list would be a second statement of which
    // rounds exist — the shape this whole heading exists against.
    const record = read('docs/spec/reviews/phase-01-review.md');
    // Read as one run of words: the note's round list is a wrapped paragraph,
    // so a round's own number can sit on the line after the word "Round".
    const note = read('docs/todo/done/phase-01-application-foundation.md').replaceAll(/\s+/gu, ' ');

    const headings = roundHeadings(record);
    // A heading this table cannot read would be passed over in silence, which
    // is the failure a written-out list has.
    expect(headings.filter((ordinal) => roundOfOrdinal(ordinal) === undefined)).toEqual([]);

    const written = headings.map((ordinal) => `Round ${String(roundOfOrdinal(ordinal))}:`);

    // The first two rounds are the record's opening sections and carry no
    // heading of this shape, so the list starts at the third.
    expect(written.length).toBeGreaterThan(8);
    expect(written.filter((round) => !note.includes(round))).toEqual([]);

    // And the three other things the note has to keep up with: the status line,
    // the corrections sentence and the commit the fixes are in. Held apart from
    // the list, each of them could fall behind with every suite green.
    const latest = headings.at(-1) ?? '';
    const number = String(headings.length + 2);
    const said = note.toLowerCase();
    const status = (said.split('# phase 01')[0] ?? '').trim();

    expect(status, 'the status line names the latest round').toContain(latest);
    // Each read in its own sentence: found anywhere in the note, a number in
    // another sentence would hold both.
    const sentence = (opening: string): string =>
      new RegExp(`${opening}[^.]*\\.`, 'u').exec(said)?.[0] ?? '';
    const corrections = sentence('round 3 corrected ');
    const commits = sentence("round 4's two highs ");

    expect(corrections, 'the note has no corrections sentence').not.toBe('');
    expect(commits, 'the note has no commit list').not.toBe('');
    expect(corrections, 'the corrections sentence reaches the latest round').toContain(
      `round ${number} `,
    );
    expect(commits, 'the commit list reaches the latest round').toContain(`round ${number}'s`);
  });

  it("states each round's corrections where the record's markers count them", () => {
    // The resume note and the evidence each state how many corrections every
    // round made, and the record states it again in each round's section on
    // its corrections. Each is a count a script can make, so each is held to
    // the markers it counts: left to prose, a correction added to the record
    // after the others were written leaves them a number behind with every
    // suite green.
    const record = read('docs/spec/reviews/phase-01-review.md');
    const markers = correctionMarkers(record);
    expect(markers.unread, 'markers naming a round no ordinal reads').toEqual([]);

    // The first two rounds wrote no marker, so the counts start at the third.
    const rounds = [...markers.read.keys()].toSorted((one, other) => one - other);
    expect(rounds.length).toBeGreaterThan(15);
    const first = rounds[0] ?? 0;
    const everyRound = asLines(
      countedAs(
        rounds.map((round) => ({ round, of: Counted.Corrections, stated: undefined })),
        markers.read,
      ),
    );

    // Every round the record counts, in order, each at its count: a round left
    // out, a round named twice and a number that is no count all fail.
    const note = sentenceOpening(
      read('docs/todo/done/phase-01-application-foundation.md'),
      `round ${String(first)} corrected `,
    );
    expect(note, 'the note has no corrections sentence').toBeDefined();
    expect(asLines(countsByNumber(note ?? '')), 'the resume note').toEqual(everyRound);

    const evidence = sentenceOpening(
      read('docs/spec/reviews/phase-01-evidence.md'),
      `the ${ORDINALS[first - 1] ?? ''} round corrected `,
    );
    expect(evidence, 'the evidence has no corrections sentence').toBeDefined();
    const byOrdinal = countsByOrdinal(evidence ?? '');
    expect(byOrdinal.unread, 'words after "the" that are no ordinal and no known prose').toEqual(
      [],
    );
    expect(asLines(byOrdinal.read), 'the evidence').toEqual(everyRound);

    // A section that states no count of its own fails too, rather than being
    // passed over in whatever shape it was written.
    const sections = sectionCounts(record);
    expect(sections.unread, 'sections naming a round no ordinal reads').toEqual([]);
    expect(sections.read.length).toBeGreaterThan(10);
    expect(asLines(sections.read), "each round's section on its corrections").toEqual(
      asLines(countedAs(sections.read, markers.read)),
    );
  });

  it("reads a round's markers only with their parenthesis, and each count by its words", () => {
    expect(['nineteen', 'Twenty-five', 'fifty-eight', 'ninety-nine'].map(numberOfWords)).toEqual([
      19, 25, 58, 99,
    ]);
    expect(['twenty five', 'rows', 'hundred'].map(numberOfWords)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    const markers = correctionMarkers(
      [
        'Each is written into its row as **Corrected in the ninth round**, with the',
        'finding that showed it.',
        '| F-1 | **Fixed.** **Corrected in the ninth round (F-2).** |',
        '| F-3 | **Fixed.** **Corrected in the ninth round (Testing).** |',
        'The preamble said two premises. **Corrected in',
        'the ninth round (F-6).** It said three.',
        '| F-4 | **Corrected in the umpteenth round (F-5).** |',
        '| F-7 | **Corrected in the twenty-first round (F-8).** |',
        '| F-9 | **Corrected in the twenty-umpteenth round (F-10).** |',
      ].join('\n'),
    );
    expect([...markers.read.entries()]).toEqual([
      [9, { corrections: 3, rows: 2 }],
      [21, { corrections: 1, rows: 1 }],
    ]);
    expect(markers.unread).toEqual(['umpteenth', 'twenty-umpteenth']);

    // Past the twentieth, an ordinal is two words joined by a hyphen, as far as
    // the ninety-ninth.
    expect(['twentieth', 'twenty-first', 'thirtieth', 'ninety-ninth'].map(roundOfOrdinal)).toEqual([
      20, 21, 30, 99,
    ]);
    expect(
      roundHeadings(
        [
          '## The ninth round, over the eighth remediation',
          '',
          '## The twenty-first round, over the twentieth remediation',
        ].join('\n'),
      ),
    ).toEqual(['ninth', 'twenty-first']);

    const sections = sectionCounts(
      [
        '### Corrections the eighth round made to earlier rows',
        '',
        'Each is written into its row as **Corrected in the eighth round**, with the',
        'finding that showed it. Thirty-six rows.',
        '',
        '## The ninth round, over the eighth remediation',
        '',
        '### What the ninth round corrects in earlier rows',
        '',
        'Twenty-five corrections, each written where the claim it corrects is:',
        'twenty-three are rows, and two are paragraphs.',
        '',
        '### What the tenth round corrects in earlier rows',
        '',
        'Each is written where it belongs, and three are rows.',
        '',
        'Seven corrections are described below.',
        '',
        '### What the twenty-first round corrects in earlier rows',
        '',
        'Two corrections, each written where the claim it corrects is.',
        '',
        '### What the twenty-umpteenth round corrects in earlier rows',
        '',
        'Four corrections.',
      ].join('\n'),
    );
    expect(asLines(sections.read)).toEqual([
      'round 8: 36 rows',
      'round 9: 25 corrections',
      'round 9: 23 rows',
      'round 10: undefined corrections',
      'round 10: 3 rows',
      'round 21: 2 corrections',
    ]);
    expect(sections.unread).toEqual(['twenty-umpteenth']);

    expect(
      asLines(
        countsByNumber(
          'round 3 corrected nineteen round-2 dispositions, round 4 thirty-five earlier ones and round 18 twenty-five.',
        ),
      ),
    ).toEqual(['round 3: 19 corrections', 'round 4: 35 corrections', 'round 18: 25 corrections']);
    const byOrdinal = countsByOrdinal(
      'the third round corrected nineteen second-round dispositions that claimed more than the code did, the fourth thirty-five earlier ones, the eighteenth twenty-five, the twenty-first ten and the twenty-umpteenth four, each after what it first said.',
    );
    expect(asLines(byOrdinal.read)).toEqual([
      'round 3: 19 corrections',
      'round 4: 35 corrections',
      'round 18: 25 corrections',
      'round 21: 10 corrections',
    ]);
    expect(byOrdinal.unread).toEqual(['twenty-umpteenth']);
  });

  it('writes the width a docking workspace needs the same in all three places', () => {
    // A media query cannot read a custom property, so the number the message
    // names and the number the rule fires at cannot share a token, and the
    // browser suite names it a third time. The browser tests catch an edit to
    // one of them, but they are not in the commit tier, so a stylesheet changed
    // on its own would pass it.
    const declared = /export const SMALLEST_WORKSPACE_WIDTH = (\d+);/.exec(
      read('apps/web/src/shell/too-narrow.tsx'),
    );
    const fires = /@media \(width < (\d+)px\)/.exec(read('apps/web/src/shell/shell.css'));
    const suite = /const DECLARED = (\d+);/.exec(read('tests/e2e/smoke.spec.ts'));

    expect([fires?.[1], suite?.[1]]).toEqual([declared?.[1], declared?.[1]]);
    expect(declared?.[1]).toBeDefined();
  });
});

/**
 * Rules about how the rules themselves are written.
 *
 * Two of these read `tests/` and this repository's own source rather than the
 * application's; the third reads every file anyone writes, the application's
 * and the packages' included, because how a comment is placed is a rule about
 * how this tree is written rather than about any one part of it. A rule that
 * reads a narrower slice than its title claims is the failure they exist
 * against.
 */
describe('the architecture rules are written the way they claim', () => {
  it('reads every file anyone writes, the ones at the root included', () => {
    // The list's doc names the configuration files at the root and the web
    // application's build configuration, and each of these is one a narrower
    // glob would miss: `globSync` matches no leading dot, the cruiser's rules
    // and the linter's are `.cjs` and `.js`, and the build configuration is
    // under no `src/`. Two rules read this list, and a file it misses is read
    // by neither.
    //
    // Named files rather than a count: a count would be satisfied by any five.
    for (const path of [
      '.dependency-cruiser.cjs',
      'eslint.config.js',
      'playwright.config.ts',
      'vitest.config.ts',
      'apps/web/vite.config.ts',
    ]) {
      expect(EVERY_WRITTEN_FILE, path).toContain(path);
    }
  });

  it('turns a glob into paths in one place, and reads the repository root from another', () => {
    // `sourcesMatching` is the one place a rule turns a glob into paths, and
    // `tests/repository.ts` the one place the repository's root is found and
    // a path's backslashes are rewritten. A sentence a rule does not enforce
    // is one the next rule ignores, so all three are read here.
    //
    // Every file under `tests/`, not the rules alone: the tests over the build
    // output, the launchers and the repository settings need the root as much
    // as the rules do.
    //
    // Each is read by what it does rather than by the spelling of one call:
    // the root by what a file resolves against, whatever names the process or
    // the path module go by, and the rewrite by a backslash turned into a
    // forward slash, however either is written.
    //
    // All three are read by the compiler (see `path-reading.ts`), each file
    // compiled once for the three. A pattern would pass the forms nobody wrote
    // it for, and would have to leave this file out by name, because it writes
    // every form to test it. Read from the syntax, a form written as test data
    // is text rather than a call, so this file is read as every other is.
    const files = sourcesMatching('tests/**/*.{ts,tsx}');

    const uses = files.map((path) => ({ path, ...pathUses(read(path), path) }));

    expect(uses.filter((one) => one.expandsAGlob).map(({ path }) => path)).toEqual([
      'tests/architecture/source-reading.ts',
    ]);
    expect(uses.filter((one) => one.readsTheRoot).map(({ path }) => path)).toEqual([
      'tests/repository.ts',
    ]);
    expect(uses.filter((one) => one.rewritesBackslashes).map(({ path }) => path)).toEqual([
      'tests/repository.ts',
    ]);
  });

  it.each([
    ['a string replaced', String.raw`path.replaceAll('\\', '/')`],
    ['a regular expression replaced', String.raw`path.replace(/\\/gu, '/')`],
    ['a string split and joined', String.raw`path.split('\\').join('/')`],
    [
      'the separator split and joined',
      "import { posix, sep } from 'node:path';\npath.split(sep).join(posix.sep);",
    ],
    [
      'the qualified separator split and joined',
      "import path from 'node:path';\np.split(path.sep).join(path.posix.sep);",
    ],
    [
      'the qualified separator replaced',
      "import path from 'node:path';\np.replaceAll(path.sep, path.posix.sep);",
    ],
    [
      'the Windows separator by its full name',
      "import path from 'node:path';\np.split(path.win32.sep).join('/');",
    ],
    ['a template joined', "import path from 'node:path';\np.split(path.sep).join(`/`);"],
    ['a character class replaced', String.raw`p.replace(/[\\/]/gu, '/')`],
    ['a character class split and joined', String.raw`p.split(/[\\/]/u).join('/')`],
    ['a run of backslashes replaced', String.raw`p.replace(/\\+/gu, '/')`],
    ['a run of either slash replaced', String.raw`p.replace(/[\\/]+/g, '/')`],
    ['a regular expression built from text', String.raw`p.replace(new RegExp('\\\\', 'g'), '/')`],
    ['a backslash written by its code', "p.split(String.fromCharCode(92)).join('/');"],
    [
      'a backslash held in a constant',
      `${String.raw`const BACKSLASH = '\\';`}\np.replaceAll(BACKSLASH, '/');`,
    ],
    [
      'the separator taken apart from the module',
      "import path from 'node:path';\nconst { sep } = path;\np.split(sep).join('/');",
    ],
    [
      'the separator spread into the POSIX join',
      "import path from 'node:path';\npath.posix.join(...p.split(path.sep));",
    ],
    [
      'the separator of a module taken from require',
      "const path = require('node:path');\np.split(path.sep).join('/');",
    ],
    ['a replacement called in brackets', String.raw`p['replace'](/\\/gu, '/')`],
    ['a split and a join called in brackets', String.raw`p['split']('\\')['join']('/')`],
  ])('recognises %s as the forward-slash rewrite', (_form, code) => {
    expect(pathUses(code).rewritesBackslashes).toBe(true);
  });

  it.each([
    ['a backslash doubled for a PowerShell literal', String.raw`text.replaceAll('\\', '\\\\')`],
    ['a dot turned into a slash', String.raw`name.replace(/\./gu, '/')`],
    [
      'a POSIX path split and joined again',
      "import path from 'node:path';\np.split(path.posix.sep).join('/');",
    ],
    [
      'a path spread into the Windows join',
      "import path from 'node:path';\npath.win32.join(...p.split(path.sep));",
    ],
    ['a rewrite written as test data', String.raw`const form = "p.replaceAll('\\', '/')";`],
  ])('does not mistake %s for the forward-slash rewrite', (_form, code) => {
    expect(pathUses(code).rewritesBackslashes).toBe(false);
  });

  it.each([
    ['the module URL', "new URL('..', import.meta.url)"],
    ['the working directory', 'const root = process.cwd();'],
    ['a CommonJS directory name', "join(__dirname, '..')"],
    [
      'the working directory resolved',
      "import { resolve } from 'node:path';\nconst root = resolve();",
    ],
    [
      'the current directory resolved',
      "import path from 'node:path';\nconst root = path.resolve('.');",
    ],
    [
      'the current directory resolved with a slash',
      "import path from 'node:path';\npath.resolve('./');",
    ],
    ['a relative path resolved', "import { resolve } from 'node:path';\nresolve('..');"],
    [
      'a file at the root resolved',
      "import * as path from 'node:path';\npath.resolve('package.json');",
    ],
    [
      'resolve imported under another name',
      "import { resolve as here } from 'node:path';\nhere();",
    ],
    ['resolve taken from require', "require('node:path').resolve();"],
    [
      'resolve taken apart from the module',
      "import path from 'node:path';\nconst { resolve: at } = path;\nat('.');",
    ],
    ['the POSIX resolve', "import { posix } from 'node:path';\nposix.resolve();"],
    ['the working directory npm leaves', 'const root = process.env.INIT_CWD;'],
    [
      'the working directory imported from the process module',
      "import { cwd } from 'node:process';\ncwd();",
    ],
    ['the process module imported whole', "import process from 'node:process';\nprocess.cwd();"],
    ['the working directory taken apart from the process', 'const { cwd } = process;\ncwd();'],
    ['the working directory read in brackets', "process['cwd']();"],
    ['the process reached through globalThis', 'globalThis.process.cwd();'],
    [
      'the environment taken apart from the process',
      'const { env } = process;\nconst root = env.INIT_CWD;',
    ],
    ['a variable taken apart from the environment', 'const { INIT_CWD } = process.env;'],
  ])('recognises %s as a way to the repository root', (_form, code) => {
    expect(pathUses(code).readsTheRoot).toBe(true);
  });

  it.each([
    ['a promise resolved', 'await Promise.resolve();'],
    [
      'a path resolved against a root it is given',
      "import { resolve } from 'node:path';\nresolve(root, 'x');",
    ],
    ['a promise settled by its own resolve', 'new Promise((resolve) => { resolve(); });'],
    [
      'a promise settled by its own resolve, where the path module is imported',
      "import { resolve } from 'node:path';\nnew Promise((resolve) => { resolve(); });",
    ],
    ['an absolute path resolved', "import path from 'node:path';\npath.resolve('/srv/data');"],
    ['a directory name read as a member', 'const where = bundle.__dirname;'],
    ['a process of its own', "const process = { cwd: () => '/srv' };\nprocess.cwd();"],
    ['another variable of the environment', 'const home = process.env.HOME;'],
  ])('does not mistake %s for a way to the repository root', (_form, code) => {
    expect(pathUses(code).readsTheRoot).toBe(false);
  });

  it.each([
    ['the synchronous glob', "import { globSync } from 'node:fs';\nglobSync('*.ts');"],
    ['the glob of the promises', "import { glob } from 'node:fs/promises';\nglob('*.ts');"],
    [
      'the glob under another name',
      "import { globSync as expand } from 'node:fs';\nexpand('*.ts');",
    ],
    ['the glob of the whole module', "import * as fs from 'node:fs';\nfs.promises.glob('*.ts');"],
  ])('recognises %s as a glob turned into paths', (_form, code) => {
    expect(pathUses(code).expandsAGlob).toBe(true);
  });

  it.each([
    ['a glob written as test data', "const form = 'globSync(pattern)';"],
    ['a function of its own of the same name', 'const globSync = () => [];\nglobSync();'],
  ])('does not mistake %s for a glob turned into paths', (_form, code) => {
    expect(pathUses(code).expandsAGlob).toBe(false);
  });

  it('leaves no doc comment standing above another, which strands the first', () => {
    // A declaration inserted between a doc comment and what it describes leaves
    // the comment reading as the new declaration's and the old one with none.
    // `redactText`'s comment states the order its steps must keep, which is
    // what stops a credential inside a URL surviving redaction, and stranded
    // above another function it would describe one that orders nothing. Moving
    // it back holds only until the next insertion, so the shape is refused
    // wherever it occurs.
    //
    // Any block comment below, indented or not, and a JSX comment with it: a
    // `/*` in a build configuration and one in a stylesheet, where every
    // comment is one, are stranded the same way, and this tree writes a doc
    // comment above nearly every member of an interface, which is where two
    // indented ones stack. A blank line between them is a pair of comments
    // about two things and matches nothing here, because the line above is then
    // blank.
    //
    // The JSX form is the same comment inside braces, and a stacked pair of
    // them directly above a heading in markup is the shape this exists against.
    const endsABlockComment = (line: string): boolean => {
      const end = line.trimEnd();
      return end.endsWith('*/') || end.endsWith('*/}');
    };
    const opensABlockComment = (line: string): boolean => {
      const start = line.trimStart();
      return start.startsWith('/*') || start.startsWith('{/*');
    };

    const stranded = EVERY_WRITTEN_FILE.flatMap((path) => {
      const lines = read(path).split('\n');
      return lines
        .map((line, index) => {
          const above = lines[index - 1];
          return above !== undefined && endsABlockComment(above) && opensABlockComment(line)
            ? `${path}:${String(index + 1)}`
            : undefined;
        })
        .filter((one) => one !== undefined);
    });

    expect(stranded).toEqual([]);
  });
});

describe('the direction between the parts of the application', () => {
  /** Where the application's source starts. */
  const APPLICATION = 'apps/web/src/';

  /** The file a relative import from `path` names, or `undefined` for a package. */
  function target(path: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const from = path.slice(0, path.lastIndexOf('/'));
    return new URL(specifier, `file:///${from}/`).pathname.slice(1);
  }

  /**
   * The part of the application a file belongs to: the directory under `src/`
   * it is in, or, at the root, the file itself. The root holds the composition
   * root and the few modules beside it, each a part of its own, so a loop
   * through one of them is a loop like any other.
   */
  function partOf(path: string): string {
    const rest = path.slice(APPLICATION.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? rest.replace(/\.(tsx?|js)$/, '') : rest.slice(0, slash);
  }

  /** Each part, with every other part one of its files imports from. */
  function partGraph(
    paths: readonly string[],
    imports: (path: string) => readonly string[],
  ): Record<string, string[]> {
    const graph: Record<string, string[]> = {};
    for (const path of paths) {
      const from = partOf(path);
      const edges = (graph[from] ??= []);
      for (const specifier of imports(path)) {
        const reached = target(path, specifier);
        if (reached?.startsWith(APPLICATION) !== true) continue;
        const to = partOf(reached);
        if (to !== from && !edges.includes(to)) edges.push(to);
      }
    }
    return graph;
  }

  it('arranges the parts of the application in one direction, with no loop through any', () => {
    // A rule for one pair of directories would let a loop through a third pass,
    // such as the stores to the input, the input to the commands, and the
    // commands back to the stores, so the whole graph of parts is walked. The
    // walk is the one the package rule reads.
    const application = ALL_SOURCES.filter((path) => path.startsWith(APPLICATION));

    expect(findCycle(partGraph(application, importsOf))).toBeUndefined();
  });

  it('finds a loop through three parts, and one through a file at the root', () => {
    const loops = (imports: ReadonlyMap<string, readonly string[]>) =>
      findCycle(partGraph([...imports.keys()], (path) => imports.get(path) ?? []));

    expect(
      loops(
        new Map([
          ['apps/web/src/state/store.ts', ['../input/reader.js']],
          ['apps/web/src/input/reader.ts', ['../commands/command.js']],
          ['apps/web/src/commands/command.ts', ['../state/store.js']],
        ]),
      ),
    ).toEqual(['state', 'input', 'commands', 'state']);
    expect(
      loops(
        new Map([
          ['apps/web/src/shell/view.tsx', ['../names.js']],
          ['apps/web/src/names.ts', ['./shell/view.js']],
        ]),
      ),
    ).toEqual(['shell', 'names', 'shell']);
  });

  /** Every file among `sources` under `state/` that imports from `commands/`. */
  function stateReachingCommands(
    sources: readonly string[],
    imports: (path: string) => readonly string[],
  ): readonly string[] {
    return sources.filter(
      (path) =>
        path.startsWith(`${APPLICATION}state/`) &&
        imports(path).some((specifier) =>
          target(path, specifier)?.startsWith(`${APPLICATION}commands/`),
        ),
    );
  }

  it('keeps the stores from importing the commands that act on them', () => {
    // The commands act on the stores, so they import them. A store importing a
    // command module closes a loop between the two directories, as a default
    // profile kept among the commands and imported by the shortcut state would.
    const stores: string[] = [];
    const reaching = stateReachingCommands(ALL_SOURCES, (path) => {
      stores.push(path);
      return importsOf(path);
    });

    expect(reaching).toEqual([]);
    // A rule that read no store would pass having checked nothing.
    expect(stores).not.toEqual([]);
  });

  it('finds a store importing a command module, so the rule can fail', () => {
    // On files made here: read from the state's own tests, the control would
    // pass only while some test happened to import the command set.
    const imports = new Map([
      ['apps/web/src/state/store.ts', ["import { run } from '../commands/run.js';"]],
      ['apps/web/src/state/other.ts', ["import { read } from './read.js';"]],
    ]);

    expect(
      stateReachingCommands([...imports.keys()], (path) =>
        specifiersIn((imports.get(path) ?? []).join('\n')),
      ),
    ).toEqual(['apps/web/src/state/store.ts']);
  });
});

describe('the typecheck compiles every file anyone writes in TypeScript', () => {
  /** The scripts the root manifest declares. */
  const SCRIPTS = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

  /** The steps a script runs, in order. */
  function stepsOf(script: string): readonly string[] {
    const command = SCRIPTS[script];
    if (command === undefined) throw new Error(`package.json declares no script ${script}`);
    return command.split('&&').map((step) => step.trim());
  }

  /** Every command a script runs, in order, through each script it runs in turn. */
  function commandsOf(script: string): readonly string[] {
    return stepsOf(script).flatMap((step) => {
      const called = /^pnpm run (\S+)$/u.exec(step)?.[1];
      return called === undefined ? [step] : commandsOf(called);
    });
  }

  /**
   * The root project as the compiler reads it: its options, and the files it
   * lists, each from the repository's root.
   */
  function rootProject(): { readonly options: ts.CompilerOptions; readonly listed: string[] } {
    const root = inRepository();
    const config = ts.readConfigFile(inRepository('tsconfig.json'), (path) =>
      ts.sys.readFile(path),
    );
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    expect(parsed.errors).toEqual([]);

    const prefix = `${forwardSlashes(root)}/`;
    return {
      options: parsed.options,
      listed: parsed.fileNames.map((path) =>
        forwardSlashes(path).startsWith(prefix) ? forwardSlashes(path).slice(prefix.length) : path,
      ),
    };
  }

  it('compiles the configuration files at the root and directly in each application folder', () => {
    // The solution file's projects are the packages' and the applications'
    // `src/` and `tests/`, which leaves out the files beside them: the suite's
    // and the build's configuration, and what the build configuration loads,
    // such as the preview server's request log. The root project holds those,
    // and the typecheck script compiles it after the solution. A file its list
    // leaves out is compiled by nothing, whatever the linter reads, so the list
    // is read as the compiler reads it and held to every such file there is.
    expect(stepsOf('typecheck')).toEqual([
      'tsc --build tsconfig.build.json',
      'tsc -p tsconfig.json',
    ]);

    const { options, listed } = rootProject();

    // The options on their own, as the compiler checks them before it reads a
    // file: an option that needs another one refuses the whole project.
    const refused = ts
      .createProgram({ rootNames: [], options })
      .getOptionsDiagnostics()
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    expect(refused).toEqual([]);

    const beside = [...sourcesMatching('*.{ts,tsx}'), ...sourcesMatching('apps/*/*.{ts,tsx}')];
    // Named, so that a glob which matched nothing would not pass in silence.
    expect(beside).toEqual(
      expect.arrayContaining([
        'playwright.config.ts',
        'vitest.config.ts',
        'apps/web/vite.config.ts',
        'apps/web/preview-request-log.ts',
      ]),
    );
    expect(beside.filter((path) => !listed.includes(path))).toEqual([]);
  });

  it('forces the whole typecheck in the commit and integration gates', () => {
    // A build of the solution skips a project whose own files are no newer than
    // its record of the last build, and never asks whether a declaration it
    // reads from a dependency changed. A dependency upgraded, or a file put
    // back with an older time, is checked by nothing until a build is forced.
    // The everyday typecheck stays incremental, and each gate forces the whole
    // solution before the root project, through whichever scripts it runs.
    expect(stepsOf('typecheck:full')).toEqual([
      'tsc --build --force tsconfig.build.json',
      'tsc -p tsconfig.json',
    ]);
    for (const gate of ['verify:commit', 'verify:integration']) {
      const commands = commandsOf(gate);
      const forced = commands.indexOf('tsc --build --force tsconfig.build.json');
      expect(forced, `${gate} forces the solution`).not.toBe(-1);
      expect(commands, gate).not.toContain('tsc --build tsconfig.build.json');
      expect(commands.indexOf('tsc -p tsconfig.json', forced), gate).toBeGreaterThan(forced);
    }
  });

  it('compiles every tool a test imports, with no declaration beside it', () => {
    // A test calls a tool's exports in its own process, and a declaration
    // written beside the tool would be a second statement of them that nothing
    // holds to the code: a parameter removed, or a shape a function returns
    // changed, would compile on both sides. So each tool states its types in
    // its own JSDoc, and the root project compiles and checks it, which is what
    // makes a call that no longer fits fail the typecheck.
    const imported = [
      ...new Set(
        TEST_CODE_FILES.flatMap((path) =>
          importsOf(path)
            .filter((specifier) => specifier.startsWith('.'))
            .map((specifier) => posix.join(posix.dirname(path), specifier))
            .filter((target) => target.startsWith('tools/')),
        ),
      ),
    ].toSorted();
    // Named, so that a reading which found no import would not pass in silence.
    expect(imported).toEqual(
      expect.arrayContaining(['tools/check-build-output.mjs', 'tools/check-record-titles.mjs']),
    );
    expect(sourcesMatching('tools/**/*.d.{ts,mts,cts}')).toEqual([]);

    const { options, listed } = rootProject();
    expect({ allowJs: options.allowJs, checkJs: options.checkJs }).toEqual({
      allowJs: true,
      checkJs: true,
    });
    expect(imported.filter((path) => !listed.includes(path))).toEqual([]);
  });
});

describe('module cohesion (REQ-EXEC-136.7)', () => {
  /**
   * The review threshold, not a limit.
   *
   * REQ-EXEC-136.7 makes roughly 300 to 400 logical lines a trigger for a
   * cohesion review rather than an automatic failure, and prohibits splitting a
   * coherent concept into meaningless files to satisfy a number. Nothing is
   * over the threshold today, and the rule has no list of exceptions: a file
   * past it fails until it is split, or until a record of reviewed exceptions
   * is added beside this rule with each one's justification, which keeps an
   * exception visible rather than raising the number for everything.
   */
  const THRESHOLD = 400;

  /** Lines that are neither blank nor comment. */
  function logicalLines(source: string): number {
    let inBlockComment = false;
    let count = 0;

    for (const raw of source.split('\n')) {
      const line = raw.trim();

      if (inBlockComment) {
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      if (line === '') continue;
      if (line.startsWith('//')) continue;
      if (line.startsWith('/*')) {
        if (!line.includes('*/')) inBlockComment = true;
        continue;
      }

      count += 1;
    }

    return count;
  }

  it('measures logical lines rather than raw ones', () => {
    // These files are heavily commented by design, so a raw line count would
    // report almost all of them and mean nothing.
    expect(logicalLines('// a\n\n/* b\n c */\nconst x = 1;\n')).toBe(1);
  });

  it('has no production file past the cohesion threshold without review', () => {
    const oversized = ALL_SOURCES.map((path) => ({ path, lines: logicalLines(read(path)) }))
      .filter((entry) => entry.lines > THRESHOLD)
      .map((entry) => `${entry.path} (${String(entry.lines)} logical lines)`);

    expect(oversized).toEqual([]);
  });

  /**
   * Where the review band starts.
   *
   * REQ-EXEC-136.7 names 300 to 400 logical lines as the band that triggers a
   * cohesion review, and a rule that spoke only past 400 would be silent across
   * the whole band, so each file inside it is held to a recorded review.
   */
  const REVIEW_BAND_START = 300;

  /**
   * How far a reviewed file may move from the size it was reviewed at before
   * it is reviewed again, in logical lines.
   */
  const FILE_SIZE_TOLERANCE = 10;

  /**
   * Every production file inside the review band, with the size it was
   * reviewed at and the review that kept it whole.
   *
   * A file that enters the band fails this until its review is written here,
   * beside its path, and one that moves from its recorded size by more than the
   * tolerance fails until it is reviewed again. Recorded without a size, a file
   * could grow from the start of the band to its end under a review of what it
   * had been. A file with a seam is split along it rather than recorded.
   *
   * The number is the size the review beside it was written against, and it is
   * not rewritten from the tree: rewritten, it would always match, the rule
   * would never fire, and nothing would say a review had gone stale. A review
   * that reports having regenerated these has described something that would
   * destroy what they are for.
   */
  const REVIEWED_IN_BAND: Readonly<Record<string, readonly [lines: number, review: string]>> = {
    'apps/web/src/commands/panel-commands.ts': [
      314,
      "Every command that acts on the panels on screen, each a small builder over one list: opening a panel per kind, closing the one in use, the arrangement the dock reports, and the four families that stand in for the engine's pointer gestures \u2014 moving a panel to a region, sizing its group, nudging a floating group and moving a panel along its group's tabs. The four share one builder, so what is left of each family is a table: an identifier, a label, keywords, the store method it calls and the sentence it says. Split by family, the four files would each hold one table and the shared builder and helpers would move to a fifth.",
    ],
    'apps/web/src/shell/settings/shortcuts.tsx': [
      313,
      'One settings section: the profile in force and what is done to it as a whole, then one table of every command a user can bind, with the row being edited holding the recorder. Each part is already a component of its own \u2014 the header, which says once why a control that names something cannot be used, the profile actions, the conflict, reserved and waiting notes, and the row \u2014 and what is left in the section is the props they share, the reasons the header and every row read, and the one piece of state that says which row is being edited. The notes are `shortcut-notes.tsx`, the recorder is `shortcut-recorder.tsx` and the control that reads a profile from a file is `import-profile.tsx`; splitting the table from the header would separate the row from the state that decides which row is open.',
    ],
    'apps/web/src/state/workspace-store.ts': [
      361,
      "The workspace partition's one owner of state: every operation on the layout on screen and the saved workspaces, the restore of a deleted one and the discard of text that could not be read among them, updates the layout, the list, the notices, the wait for room, the unread text and the deletions in one observable update. Each rule it applies is a module of its own — the custody of unread text, the reading of a stored layout, the naming of a workspace — so what is left is the state and the methods that change it together; split, two halves would each need the whole state to publish one update.",
    ],
    'apps/web/src/state/source-change-store.ts': [
      312,
      "The linked files of the open project and the person's answers to their changes: looking at each file through the kept handles, saying when a look reached its end so the files may be read, taking at once what an asset's own policy takes, asking leave to read a file in the handler of the person's gesture, and taking each answer, relinking and taking a new version through the storage worker so a protected copy is kept. Each rule it applies is a module of its own — the records and the freeze command (`source-changes.ts`), the classification and the choices (the media store), the reading and copying of a file (the worker) — so what is left is the one observable state of the changes waiting and the methods that answer them; split, each half would need that state and the look in flight it is given up with.",
    ],
    'packages/storage/src/project-session.ts': [
      392,
      'The one route every change to an open project takes: running, grouping, undoing, redoing and moving through history, snapshots, branch names, comparison, compaction, exports and checkpoints. Each operation is a few lines over the shared ordering, writing and publishing, and the parts they share are modules of their own — the writer, the write queue, ownership, the events, compaction and the history moves — so what is left is the session state and the operations that change it together; the making of its writer and the retention a policy carries out on its own are modules of their own too. Split, each half would need the whole state and the one queue that keeps records in order.',
    ],
    'packages/diagnostics/src/path-finding.ts': [
      324,
      'Where a location starts and where it stops, for every form one is written in: a root of any kind, a path in quotes, a path without them, an address, and a file name written with no path at all. It is one algorithm read from both ends, and almost every line is a rule about a character a name can hold. Split by form, each part would need the others: a quoted path ends by the quote index the unquoted rules also read, an address ends where a path ends, and a file name ends before the name after it.',
    ],
    'packages/diagnostics/src/redaction.ts': [
      323,
      'What replaces each thing a report may not carry, in the one order the rules have to run in: inline data before anything reads its body, credentials before an address loses its authority, addresses before paths, paths before names, and network addresses last so one inside an address has already gone with it. The finding of each is elsewhere \u2014 credentials in `credentials.ts` and every location in `path-finding.ts` \u2014 and what is here is the placeholder, the tally and the order. Split, the order would be stated in whichever module ran them.',
    ],
    'packages/workspace/src/adapter/dockview-adapter.tsx': [
      328,
      "The one module that may name the docking engine, which the import rule and the dependency rule both hold to this file. What is left in it all reads or drives the engine: mounting a layout into it, with each panel's minimum and a main area split into groups side by side; reading back what it drew; watching it for a report, flushed when the page is hidden; and naming its tab lists and letting the keyboard into its groups on each report. The pairing with what it drew, which reads no engine type, is its own module (`baseline.ts`), tested without an engine. Split further, each part would be another module that names the engine.",
    ],
  };

  /**
   * Whether a file of this many logical lines is inside the review band.
   *
   * From 300 itself: the band is 300 to 400, so a file of exactly 300 lines is
   * inside it.
   */
  function inReviewBand(lines: number): boolean {
    return lines >= REVIEW_BAND_START && lines <= THRESHOLD;
  }

  it('names every production file inside the review band, with the review that kept it', () => {
    const inBand = ALL_SOURCES.filter((path) => inReviewBand(logicalLines(read(path))));

    expect(inBand.toSorted()).toEqual(Object.keys(REVIEWED_IN_BAND).toSorted());
  });

  it('reviews a file in the band again once it moves from the size it was reviewed at', () => {
    const moved = Object.entries(REVIEWED_IN_BAND).flatMap(([path, [recorded]]) => {
      const lines = logicalLines(read(path));
      return Math.abs(lines - recorded) > FILE_SIZE_TOLERANCE
        ? [`${path}: reviewed at ${String(recorded)}, now ${String(lines)}`]
        : [];
    });

    expect(moved).toEqual([]);
  });

  it('takes both ends of the band as inside it', () => {
    expect([299, 300, 400, 401].map(inReviewBand)).toEqual([false, true, true, false]);
  });

  /**
   * Where a function's review starts.
   *
   * REQ-EXEC-136.7: "A function approaching roughly 50-70 logical lines should
   * trigger a decomposition review." From 50 itself, as the file rule starts at
   * 300 itself: read as starting after it, a function of exactly 50 would go
   * unreviewed. Functions are measured as well as files, because a file under
   * the band can hold a component far past this start.
   */
  const FUNCTION_REVIEW_START = 50;

  /**
   * A function's name, as the record below keys it.
   *
   * Its own name, or the name of what it is assigned to through any wrapping
   * call, such as `useCallback`. A function passed straight to a call, as an
   * effect is, is named by the function around it and the call.
   */
  function functionName(node: ts.Node, file: ts.SourceFile): string {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      return node.name.getText(file);
    }

    // Through every call that wraps it: `memo(forwardRef(() => …))` is named
    // by what it is assigned to, as `useCallback(() => …)` is.
    let holder: ts.Node = node.parent;
    while (ts.isCallExpression(holder)) holder = holder.parent;
    if (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder)) {
      return holder.name.getText(file);
    }

    const call = ts.isCallExpression(node.parent) ? node.parent.expression.getText(file) : 'a';
    const outer = ts.findAncestor(node.parent, (one) => ts.isFunctionLike(one) && 'body' in one);
    const around = outer === undefined ? 'the module' : functionName(outer, file);
    return `${around} > ${call} callback`;
  }

  /** Every function in a source file from the review start, with its size. */
  function longFunctions(path: string): readonly { name: string; lines: number }[] {
    return longFunctionsIn(parse(path));
  }

  /**
   * Every function in a parsed file from the review start, with its size.
   *
   * A name a second function in the file shares is numbered, so neither can
   * stand in for the other in the record: unnumbered, two effects in one
   * component would share one key, and a recorded one could fall under the
   * start while another of the same name passed it, with the record still
   * matching. Every function is numbered before any is left out for its size:
   * numbered among the long ones alone, the second effect would take the first
   * one's key the moment the first fell under the start.
   */
  function longFunctionsIn(file: ts.SourceFile): readonly { name: string; lines: number }[] {
    const every: { name: string; lines: number }[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) && 'body' in node && node.body !== undefined) {
        every.push({
          name: functionName(node, file),
          lines: logicalLines(node.body.getText(file)),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);

    const seen = new Map<string, number>();
    return every
      .map(({ name, lines }) => {
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        return { name: count === 1 ? name : `${name} #${String(count)}`, lines };
      })
      .filter((one) => one.lines >= FUNCTION_REVIEW_START);
  }

  /**
   * How far a reviewed function may drift from the size its review was written
   * at before the review has to be read again.
   *
   * Held by name alone, a reviewed function could grow without end and the
   * review describing it go stale with the rule still green.
   */
  const FUNCTION_SIZE_TOLERANCE = 5;

  /**
   * Every production function from the review start, with the review that kept
   * it whole.
   *
   * Reviewed one at a time against its code: a function with a seam is split
   * along it rather than recorded, and each of these has none. A function that
   * reaches the start fails this until its review is written here, and one that
   * falls back under it fails until its entry is removed, so the record cannot
   * go stale.
   */
  const REVIEWED_FUNCTIONS: Readonly<Record<string, readonly [lines: number, review: string]>> = {
    // Tables: a list of independent definitions, each whole in itself.
    'apps/web/src/editor/intent-commands.ts: commandsOf': [
      57,
      'One arm for each kind of intent a tool makes, each the command or two it runs with the view it was made in; the switch is exhaustive over the intents, so a new one cannot be left without its command.',
    ],
    'apps/web/src/state/default-shortcuts.ts: editorBindings': [
      53,
      "A table of the editor's default bindings, one line each, beside the few helpers that write a key the same way on every layout; split, the table would be read in two places to find a free key.",
    ],
    'apps/web/src/commands/view-commands.ts: appearanceCommands': [
      214,
      'A list of independent appearance commands, each self-contained, sharing only the command builder and `unlessAlready`.',
    ],
    'apps/web/src/commands/shortcut-commands.ts: shortcutCommands': [
      168,
      "A list of eight independent shortcut-profile commands, each self-contained, the dismissal of the profiles' notice built beside it.",
    ],
    'apps/web/src/commands/diagnostic-commands.ts: diagnosticCommands': [
      175,
      'A list of seven independent diagnostic commands, each self-contained.',
    ],
    'apps/web/src/commands/workspace-commands.ts: layoutCommands': [
      125,
      "A list of six workspace commands, each self-contained but Rename, whose refusal of a built-in workspace reads Duplicate's availability, so Duplicate is built before the list.",
    ],
    'apps/web/src/commands/shell-commands.ts: surfaceCommands': [
      64,
      'Four commands that open and close the palette and the settings, each self-contained.',
    ],
    'apps/web/src/state/default-shortcuts.ts: placeDefaults': [
      98,
      'The bindings that ship as the default profile, each written as the character it is pressed with and given its reason; the helper that places a character, pressed with the usual modifier, on the layout the user types with, and the one that joins presses into a shortcut or names the characters it waits for; and the split of the placed defaults from those waiting for a key and those waiting for a Command press.',
    ],
    'packages/test-fixtures/src/projects.ts: sampleProject': [
      116,
      'Fixture data built in a fixed order, because the order of its identifiers is what makes them deterministic. Reviewed again when the region and the marker were anchored to the footstep (ADR-0051): the growth is their basis and loop fields, still data.',
    ],
    'apps/web/src/shell/menus.ts: shellMenus': [
      142,
      'Local entry builders over one set of menu sources, so that the menus themselves are written as a declarative table.',
    ],

    // Factories: private state closed over, with each returned method a unit.
    'apps/web/src/state/workspace-store.ts: createWorkspaceStore': [
      235,
      "Twenty-six small methods over one layout store and one state, beside the state's own `get` and `subscribe`, the largest about fifteen lines. The panel operations are each a line or two over the model and share `commit`; taken out, they would take the state, the store and `commit` with them. What it writes of the collection, and the text nobody has read that it keeps aside, are decided by `workspace-custody.ts`, and the reset and removal refusals are functions of the module beside it.",
    ],
    'packages/commands/src/registry.ts: createCommandBus': [
      121,
      'Three methods sharing a private run step and the logger; the largest, running a group, is about 45 lines.',
    ],
    'apps/web/src/state/shortcut-store.ts: createShortcutStore': [
      151,
      "Small methods over one profile in force, those that change it going through the shared `adopt` and `editable` helpers, and the subscription that places the defaults again as more of the keyboard layout is known. The largest, `editable`, is about a dozen lines. What identifier and name a profile is held under is the command package's, handed every profile the store holds. The profiles the user made are `user-profiles.ts`, and the defaults as placed are `shortcut-layout.ts`. The profiles as stored are `stored-profiles.ts`, and where a text that cannot be read is kept, and whether the profiles are written meanwhile, is `profile-custody.ts`, on the `text-custody.ts` the workspace's custody shares.",
    ],
    'packages/workspace/src/layout-store.ts: createLayoutStore': [
      76,
      'Small methods sharing the layouts and the built-in refusal rules.',
    ],
    'packages/capabilities/src/registry.ts: createCapabilityRegistry': [
      69,
      'The probing done once at creation, and methods reading its answers; what a feature can do is a pure function beside it.',
    ],
    'packages/diagnostics/src/logger.ts: createDiagnosticCentre': [
      60,
      'Verbosity and diagnostic mode, and the methods that change them; the logger it hands out is built beside it.',
    ],
    'packages/diagnostics/src/logger.ts: createLogger': [
      51,
      'One logger: the five severities, each a line through one shared write, and the measurement through the performance write.',
    ],
    'packages/diagnostics/src/log-store.ts: createLogStore': [
      54,
      'A bounded store whose methods share the record arrays and their cached snapshots.',
    ],
    'apps/web/src/application.ts: createApplication': [
      116,
      'The composition root: it builds each store and service once and wires them together, gives each the lifetime it has, ends that lifetime on `dispose`, and routes what the dock reports to the command bus. The keyboard layout, read from the map and learned from keys, is started by a function of its own, which answers the watch it leaves on the page, and the audio, editor and project parts are each started by one (the editor part in `editor-part.ts`, the project part in `state/project-system.ts`), so what is left here is the lines that hand each part its collaborators and gather what they give back.',
    ],

    // Components: hooks, then the tree they draw.
    'apps/web/src/app.tsx: AudioGubbins': [
      229,
      "Puts together eight independent surfaces, the project banner and the project surfaces among them, each given only what it needs; the status bar is given the project's save and backup status, each a component of its own. The chord wiring, the dock's report and what the shell reads are hooks of their own; what remains are three-line callbacks it hands the surfaces.",
    ],
    'apps/web/src/shell/command-palette.tsx: CommandPalette': [
      122,
      'One combobox: a field and its Enter handler, which read one query and one highlight, and the results they produce. The key navigation is `palette-navigation.ts` and the wait before the result count is said is `use-settled.ts`.',
    ],
    'apps/web/src/shell/settings/shortcut-recorder.tsx: ShortcutRecorder': [
      110,
      'One control whose key handler, spoken feedback and buttons all read the same presses and listening state.',
    ],
    'apps/web/src/shell/diagnostic-export.tsx: DiagnosticExportDialog': [
      130,
      'One consent dialogue whose switches, notes, redacted note and contents preview all read one selection and one set of redaction options, so what is shown is what is saved. What is said of the redaction and what is shown of it are two elements, because the note is as long as the reader made it and only a sentence can be read out; both are that one preview, said and shown.',
    ],
    'apps/web/src/shell/settings/workspaces.tsx: Workspaces': [
      85,
      'One settings section whose controls each run a workspace command, sharing only the name typed and the one rename the field and its button both ask for.',
    ],
    'apps/web/src/shell/diagnostics-panel.tsx: DiagnosticsPanel': [
      82,
      "One panel whose filter controls and record list share the reader's chosen level and subsystem, kept beside the dock as well so a remount keeps them.",
    ],
    'apps/web/src/shell/status-bar.tsx: StatusBar': [
      70,
      "A strip of short independent statements, with one focus effect for a dismissed notice. The bar's own height is published through the hook the notice surface publishes its height with, rather than by an effect written out here as well.",
    ],
    'apps/web/src/shell/settings-dialog.tsx: SettingsDialog': [
      75,
      "Puts six independent settings sections together as tabs, handing the Shortcuts section its props whole, and the project system's tabs, which `projectTabs` builds.",
    ],
    'apps/web/src/shell/settings/appearance.tsx: Appearance': [
      66,
      'Four independent controls, each running one appearance command.',
    ],
    'apps/web/src/shell/settings/diagnostics.tsx: Diagnostics': [
      51,
      'Independent diagnostic controls, each running one command.',
    ],
    'apps/web/src/shell/settings/shortcuts.tsx: Shortcuts': [
      79,
      "The profile's header, what is said of its bindings, and its table. The header, each note and each row are components of their own; the table stays, because it holds the one editing state its rows share. The rest is the props each note is handed, the keyboard's two among them.",
    ],
    'apps/web/src/shell/settings/shortcuts.tsx: ShortcutRow': [
      67,
      "One command's row: its name, its bindings or the recorder, and the two controls that change them, each control that unmounts itself handing focus back through `useFocusBackToChange`.",
    ],
    'apps/web/src/shell/use-shell-state.ts: useShellState': [
      62,
      'Nine subscriptions and what the shell derives from them; its two effects are hooks of their own.',
    ],

    // Procedures: one algorithm, or one validation step by step.
    'packages/design-system/src/tokens/chrome.ts: buildChrome': [
      111,
      'One derivation in which each token depends on those before it: base lightness, surfaces, the list of every surface a colour may be solved against, text, accent, status.',
    ],
    'packages/domain/src/processing/parameter.ts: validateParameterValue': [
      82,
      'An exhaustive switch over the three parameter kinds; most of its lines are the failure each rejection returns.',
    ],
    'packages/commands/src/shortcut-transfer.ts: readProfile': [
      56,
      'Validates one stored or imported profile step by step: JSON, envelope, version, name, bindings. What the platform takes is decided nowhere as it is read: it is said beside the table, and left out of what the keyboard answers to.',
    ],
    'packages/commands/src/shortcut-transfer.ts: parseBinding': [
      65,
      'Validates one stored binding step by step, its first press on its own, since a shortcut has one; most of its lines are failure literals.',
    ],
    'packages/audio-engine/src/dsp/reference/logarithm.ts: lnParts': [
      61,
      'The crate’s `ln_parts` in its operation order, one straight line of exact arithmetic with no branch past the reduction; split, it would no longer read against the Rust step for step. Its products’ errors go through a slot, so V8 boxes no double between its steps.',
    ],
    'packages/model-packs/src/install-state.ts: nextInstallState': [
      83,
      "The install state machine's whole table, one arm for each event, each the states that take it and where they go; the switch is exhaustive over the events, so an event cannot be left without its rule, and split by event the table would be read in twelve places to see what a state can take.",
    ],
    'packages/diagnostics/src/bundle.ts: assembleBundle': [
      60,
      'One pass that threads a single redaction tally through every category it includes.',
    ],
  };

  it('names every production function from the review start, with the review that kept it', () => {
    const long = ALL_SOURCES.flatMap((path) =>
      longFunctions(path).map((one) => ({ key: `${path}: ${one.name}`, lines: one.lines })),
    );

    expect(long.map((one) => one.key).toSorted()).toEqual(
      Object.keys(REVIEWED_FUNCTIONS).toSorted(),
    );

    // And each at about the size its review was written at.
    const drifted = long.flatMap(({ key, lines }) => {
      const recorded = REVIEWED_FUNCTIONS[key]?.[0];
      return recorded !== undefined && Math.abs(lines - recorded) > FUNCTION_SIZE_TOLERANCE
        ? [`${key}: reviewed at ${String(recorded)}, now ${String(lines)}`]
        : [];
    });
    expect(drifted).toEqual([]);
  });

  it('measures a function inside another, and names one passed to a call', () => {
    // A component whose whole body is one callback would otherwise be measured
    // as its few outer lines.
    const body = Array.from({ length: 60 }, (_, index) => `    step(${String(index)});`).join('\n');
    expect(logicalLines(`{\n${body}\n}`)).toBe(62);

    const file = ts.createSourceFile(
      'probe.ts',
      `function outer() {\n  useEffect(() => {\n${body}\n  });\n}\nconst Wrapped = memo(forwardRef(() => {\n${body}\n}));\n`,
      ts.ScriptTarget.Latest,
      true,
    );
    const names: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isArrowFunction(node)) names.push(functionName(node, file));
      ts.forEachChild(node, visit);
    };
    visit(file);
    // Named through every call that wraps it: through one call only, the second
    // would be "the module > forwardRef callback".
    expect(names).toEqual(['outer > useEffect callback', 'Wrapped']);

    // A short effect before a long one of the same name: the long one is the
    // second, whatever the first measures.
    const twoEffects = ts.createSourceFile(
      'effects.ts',
      `function outer() {\n  useEffect(() => {\n    step(0);\n  });\n  useEffect(() => {\n${body}\n  });\n}\n`,
      ts.ScriptTarget.Latest,
      true,
    );
    expect(longFunctionsIn(twoEffects).map((one) => one.name)).toEqual([
      'outer',
      'outer > useEffect callback #2',
    ]);
  });

  it('reviews a function from 50 logical lines itself', () => {
    // A body measures its two braces as well as its statements.
    const sized = (name: string, lines: number): string =>
      `function ${name}() {\n${Array.from({ length: lines - 2 }, () => '  step();').join('\n')}\n}\n`;
    const file = ts.createSourceFile(
      'sizes.ts',
      sized('under', 49) + sized('at', 50),
      ts.ScriptTarget.Latest,
      true,
    );

    expect(longFunctionsIn(file)).toEqual([{ name: 'at', lines: 50 }]);
  });
});
