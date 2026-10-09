import { dirname, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { forwardSlashes } from '../repository.js';
import {
  PRODUCTION_FILES,
  TEST_CODE_FILES,
  contractOf,
  declaredExports,
  parse,
  sourceOf,
} from './source-reading.js';

/**
 * What each module exports, and whether another module takes it.
 *
 * A module's export must be taken by another module, an entry point's
 * re-export included, or be named in the contract of one that is, or be listed
 * below with the reason a test needs it.
 *
 * The package rule reads entry points alone, so an `export` on a function
 * inside a package that nothing else imports passes it: a helper only its own
 * tests reach, or one nothing reaches at all, which a later phase would find
 * and take for a contract.
 *
 * Read of test code as well as production code, in the second rule below,
 * because the property is the same one: a support module's export that no test
 * takes is a symbol left behind just as a production module's is.
 */

/** Where a specifier written in one file leads, or `undefined` outside the repository's sources. */
type Resolve = (from: string, specifier: string) => string | undefined;

/** A relative specifier's source, from the file it is written in. */
const resolveOnDisk: Resolve = (from, specifier) =>
  specifier.startsWith('.') ? sourceOf(forwardSlashes(join(dirname(from), specifier))) : undefined;

/** Every name a file exports, declared in it or listed in an `export { }` of its own. */
function exportedFrom(file: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    for (const name of declaredExports(statement)) names.add(name);
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    }
  }
  return names;
}

/** A dynamic import of a module, which takes whatever the module offers. */
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Each module's names that other files take, by module: named in an import or
 * a re-export, read from a namespace import, or everything, where a file
 * imports the module whole.
 */
function takenNames(
  files: ReadonlyMap<string, ts.SourceFile>,
  resolve: Resolve,
): ReadonlyMap<string, ReadonlySet<string> | 'all'> {
  const taken = new Map<string, Set<string> | 'all'>();
  const take = (target: string, names: Iterable<string> | 'all'): void => {
    const before = taken.get(target);
    if (before === 'all') return;
    if (names === 'all') {
      taken.set(target, 'all');
      return;
    }
    const set = before ?? new Set<string>();
    for (const name of names) set.add(name);
    taken.set(target, set);
  };

  for (const [path, file] of files) {
    for (const statement of file.statements) {
      if (
        !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
        statement.moduleSpecifier === undefined ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const target = resolve(path, statement.moduleSpecifier.text);
      if (target === undefined) continue;

      const clause = ts.isImportDeclaration(statement)
        ? statement.importClause?.namedBindings
        : statement.exportClause;
      if (clause === undefined) {
        // `export * from`, or an import for its effect alone.
        if (ts.isExportDeclaration(statement)) take(target, 'all');
        continue;
      }
      if (ts.isNamedImports(clause) || ts.isNamedExports(clause)) {
        take(
          target,
          clause.elements.map((element) => (element.propertyName ?? element.name).text),
        );
      } else if (ts.isNamespaceImport(clause)) {
        const reading = new RegExp(String.raw`\b${clause.name.text}\.([A-Za-z_$][\w$]*)`, 'g');
        take(
          target,
          [...file.text.matchAll(reading)].map(([, name = '']) => name),
        );
      } else {
        take(target, 'all');
      }
    }
    for (const [, specifier = ''] of file.text.matchAll(DYNAMIC_IMPORT)) {
      const target = resolve(path, specifier);
      if (target !== undefined) take(target, 'all');
    }
  }
  return taken;
}

/**
 * Every export no other file takes, written `module: name`: not imported, not
 * re-exported, and not named in the contract of an export that is taken or is
 * in `listed`, the exports a test takes, whose contracts a test takes too. An
 * entry point's own exports are the package rule's, and are not read here.
 */
function untakenExports(
  files: ReadonlyMap<string, ts.SourceFile>,
  resolve: Resolve,
  listed: ReadonlySet<string> = new Set(),
): readonly string[] {
  const taken = takenNames(files, resolve);
  const untaken: string[] = [];

  for (const [path, file] of files) {
    if (path.endsWith('/src/index.ts')) continue;
    const exported = exportedFrom(file);
    const direct = taken.get(path);
    if (direct === 'all') continue;

    const reached = new Set(
      [...exported].filter((name) => direct?.has(name) === true || listed.has(`${path}: ${name}`)),
    );
    const queue = [...reached];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      const words = new Set(contractOf(file, name).match(/[A-Za-z_$][\w$]*/g) ?? []);
      for (const other of exported) {
        if (!reached.has(other) && words.has(other)) {
          reached.add(other);
          queue.push(other);
        }
      }
    }

    for (const name of exported) if (!reached.has(name)) untaken.push(`${path}: ${name}`);
  }
  return untaken.toSorted();
}

