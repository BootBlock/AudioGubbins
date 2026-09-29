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
  read,
  sourceOf,
  sourcesMatching,
} from './source-reading.js';

/**
 * What each package offers past its entry point, and who takes it.
 *
 * An export nothing outside the package imports is either a contract a later
 * phase is written against, or a symbol left behind. The two look alike, and a
 * search by hand finds some of the second and never all of them. So an export
 * must have an importer outside its package, or be named in a used export's
 * declaration, as a type its signature carries is, or be listed below with the
 * reason it is offered.
 *
 * An importer is production code. Counted as one, a test elsewhere would pass
 * an export only a test reaches as used, which is the symbol left behind this
 * rule is for; one a test needs is listed, and says so.
 */

/** A package: its name, where it lives, and its entry point. */
interface Package {
  readonly name: string;
  readonly directory: string;
  readonly entry: string;
}

const PACKAGES: readonly Package[] = sourcesMatching('packages/*/package.json')
  .map((manifest) => {
    const directory = dirname(manifest);
    return {
      name: (JSON.parse(read(manifest)) as { name: string }).name,
      directory,
      entry: `${directory}/src/index.ts`,
    };
  })
  .filter((one) => sourcesMatching(one.entry).length === 1);

/** Every entry point's re-export of a whole module, which no name can be checked in. */
function wholeModuleReExports(entry: string): readonly string[] {
  return parse(entry)
    .statements.filter(
      (statement) => ts.isExportDeclaration(statement) && statement.exportClause === undefined,
    )
    .map((statement) => statement.getText());
}

/** Each name an entry point exports, with the module that declares it. */
function exportsOf(entry: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const statement of parse(entry).statements) {
    // Declared in the entry point itself, as the generated version package is.
    const declaredHere = declaredExports(statement);
    if (declaredHere.length > 0) {
      for (const name of declaredHere) found.set(name, entry);
      continue;
    }

    if (
      !ts.isExportDeclaration(statement) ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const module = forwardSlashes(join(dirname(entry), statement.moduleSpecifier.text));
    const source = sourceOf(module);
    for (const element of statement.exportClause.elements) {
      found.set(element.name.text, source ?? module);
    }
  }
  return found;
}

/**
 * Every name imported from a package, or from one of its subpaths, by
 * production code outside it. A namespace import takes the names read from it.
 */
function importedOutside(pkg: Package): ReadonlySet<string> {
  const names = new Set<string>();
  for (const path of PRODUCTION_FILES) {
    if (path.startsWith(`${pkg.directory}/`)) continue;
    const file = parse(path);
    for (const statement of file.statements) {
      const specifier =
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      if (specifier !== pkg.name && !specifier?.startsWith(`${pkg.name}/`)) continue;

      const clause = ts.isImportDeclaration(statement)
        ? statement.importClause?.namedBindings
        : ts.isExportDeclaration(statement)
          ? statement.exportClause
          : undefined;
      if (clause !== undefined && (ts.isNamedImports(clause) || ts.isNamedExports(clause))) {
        for (const element of clause.elements) {
          names.add((element.propertyName ?? element.name).text);
        }
      }
      if (clause !== undefined && ts.isNamespaceImport(clause)) {
        const read = new RegExp(String.raw`\b${clause.name.text}\.([A-Za-z_$][\w$]*)`, 'g');
        for (const [, name = ''] of file.text.matchAll(read)) names.add(name);
      }
    }
  }
  return names;
}

/**
 * The exports of a package nothing reaches: not imported from outside it, and
 * not named in the contract of an export that is, however far that goes.
 */
function unreached(pkg: Package): readonly string[] {
  const exported = exportsOf(pkg.entry);
  const reached = new Set([...importedOutside(pkg)].filter((name) => exported.has(name)));

  const queue = [...reached];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const source = exported.get(name);
    if (source === undefined) continue;
    const words = new Set(contractOf(parse(source), name).match(/[A-Za-z_$][\w$]*/g) ?? []);
    for (const other of exported.keys()) {
      if (!reached.has(other) && words.has(other)) {
        reached.add(other);
        queue.push(other);
      }
    }
  }

  return [...exported.keys()].filter((name) => !reached.has(name)).toSorted();
}

/**
 * Each export offered with no consumer yet, by package, under the reason it is
 * offered. A symbol that gains an importer leaves this list, and one that
 * loses its last importer has to be written into it or removed.
 */