/** Every export no other file takes by name, whatever lists it: what the list may name. */
function exportsNoFileTakes(
  files: ReadonlyMap<string, ts.SourceFile>,
  resolve: Resolve,
): ReadonlySet<string> {
  const taken = takenNames(files, resolve);
  const found = new Set<string>();
  for (const [path, file] of files) {
    const direct = taken.get(path);
    if (direct === 'all') continue;
    for (const name of exportedFrom(file)) {
      if (direct?.has(name) !== true) found.add(`${path}: ${name}`);
    }
  }
  return found;
}

/**
 * Each export only a test takes, by module, under the reason the test needs it
 * from outside the module rather than through what the module offers.
 */
const FOR_TESTS: Readonly<Record<string, readonly string[]>> = {
  "Recognising a file's format from its content alone, which the fixture and malformed-media tests hold to every form REQ-AUDIO-220 names and refuses; a reader recognises its file through `openAudio`.":
    ['packages/codecs/src/recognition.ts: recogniseAudio'],
  'The input frame a stretched frame is centred on, which its test holds to rounding half up for the frames before the stream starts, a frame of difference no read of the output can show; the stretch reads it itself.':
    ['packages/audio-engine/src/pcm/stretched-content.ts: stretchCentre'],
  'The most unflagged frames inside one click, which the click tests place flags either side of; the de-click and the click detector read it through `joinsClick`.':
    ['packages/processors/src/repair/click-geometry.ts: MERGE_GAP'],
  "Carrying a position and a span through the operations after their basis, which the anchors' tests hold to the edit model's rules one operation at a time; the domain places markers and regions through the resolver they make.":
    [
      'packages/domain/src/editing/anchors.ts: carryPosition',
      'packages/domain/src/editing/anchors.ts: carrySpan',
    ],
  "The pack versions the chains a state runs name, which the pins' test reads of a state whose only chain is one pasted audio carries; the pins read every state through the walk of what a project keeps.":
    ['packages/storage/src/pack-pins.ts: modelsNamedBy'],
  'The invocations that point one range at another chain and remove one slot, the inverses of changes the rack commands make, which the command tests and the random walk run alone; the application reaches them through `independentChainInvocations` and `removeSlotsInvocations`.':
    [
      'packages/project-commands/src/processing/rack-commands.ts: setEditChainInvocation',
      'packages/project-commands/src/processing/slot-commands.ts: removeSlotInvocation',
    ],
  "Reading and writing a region's loop on its own, which the document's tests round-trip apart from the region holding it; a document reads and writes a loop with its region.":
    [
      'packages/project-format/src/placement-reading.ts: readAnchoredLoop',
      'packages/project-format/src/placement-writing.ts: writeAnchoredLoop',
    ],
  'The storage tree over any synchronous root, which its tests run over a directory in memory; the storage worker builds it through `originPrivateTree`, over the origin-private file system.':
    ['packages/browser-storage/src/sync-storage-tree.ts: SyncStorageTree'],
  'How many entries of a history one slice of an opening carries, which the test of a long opening exceeds twice over so the page must apply slices in turn; the worker cuts every opening by it.':
    ['packages/storage-runtime/src/host/project-updates.ts: SLICE_ENTRIES'],
  "The storage worker's client over an end of the port and a page's ports given, which the worker in memory makes so a test counts the ports the page has lent; the application connects through `connectStorage`.":
    ['packages/storage-runtime/src/client/storage-client.ts: storageClientOver'],
  "The length a segment of history is filled to, which the ledger's tests size their nodes against to make it cut, merge or keep segments.":
    ['packages/storage/src/segment-ledger.ts: SEGMENT_LENGTH'],
  "What a spectrogram lane says until spectral analysis draws it, which the composer's test finds in the lane.":
    ['packages/editor-view/src/frame-composer.ts: SPECTROGRAM_SHELL_NOTE'],
  "The time axis's bounds and rounding, which its conversions use and its tests hold to ADR-0041's exactness: the zoom's limits and single-sample step, the zoom showing a span, rounding half away from zero, the unclamped nearest boundary and the view kept within the timeline, and the order snap targets win in.":
    [
      'packages/timeline/src/snapping.ts: SNAP_PRECEDENCE',
      'packages/timeline/src/viewport.ts: clampedView',
      'packages/timeline/src/viewport.ts: nearestBoundary',
      'packages/timeline/src/viewport.ts: roundHalfAway',
      'packages/timeline/src/zoom.ts: MAXIMUM_PIXELS_PER_SAMPLE',
      'packages/timeline/src/zoom.ts: MAXIMUM_SAMPLES_PER_PIXEL',
      'packages/timeline/src/zoom.ts: ONE_SAMPLE_PER_PIXEL',
      'packages/timeline/src/zoom.ts: zoomShowing',
    ],
  'Which element is a text field, and which control keeps a key pressed alone, asked of every kind of element by the listener tests; the listener asks each of an event target alone.':
    [
      'apps/web/src/input/use-shortcuts.ts: isTextField',
      'apps/web/src/input/use-shortcuts.ts: ownsItsKeys',
    ],
  "The test signal's request at a context rate the test names, whose graph and source its tests read; the transport reaches it through `TEST_SIGNAL_PROGRAMME`.":
    ['apps/web/src/audio/test-signal.ts: testSignalPlayback'],
  "The project system over storage services and page ports given, which its test makes over storage in memory to hold the peak cache to a ready root; the application starts it through `startProjectSystem`, which starts the browser's storage worker.":
    ['apps/web/src/state/project-system.ts: projectSystemOver'],
  "The editor panels' parts, made over a context with the services given, which the panel tests make with a peak worker that answers nothing; the application makes them through `startEditor`.":
    ['apps/web/src/editor-part.ts: panelPartsOf'],
  "The asset a picture's decoded sound makes, which its tests build from arrays they name; the application reaches it through `decodePictureSound`, which a test cannot hand a browser's decoder.":
    ['apps/web/src/picture/picture-sound.ts: pictureSoundAsset'],
  'The key the editor views are stored under, which their tests write stored text to and read written text from; the store reads and writes it itself.':
    ['apps/web/src/state/editor-view-store.ts: EDITOR_VIEWS_KEY'],
  'Each panel drawn on its own, and the log filter decided on its own, for the panel tests: the dock draws a panel through `renderPanel`, and the filter is chosen in a portalled listbox, which jsdom opens once per file.':
    [
      'apps/web/src/shell/diagnostics-panel.tsx: recordsPassing',
      'apps/web/src/shell/panels.tsx: CapabilitiesPanel',
    ],
  'Whether two shortcuts are the same, asked of chords the shortcut tests build; the profile asks it of a binding.':
    ['packages/commands/src/shortcut.ts: shortcutsMatch'],
  "The most channels an inference worker serves at once, which its core's test fills and goes past; the core refuses a connection past it itself.":
    ['packages/ml-runtime/src/inference-worker-core.ts: MOST_CONNECTIONS'],
  'How long a resume of the audio context is waited on, which the lifecycle and session tests wait out.':
    ['packages/audio-runtime/src/context/context-resume.ts: GESTURE_WAIT_MILLISECONDS'],
  'How long a notice stays, which the announcement tests wait out.': [
    'packages/design-system/src/primitives/announcement.tsx: NOTICE_DURATION',
  ],
  'The live region on its own, which the live-region tests render with no announcement and hand one after another; the application reaches it through `NoticeProvider`.':
    ['packages/design-system/src/primitives/announcement.tsx: LiveRegion'],
  'The colour arithmetic the tokens are solved with, which the colour and theme tests hold to published values and to the contrast each theme promises.':
    [
      'packages/design-system/src/tokens/colour.ts: meetsContrast',
      'packages/design-system/src/tokens/colour.ts: relativeLuminance',
      'packages/design-system/src/tokens/colour.ts: solveContrast',
    ],
  'The custom properties and data attributes a theme writes, which the theme tests read; the shell writes both through `applyTheme`.':
    [
      'packages/design-system/src/tokens/theme.ts: themeCustomProperties',
      'packages/design-system/src/tokens/theme.ts: themeDataAttributes',
    ],
  'A sink for a second destination beside the bounded store, which nothing in this phase has; its tests hold what it promises until one arrives or it is removed.':
    ['packages/diagnostics/src/log-store.ts: combineSinks'],
  'How long diagnostic mode lasts, which the logger tests wait out.': [
    'packages/diagnostics/src/logger.ts: DIAGNOSTIC_MODE_DURATION_MS',
  ],
  'Which keys a shortcut can be made of, asked of every key by the keyboard tests; `isShortcutPress` asks it of an event.':
    ['packages/input/src/keyboard.ts: isShortcutKey'],
  "The read-back's rules one at a time, which the geometry tests hold against rectangles; the adapter reaches them through `arrangementFrom`.":
    [
      'packages/workspace/src/adapter/geometry.ts: enclosing',
      'packages/workspace/src/adapter/geometry.ts: proportionOf',
      'packages/workspace/src/adapter/geometry.ts: regionFromGeometry',
    ],
  'Choosing the layout to mount from a parsed value, which the layout tests give values no stored text holds; the application reaches it through `resolveStoredLayout`.':
    ['packages/workspace/src/layout-reading.ts: resolveLayout'],
  'Keeping a changed layout in the collection, asked of layout store doubles by the workspace tests, since no stored text brings about the refusal it throws at; the store reaches it through `commit` and `rearranged`.':
    ['apps/web/src/state/workspace-store.ts: keptInCollection'],
  "The ring's position arithmetic and its largest size, which the ring tests drive near 2³¹ positions, where no ring can be filled to reach them; the ring reaches them through its reader and writer.":
    [
      'packages/audio-runtime/src/feed/sample-ring.ts: MAXIMUM_RING_FRAMES',
      'packages/audio-runtime/src/feed/sample-ring.ts: advancePosition',
      'packages/audio-runtime/src/feed/sample-ring.ts: framesBetween',
    ],
  "The named matrices and the mid/side layout, which the matrix tests name; a graph names a matrix by its setting's text, which the matrix node reads through `namedCoefficients`.":
    [
      'packages/audio-engine/src/nodes/named-matrices.ts: MID_SIDE',
      'packages/audio-engine/src/nodes/named-matrices.ts: NamedMatrix',
    ],
  'The key preferences are stored under, which the browser suite writes to start a page at the brightest; the store reads and writes it itself.':
    ['apps/web/src/state/preferences-store.ts: PREFERENCES_KEY'],
  'The frame size a dereverberation transforms at and the most taps it solves for, which its tests hold to its sizes at the common rates and to the layouts it refuses; the processor sizes its own frames and refuses its own layouts.':
    [
      'packages/processors/src/spectral/dereverb.ts: MAXIMUM_TAPS',
      'packages/processors/src/spectral/dereverb.ts: dereverbFrameSize',
    ],
  "The descriptors of the machine-learning types, which the catalogue's test holds to category order apart from the types it makes; the catalogue lists them by key.":
    ['packages/processors/src/catalogue.ts: MODEL_PROCESSOR_DESCRIPTORS'],
  "DeepFilterNet 3's definition, which its tests run over stand-in graphs on the fake runtime; the processor's type is made from it by `deepFilterNet3`.":
    ['packages/processors/src/ml/deepfilternet/deepfilternet.ts: DEEPFILTERNET_3'],
  "MossFormer2 SE 48K's definition, which its tests run over a stand-in graph on the fake runtime; the processor's type is made from it by `mossFormer2Se48k`.":
    ['packages/processors/src/ml/mossformer2/mossformer2.ts: MOSSFORMER2_SE_48K'],
  "MossFormer2 SE 48K's segments, which its golden render holds its signal to reach past the first join of; the stream gathers its segments by them itself.":
    ['packages/processors/src/ml/mossformer2/mossformer2-stream.ts: MOSSFORMER2_SCHEDULE'],
  "Spleeter's two-stem and four-stem definitions, which their tests run over stand-in graphs on the fake runtime; the processors' types are made from them by `spleeter2Stems` and `spleeter4Stems`.":
    [
      'packages/processors/src/ml/spleeter/spleeter.ts: SPLEETER_2_STEMS',
      'packages/processors/src/ml/spleeter/spleeter.ts: SPLEETER_4_STEMS',
    ],
  "The most samples a model pass's output may hold, which its test feeds a stream one frame past; the pass refuses such a stream itself.":
    ['packages/processors/src/ml/model-pass.ts: MOST_OUTPUT_SAMPLES'],
  'The max-rE weights of each order, which their test holds to the closed form and to the published second-order value; the decoder takes them when it makes its matrix.':
    ['packages/processors/src/space/ambisonic-decode.ts: maxReWeights'],
  'The key the audio settings are stored under, which their tests write stored text to and read written text from; the store reads and writes it itself.':
    ['apps/web/src/state/audio-settings-store.ts: AUDIO_SETTINGS_KEY'],
};