const OFFERED: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  '@audiogubbins/version': {
    'The names of the stored formats, written by `tools/sync-version.mjs` beside the versions they key.':
      ['SchemaName'],
  },
  '@audiogubbins/test-fixtures': {
    'The two measures of cost the tests share (ADR-0019): the processor time one workload takes against another, for the text, diagnostics and application packages, with the longest a test of it takes, its timeout; and the comparisons of names a piece of work makes, for the commands and workspace packages, with the growth four times the names are held to, the ceiling of the larger count. Tests alone take them, as they take every fixture.':
      ['LONGEST_COST_TEST_MS', 'N_LOG_N_FOURFOLD', 'comparisonsIn', 'relativeCost'],
    'The deterministic signals and projects REQ-REPO-191 puts here for the later phases to test against. Nothing in this phase plays or edits audio, so only their own tests read them.':
      [
        'FIXTURE_LENGTH',
        'FIXTURE_SAMPLE_RATE',
        'ProjectFixture',
        'SignalFixture',
        'SignalOptions',
        'chirp',
        'clickInSine',
        'directCurrent',
        'emptyProject',
        'impulse',
        'loopableSine',
        'noise',
        'noisySine',
        'peakOf',
        'rmsOf',
        'sampleProject',
        'silence',
        'sine',
        'stereo',
        'surround5_1',
        'transient',
      ],
  },
  '@audiogubbins/input': {
    'The pointer and gesture model REQ-UX-067 and REQ-UX-068 require and ADR-0017 puts here. The waveform canvas, Phase 04, is the first surface a pointer edits; the shell reads only key presses.':
      [
        'DEFAULT_GESTURE_SETTINGS',
        'Gesture',
        'GestureSettings',
        'NO_GESTURE',
        'PointerKind',
        'PointerReading',
        'PointerSample',
        'recogniseGesture',
        'sampleFromPointerEvent',
        'toolStrength',
      ],
  },
  '@audiogubbins/domain': {
    'The channel layout REQ-ARCH-157 asks for and ADR-0033 extends: the ambisonic sets, their conventions and components, and the labels of a custom map, which the channel-layout operations and the export recipes of later phases read.':
      ['FIRST_ORDER_AMBIX', 'ambisonicChannelCount', 'channelLabelOf', 'labelledLayout'],
    'The domain value model ADR-0015 gives this phase, for the phases that open, edit and play a project, Phase 02 on. The shell edits no project.':
      [
        'ChoiceOption',
        'ChoiceParameterDescriptor',
        'EntityId',
        'NumericParameterDescriptor',
        'ParameterDescriptor',
        'ParameterTaper',
        'ProcessorDescriptor',
        'TimelineEntity',
        'ToggleParameterDescriptor',
        'assetRangeEnd',
        'assetRangeFitsAsset',
        'chainLatency',
        'clipAssetId',
        'clipEnd',
        'clipsOnTrack',
        'clipsOverlap',
        'containsSample',
        'convertSampleRate',
        'createIdGenerator',
        'defaultParameterValue',
        'discreteLayout',
        'instantiateProcessor',
        'isAssetInUse',
        'isFailure',
        'isRetryable',
        'isSuccess',
        'isTrackAudible',
        'isWellFormedId',
        'processorsInSignalOrder',
        'projectLength',
        'regionEnd',
        'routeToBus',
        'routingPathToOutput',
        'secondsToSamples',
        'tracksInOrder',
        'unsafeBrandId',
        'validateParameterValue',
        'validateProcessorInstance',
      ],
    'The project, its parts and the measures the fixtures package builds its projects and signals from. Only tests read the fixtures in this phase, so these reach no production code yet.':
      [
        'Asset',
        'AssetOrigin',
        'AssetRange',
        'Bus',
        'BusId',
        'Clip',
        'EffectChain',
        'EffectChainId',
        'IdGenerator',
        'LoopDefinition',
        'MAIN_OUTPUT',
        'Marker',
        'ParameterId',
        'ParameterValue',
        'ProcessorInstance',
        'Project',
        'ProjectId',
        'ProjectSettings',
        'Region',
        'RoutingTarget',
        'Track',
        'createDeterministicIdGenerator',
        'createProject',
      ],
  },
  '@audiogubbins/timeline': {
    'The time axis the editor view and the application of this phase are built on, which reach it in the commits that follow (ADR-0040).':
      [
        'BoundaryRange',
        'DEFAULT_SNAP_SETTINGS',
        'EMPTY_SELECTION',
        'FrameRate',
        'FrequencyBand',
        'MAXIMUM_PIXELS_PER_SAMPLE',
        'MAXIMUM_SAMPLES_PER_PIXEL',
        'MadeFacet',
        'ONE_SAMPLE_PER_PIXEL',
        'ObjectSelection',
        'PixelsPerSample',
        'RulerTick',
        'RulerTicks',
        'SNAP_PRECEDENCE',
        'SamplesPerPixel',
        'SelectableContent',
        'SelectionFacet',
        'SelectionSet',
        'SelectionTarget',
        'SnapKind',
        'SnapResult',
        'SnapSettings',
        'SnapTarget',
        'SpectralArea',
        'SpectralPoint',
        'SpectralShape',
        'StandardFrameRates',
        'TargetAsset',
        'TargetRequest',
        'TargetWriting',
        'TimeFormat',
        'TimeFormatKind',
        'TimePrecision',
        'TimecodeLabel',
        'ViewportState',
        'Zoom',
        'activeFacet',
        'boundaryAt',
        'centredOn',
        'clampedView',
        'describeTarget',
        'formatPosition',
        'frameAt',
        'frameRate',
        'frameRatesEqual',
        'frameStart',
        'framesPerSecond',
        'framing',
        'gridPositions',
        'nearestBoundary',
        'nominalFramesPerSecond',
        'pixelOf',
        'pixelsPerSample',
        'placedAt',
        'reconciled',
        'resized',
        'resolveTarget',
        'roundHalfAway',
        'rulerTicks',
        'sampleAt',
        'samplesInPixel',
        'samplesPerPixel',
        'samplesWithin',
        'scrolledBy',
        'selectionsEqual',
        'snapped',
        'targetOutside',
        'targetRange',
        'targetsWithin',
        'timecodeOf',
        'timecodeText',
        'viewportAtStart',
        'viewportFitting',
        'visibleRange',
        'withChannels',
        'withObjects',
        'withSpectralArea',
        'withTimeRange',
        'withoutFacet',
        'zoomFitting',
        'zoomScaled',
        'zoomShowing',
        'zoomedAround',
        'zoomedIn',
        'zoomedOut',
        'zoomsEqual',
      ],
  },
  '@audiogubbins/audio-graph': {
    "The steps `compileGraph` composes, for a host that needs one alone: validation, for an editor that shows a graph's diagnostics as it is drawn, and latency analysis and planning, for a view of each node's latency before a graph runs (ADR-0030, REQ-ARCH-144). Every host in this phase compiles a graph whole; the phase that edits processor graphs is their first consumer.":
      ['GraphValidation', 'LatencyAnalysisResult', 'analyseLatency', 'planGraph', 'validateGraph'],
  },
  '@audiogubbins/audio-engine': {
    "The sources a description makes, which the runtime now reaches through `describedSource`, and the recipe reader and a description's length, which the peak worker and the application of this phase reach in the commits that follow (ADR-0045).":
      ['SignalSettings', 'describedLength', 'memorySource', 'signalRecipe', 'signalSource'],
    "The engine's primitives no host in this phase calls yet: the workload estimate and the chunk plan on their own, which the one render this phase runs reaches through the render strategy that composes them (`assessRender`), preset settings and their validation, the clock's inverse mapping, and the stream helpers a source written in another package needs. The packet requires them as primitives; the phases that decide where project processing runs and write sources of their own are their first consumers.":
      [
        'STABILITY_WINDOW_SECONDS',
        'WorkloadEstimate',
        'assertReadableInto',
        'contextFrameFor',
        'estimateWorkload',
        'framesAvailable',
        'offsetSource',
        'planChunks',
        'resampledSource',
        'settingsFor',
        'throwIfCancelled',
        'timelineFrameAt',
      ],
  },
  '@audiogubbins/diagnostics': {
    'The redaction every export path must apply (REQ-PRIV-165). The diagnostic report is the one path in this phase, and reaches all four through `assembleBundle`, which calls `redactFields`, `redactRecords` and `redactText`, and `redactRecords` calls `redactStack`.':
      ['redactFields', 'redactRecords', 'redactStack', 'redactText'],
  },
  '@audiogubbins/commands': {
    "The shortcut rules the application's tests hold the shipped profile and the palette to: which command a press runs, whether the platform takes a press, and what a search found. The shell reaches each inside the package: the chord tracker asks which command a press runs, `isReservedByPlatform` and `shortcutOffered` whether the platform takes a binding, and the palette what a search found.":
      ['commandForShortcut', 'isReservedByPlatform', 'resultCommandIds'],
    'What the shipped profile binds a command to, which the browser suite presses so that a test presses what a user presses, and a copy of the defaults cannot drift from the profile.':
      ['bindingsFor'],
    'Whether the platform may take a Command press under either reading of a layout, which the settings test holds the key the note names to. The shell asks it inside the package, through `commandLayerKeyAsked`, so the note and the keyboard give one answer.':
      ['commandPressMayBeTaken'],
  },
  '@audiogubbins/design-system': {
    "A system appearance that does not follow the browser, which the application's tests render the theme with.":
      ['UNKNOWN_SYSTEM_APPEARANCE', 'fixedSystemAppearance'],
    "The conversion the colour tokens are written in, which the application's test of the colours drawn before the first paint holds them to the tokens with.":
      ['oklchToHex'],
    'The menu, context-action and popover primitives WU-01.B requires whether or not a consumer has arrived, and the props a caller writes each with.':
      ['ContextActions', 'ContextMenuProps', 'InfoPopover', 'InfoPopoverProps', 'Menu'],
    'The props a caller writes a button with, beside the button the shell uses.': ['ButtonProps'],
    'An entry of the toolbar primitive, for the editor surface of Phase 04, which is its first toolbar; the shell builds its control bar inside the package.':
      ['ControlBarItem'],
  },
  '@audiogubbins/capabilities': {
    "How a probe states its answer, which the application's tests state a browser's answers with rather than probing one.":
      ['absent', 'present'],
    'Each feature a later phase builds, with the capabilities it needs; the phase that builds the feature declares itself against its entry, and the shell reads them all through `ALL_FEATURES`.':
      [
        'ACCELERATED_RENDERING',
        'DIRECT_FILE_ACCESS',
        'HARDWARE_CODECS',
        'MULTI_THREADED_DSP',
        'OFFLINE_USE',
        'PRESSURE_SENSITIVE_TOOLS',
        'PROJECT_STORAGE',
        'RECORDING',
        'SETTINGS_STORAGE',
        'SYSTEM_APPEARANCE',
      ],
  },
};

/** The fixtures package, which offers the measure of processor time. */
const FIXTURES = '@audiogubbins/test-fixtures';

/** The module that declares the measure, as a test beside it imports it. */
const MEASURE_MODULE = 'packages/test-fixtures/src/processor-cost.js';

/** The measure of processor time, in both its forms (ADR-0019). */
const MEASURES: ReadonlySet<string> = new Set(['relativeCost', 'relativeCostWithin']);

/** The timeout the fixtures package derives for every test of the measure. */
const COST_TEST_TIMEOUT: ReadonlySet<string> = new Set(['LONGEST_COST_TEST_MS']);

/**
 * The name each of `wanted` goes by in `file`, imported from the fixtures
 * package or the module that declares the measure, a name read from a
 * namespace written `namespace.name`.
 */
function importedAs(
  file: ts.SourceFile,
  path: string,
  wanted: ReadonlySet<string>,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const fromMeasure =
      specifier === FIXTURES ||
      (specifier.startsWith('.') &&
        forwardSlashes(join(dirname(path), specifier)) === MEASURE_MODULE);
    const bindings = statement.importClause?.namedBindings;
    if (!fromMeasure || bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      for (const name of wanted) names.add(`${bindings.name.text}.${name}`);
      continue;
    }
    for (const element of bindings.elements) {
      if (wanted.has((element.propertyName ?? element.name).text)) names.add(element.name.text);
    }
  }
  return names;
}