/**
 * Each export only the build's configuration takes, under the reason it
 * does: the configuration's files are no production module, so the rule
 * cannot see them take a name.
 */
const FOR_THE_BUILD: Readonly<Record<string, readonly string[]>> = {
  "The model packs' reading of a path under the catalogue, which the development server's pack serving (`apps/web/model-pack-serving.ts`) holds every request to, by the module's path, before it touches the file system.":
    ['packages/model-packs/src/pack-path.js: cataloguePathProblem'],
};

/**
 * Each export of a test-support module that no test takes by name, under the
 * reason it is offered anyway.
 *
 * Separate from {@link FOR_TESTS}, which is about production code a test
 * reaches. This is about support code: a module a test runs and no user
 * receives, whose exports a test is expected to take.
 *
 * An entry is an export the runner reaches by a path written in its
 * configuration rather than by an import, which the rule cannot follow.
 */
const FOR_THE_SUITE: Readonly<Record<string, readonly string[]>> = {
  'The global setup that builds the canonical DSP module, which Vitest runs by the path `vitest.config.ts` names under `globalSetup`.':
    ['tests/setup/dsp-module.ts: setup'],
};

describe('module exports (REQ-EXEC-184)', () => {
  it('finds an export no other module takes, and not one another module imports', () => {
    // A positive control on files made here, so the rule is seen to find what
    // it is for before it is trusted to find nothing.
    const source = (path: string, text: string): [string, ts.SourceFile] => [
      path,
      ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
    ];
    const files = new Map([
      source(
        'a.ts',
        'export interface Shape { size: number }\nexport function used(): Shape { return { size: 1 }; }\nexport function left(): number { return 2; }',
      ),
      source('b.ts', "import { used } from './a.js';\nexport const value = used();"),
      source('c.ts', "import * as b from './b.js';\nexport const read = b.value;"),
    ]);
    const resolve: Resolve = (_from, specifier) =>
      specifier.startsWith('./') ? specifier.slice(2).replace(/\.js$/, '.ts') : undefined;

    expect(untakenExports(files, resolve)).toEqual(['a.ts: left', 'c.ts: read']);
  });

  const files = new Map(PRODUCTION_FILES.map((path) => [path, parse(path)] as const));
  const listed = new Set([...Object.values(FOR_TESTS), ...Object.values(FOR_THE_BUILD)].flat());

  it('takes every export of a production module in another, or lists it with its reason', () => {
    expect(untakenExports(files, resolveOnDisk, listed)).toEqual([]);
  });

  it('lists only an export no other module takes', () => {
    // A listed export that gains an importer leaves the list, and one that is
    // renamed or removed leaves it too, or the list would outlast what it
    // explains.
    const untaken = exportsNoFileTakes(files, resolveOnDisk);
    expect([...listed].filter((one) => !untaken.has(one))).toEqual([]);
  });

  const everything = new Map(
    [...PRODUCTION_FILES, ...TEST_CODE_FILES].map((path) => [path, parse(path)] as const),
  );
  const forTheSuite = new Set(Object.values(FOR_THE_SUITE).flat());
  const testCode = new Set(TEST_CODE_FILES);

  it('reads the test code as well, so the rule covers what it promises', () => {
    expect(TEST_CODE_FILES.length).toBeGreaterThan(50);
    expect(TEST_CODE_FILES).toContain('tests/e2e/platform.ts');
    expect(TEST_CODE_FILES).toContain('packages/domain/src/testing/unwrap.ts');
  });

  it('takes every export of a test-support module in a test, or lists it with its reason', () => {
    // Production code is read here too, because a support module's export can
    // be a type a production signature carries; only the support modules' own
    // untaken exports are reported, since a production export a test reaches is
    // the rule above's business and is listed there.
    const untaken = untakenExports(
      everything,
      resolveOnDisk,
      new Set([...listed, ...forTheSuite]),
    ).filter((one) => testCode.has(one.slice(0, one.indexOf(': '))));

    expect(untaken).toEqual([]);
  });

  it('lists only a test-support export no test takes', () => {
    const untaken = exportsNoFileTakes(everything, resolveOnDisk);
    expect([...forTheSuite].filter((one) => !untaken.has(one))).toEqual([]);
  });
});