/**
 * Whether an identifier names what is declared or a property, rather than
 * reading a name in scope.
 */
function namesNoValue(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    ((ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isBindingElement(parent)) &&
      parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.propertyName === identifier)
  );
}

/**
 * Each name `node` reads, a name read from another written `other.name` as
 * well. Read by name within one file, so a local that shadows a name reaching
 * the measure counts as reaching it, which asks a timeout of a test that may
 * not need one and never lets one through.
 */
function namesRead(node: ts.Node): ReadonlySet<string> {
  const read = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && !namesNoValue(child)) read.add(child.text);
    if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression)) {
      read.add(`${child.expression.text}.${child.name.text}`);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return read;
}

/**
 * Each name in `file` that reaches the measure: the measure's own, and each
 * function or value declared in the file whose declaration reads one of them,
 * however many such steps it takes, as a helper that weighs a text against
 * prose does.
 */
function reachingTheMeasure(file: ts.SourceFile, path: string): ReadonlySet<string> {
  const reaching = new Set(importedAs(file, path, MEASURES));
  if (reaching.size === 0) return reaching;

  const declared: (readonly [string, ReadonlySet<string>])[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
      declared.push([node.name.text, namesRead(node.body)]);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declared.push([node.name.text, namesRead(node.initializer)]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  for (let grown = true; grown;) {
    grown = false;
    for (const [name, read] of declared) {
      if (!reaching.has(name) && [...read].some((one) => reaching.has(one))) {
        reaching.add(name);
        grown = true;
      }
    }
  }
  return reaching;
}

/** A test of the measure: its title, and the timeout it gives, as written, if any. */
interface CostTest {
  readonly title: string;
  readonly timeout: string | undefined;
}

/** The forms of a test that take a table and answer the function that declares the tests. */
const TABLE_FORMS: ReadonlySet<string> = new Set(['each', 'for']);

/** Whether `node` is `it` or `test`, or a form of either, such as `it.skip` or `it.skip.each`. */
function isTestForm(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === 'it' || node.text === 'test';
  return ts.isPropertyAccessExpression(node) && isTestForm(node.expression);
}

/**
 * Whether a call declares a test: `it(…)`, `it.skip(…)` or `it.each(table)(…)`,
 * and not the call that takes the table.
 */
function isTestCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isCallExpression(callee)) return isTestForm(callee.expression);
  return (
    isTestForm(callee) &&
    !(ts.isPropertyAccessExpression(callee) && TABLE_FORMS.has(callee.name.text))
  );
}

/**
 * The timeout a test's call gives, as written: in its options, between its
 * title and its body, or as a number after its body.
 */
function timeoutGiven(call: ts.CallExpression): string | undefined {
  const [, second, third] = call.arguments;
  if (second !== undefined && ts.isObjectLiteralExpression(second)) {
    return second.properties
      .find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText() === 'timeout',
      )
      ?.initializer.getText();
  }
  return third === undefined || ts.isFunctionLike(third) ? undefined : third.getText();
}

/** Every test in `file` whose body reaches the measure, with the timeout it gives. */
function costTestsIn(file: ts.SourceFile, path: string): readonly CostTest[] {
  const reaching = reachingTheMeasure(file, path);
  const tests: CostTest[] = [];
  if (reaching.size === 0) return tests;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTestCall(node)) {
      const [title] = node.arguments;
      const body = node.arguments.find((argument) => ts.isFunctionLike(argument));
      if (body !== undefined && [...namesRead(body)].some((one) => reaching.has(one))) {
        tests.push({
          title:
            title !== undefined && ts.isStringLiteralLike(title)
              ? title.text
              : (title?.getText() ?? ''),
          timeout: timeoutGiven(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return tests;
}

/** Each test in `file` that reaches the measure and gives any timeout but the one derived for it. */
function costTestsUntimed(file: ts.SourceFile, path: string): readonly string[] {
  const derived = importedAs(file, path, COST_TEST_TIMEOUT);
  return costTestsIn(file, path)
    .filter((test) => test.timeout === undefined || !derived.has(test.timeout))
    .map((test) => `${path}: ${test.title}: ${test.timeout ?? "Vitest's default"}`);
}

/** Every test file the repository holds. */
const TEST_FILES = TEST_CODE_FILES.filter((path) => /\.test\.tsx?$/.test(path));

describe('the tests of the measure of processor time (ADR-0019)', () => {
  it('reads a test that reaches the measure through a helper, and the timeout each gives', () => {
    const file = ts.createSourceFile(
      'packages/probe/src/probe.test.ts',
      [
        "import { LONGEST_COST_TEST_MS as allowed, relativeCost } from '@audiogubbins/test-fixtures';",
        'function weigh(text: string) { return relativeCost(() => text, () => text); }',
        'const weighTwice = (text: string) => weigh(text) + weigh(text);',
        "it('given the derived bound', { timeout: allowed }, () => { weighTwice('a'); });",
        "it('given the default', () => { expect(weigh('a')).toBeLessThan(2); });",
        "it.skip('given a literal', { timeout: 340_000 }, () => { relativeCost(() => 0, () => 0); });",
        "it.each([1])('given a table, %s', (n) => { weigh(String(n)); });",
        "it('given a number after it', () => { weigh('a'); }, 340_000);",
        "it('reading no measure', () => { expect(1).toBe(1); });",
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );

    expect(costTestsIn(file, 'packages/probe/src/probe.test.ts')).toEqual([
      { title: 'given the derived bound', timeout: 'allowed' },
      { title: 'given the default', timeout: undefined },
      { title: 'given a literal', timeout: '340_000' },
      { title: 'given a table, %s', timeout: undefined },
      { title: 'given a number after it', timeout: '340_000' },
    ]);
    expect(costTestsUntimed(file, 'packages/probe/src/probe.test.ts')).toEqual([
      "packages/probe/src/probe.test.ts: given the default: Vitest's default",
      'packages/probe/src/probe.test.ts: given a literal: 340_000',
      "packages/probe/src/probe.test.ts: given a table, %s: Vitest's default",
      'packages/probe/src/probe.test.ts: given a number after it: 340_000',
    ]);
  });

  it('is imported by test files alone, so no helper elsewhere carries it past the rule below', () => {
    const importers = TEST_CODE_FILES.filter(
      (path) => importedAs(parse(path), path, MEASURES).size > 0,
    );

    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((path) => !TEST_FILES.includes(path))).toEqual([]);
  });

  it('gives every test that reaches the measure the longest a test of cost takes, as its timeout', () => {
    const reached = TEST_FILES.filter((path) => costTestsIn(parse(path), path).length > 0);

    expect(reached).toEqual(
      expect.arrayContaining([
        'apps/web/src/state/shortcut-store.test.ts',
        'packages/diagnostics/src/redaction.test.ts',
        'packages/test-fixtures/src/processor-cost.test.ts',
        'packages/text/src/holders.test.ts',
      ]),
    );
    expect(TEST_FILES.flatMap((path) => costTestsUntimed(parse(path), path))).toEqual([]);
  });
});

describe('package exports (REQ-EXEC-184)', () => {
  it('reads every package entry point', () => {
    expect(PACKAGES.length).toBeGreaterThanOrEqual(9);
    for (const pkg of PACKAGES) expect(exportsOf(pkg.entry).size).toBeGreaterThan(0);
  });

  it("reads a signature's types, and not a parameter's name or its default value", () => {
    // A default naming an export would reach it, though no caller writes it.
    const file = ts.createSourceFile(
      'probe.ts',
      'export function make(limits: Limits = DEFAULTS, Other?: Shape): Made { return DEFAULTS; }',
      ts.ScriptTarget.Latest,
      true,
    );

    expect(contractOf(file, 'make').match(/[A-Za-z_$][\w$]*/g)).toEqual([
      'Limits',
      'Shape',
      'Made',
    ]);

    const method = ts.createSourceFile(
      'probe.ts',
      'export class Store { put(limit: Limit = FALLBACK): Done { return FALLBACK; } }',
      ts.ScriptTarget.Latest,
      true,
    );
    expect(contractOf(method, 'Store').match(/[A-Za-z_$][\w$]*/g)).toEqual(['Limit', 'Done']);
  });

  it('names every export in an entry point, so each can be checked', () => {
    // `export *` adds no name this rule can read, and everything behind it
    // would pass unchecked.
    for (const pkg of PACKAGES) expect(wholeModuleReExports(pkg.entry)).toEqual([]);
  });

  it.each(PACKAGES.map((pkg) => [pkg.name, pkg] as const))(
    'offers from %s only what is used, or what is listed with its reason',
    (name, pkg) => {
      const listed = Object.values(OFFERED[name] ?? {})
        .flat()
        .toSorted();
      expect(unreached(pkg)).toEqual(listed);
    },
  );
});
