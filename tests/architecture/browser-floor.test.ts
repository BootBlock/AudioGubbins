import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declaresTheTextSize } from '../../tools/check-build-output.mjs';
import { inRepository } from '../repository.js';
import { refusedUses, usesAboveTheFloor, usesAboveTheFloorIn } from './floor-reading.js';
import {
  browserCompilerOptions,
  productionSources,
  read,
  solutionProjects,
} from './source-reading.js';

/**
 * The browser floor: the first version of each engine the application runs
 * in, and what the compiler's library declares above it (REQ-EXEC-184).
 *
 * These are rules that hold one fact the same in every place it is written,
 * and keep the heading `dependency-rules.test.ts` gives such rules. They are a
 * file of their own because compiling the tree and each snippet against the
 * library is most of the time they take, and a file of its own runs beside the
 * other rules rather than after them.
 */

/** Every production source file in the workspace, as the other rules read it. */
const ALL_SOURCES = productionSources('{apps,packages}/*/src/**/*.{ts,tsx}');

/** The build configuration, which declares the floor and gives its reasons. */
const BUILD_CONFIG = read('apps/web/vite.config.ts');

/** The floor as the build declares it: each engine, and its first version. */
const FLOOR: ReadonlyMap<string, string> = new Map(
  [
    ...(/const BROWSER_TARGETS = \[([^\]]*)\]/u.exec(BUILD_CONFIG)?.[1] ?? '').matchAll(
      /'([a-z]+)([\d.]+)'/gu,
    ),
  ].map((one) => [one[1] ?? '', one[2] ?? '']),
);

/**
 * The names the stylesheet transformer's data gives the engines the floor
 * names, as the build converts them: the one that differs is Safari on an
 * iPhone or iPad.
 */
const TRANSFORMER_NAMES: ReadonlyMap<string, string> = new Map([
  ['chrome', 'chrome'],
  ['edge', 'edge'],
  ['firefox', 'firefox'],
  ['safari', 'safari'],
  ['ios', 'ios_saf'],
]);

/** What the rule below calls of the stylesheet transformer. */
interface StylesheetTransformer {
  transform(options: {
    readonly filename: string;
    readonly code: Uint8Array;
    readonly minify: boolean;
    readonly targets: object;
  }): { readonly code: Uint8Array };
  browserslistToTargets(queries: readonly string[]): object;
}

/**
 * The stylesheet transformer the build minifies with: the copy the web
 * application's own bundler loads, so the rule reads the version and the data
 * the build does, and no second copy is installed to stand for it.
 */
const TRANSFORMER = createRequire(
  createRequire(inRepository('apps/web/package.json')).resolve('vite'),
)('lightningcss') as StylesheetTransformer;

/**
 * Rules that hold two statements of one fact equal: here, the floor, the
 * reasons its doc gives for it, the library every project compiles with, and
 * the code's use of what that library declares above it.
 */
describe('one fact, held the same in every place it is written', () => {
  // Built where the suite is collected, as the contracts' program is, so the
  // time a busy machine takes to build it is not counted against the test.
  const browserProgram = ts.createProgram(
    ALL_SOURCES.map((path) => inRepository(path)),
    browserCompilerOptions(),
  );

  it('calls what the library declares above the floor only where it is guarded', () => {
    // The ES2023 library is wider than the floor: it declares the segmenter
    // (Firefox 125), and the later `Intl.NumberFormat` members (Firefox 116),
    // and the compiler accepts a use of either in every module. A segmenter
    // made while a module loads throws there in a browser without it, which is
    // why it is made behind a check, in one module. Each use is read by the
    // declaration it resolves to (see `floor-reading.ts`). A search of each
    // file's text would pass a second, unguarded segmenter in the module
    // allowed one, `Intl['Segmenter']` anywhere and a number format member it
    // does not name, and would refuse the date format's `formatRange`, which is
    // inside the floor.
    const files = ALL_SOURCES.flatMap((path) => {
      const source = browserProgram.getSourceFile(inRepository(path));
      return source === undefined ? [] : [{ path, source }];
    });
    expect(files.map((one) => one.path)).toEqual(ALL_SOURCES);

    const uses = usesAboveTheFloor(browserProgram, files);
    expect(refusedUses(uses)).toEqual([]);
    expect([...new Set(uses.filter((one) => !one.inAType).map((one) => one.path))]).toEqual([
      'packages/text/src/graphemes.ts',
    ]);
  });

  it.each([
    ['the segmenter made at the top of a module', 'const segmenter = new Intl.Segmenter();'],
    ['the segmenter named by text', "const Made = Intl['Segmenter'];"],
    ['the segmenter taken apart from its namespace', 'const { Segmenter } = Intl;'],
    [
      'the segmenter made after a check that does not return',
      "function made() {\n  if (typeof Intl.Segmenter !== 'function') made.missing = true;\n  return new Intl.Segmenter();\n}",
    ],
    ['a later number format option', "new Intl.NumberFormat('en', { roundingMode: 'halfEven' });"],
    ['the later rounding priority', "new Intl.NumberFormat('en', { roundingPriority: 'auto' });"],
    ['a range of numbers formatted', "new Intl.NumberFormat('en').formatRange(1, 2);"],
    [
      'a later option read back',
      "const read = new Intl.NumberFormat('en').resolvedOptions().trailingZeroDisplay;",
    ],
  ])('refuses %s, which the floor does not have', (_form, code) => {
    expect(refusedUses(usesAboveTheFloorIn(code))).not.toEqual([]);
  });

  it.each([
    [
      'the segmenter made behind its check',
      "function made() {\n  if (typeof Intl.Segmenter !== 'function') {\n    return undefined;\n  }\n  return new Intl.Segmenter();\n}",
    ],
    ['the segmenter as a type', 'let segmenter: Intl.Segmenter | undefined;'],
    ['the check itself', "const has = typeof Intl.Segmenter === 'function';"],
    [
      'a range of dates formatted',
      "new Intl.DateTimeFormat('en').formatRange(new Date(), new Date());",
    ],
    ['a number formatted', "new Intl.NumberFormat('en').format(1);"],
  ])('leaves %s, which the floor has or a check guards', (_form, code) => {
    expect(refusedUses(usesAboveTheFloorIn(code))).toEqual([]);
  });

  it('holds the browser floor to the first version of each engine every named feature needs', () => {
    // The floor's doc gives the reasons for it, and this reads them. A target
    // lowered by one engine's version would take a feature the first-party code
    // uses unconditionally with it, and the one that would cost most is the one
    // a tool cannot cover: neither the bundler nor the stylesheet transformer
    // lowers a regular expression, so a lookbehind a browser cannot parse would
    // throw while the module loads and the shell would never start.
    // `Intl.Segmenter` made unguarded would do the same where it is missing,
    // which is why its use is guarded.
    //
    // The versions are each engine's first with the feature, as the vendors'
    // compatibility data gives them. A feature added to the doc without its
    // versions here, a row here the doc does not give as a reason, or
    // versions raised past the floor, fails.
    //
    // Safari on an iPhone or iPad is an engine of the floor of its own, since
    // the stylesheet transformer keeps only the prefixes the engines named
    // need, and it reads prefixes Safari on a Mac does not.
    const NEEDED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
      'oklch()': { chrome: 111, edge: 111, firefox: 113, safari: 15.4, ios: 15.4 },
      'dynamic viewport units': { chrome: 108, edge: 108, firefox: 101, safari: 15.4, ios: 15.4 },
      'the ES2023 array methods': { chrome: 110, edge: 110, firefox: 115, safari: 16, ios: 16 },
      'lookbehind assertions': { chrome: 62, edge: 79, firefox: 78, safari: 16.4, ios: 16.4 },
      'range media queries': { chrome: 104, edge: 104, firefox: 63, safari: 16.4, ios: 16.4 },
    };

    const floor = new Map([...FLOOR].map(([engine, version]) => [engine, Number(version)]));

    expect([...floor.keys()].toSorted()).toEqual(['chrome', 'edge', 'firefox', 'ios', 'safari']);

    // The doc gives its reasons one to a line, and each is one row of the
    // table, in the table's order, and each row is one of them. Read both ways,
    // so a reason written beside the floor with no row here fails, as a row
    // with no reason does.
    const doc = BUILD_CONFIG.slice(0, BUILD_CONFIG.indexOf('const BROWSER_TARGETS'));
    const reasons = [...doc.matchAll(/^ \* - (.+?)\r?$/gmu)].map((one) =>
      (one[1] ?? '').replaceAll('`', ''),
    );
    expect(
      reasons.map((reason) => Object.keys(NEEDED).filter((feature) => reason.startsWith(feature))),
    ).toEqual(Object.keys(NEEDED).map((feature) => [feature]));

    // Every project the build compiles is given the one ECMAScript library,
    // read as the compiler reads it: through what a project extends, and from
    // its target where nothing names a library. The base's `lib` is replaced by
    // a project's, not merged with it, so the base's value alone is not what a
    // project compiles with, and a project that names none has the library its
    // target implies unless what it extends names one. A later library fails
    // here until what it adds is weighed against the floor. The generated
    // projects are held to their generator elsewhere.
    const projects = [
      'tsconfig.base.json',
      'tsconfig.json',
      ...solutionProjects().map((directory) => `${directory}/tsconfig.json`),
    ];
    const libraries = projects.map((project) => {
      const parsed = ts.getParsedCommandLineOfConfigFile(inRepository(project), undefined, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
        },
      });
      const options = parsed?.options ?? {};
      const ecmascript = (options.lib ?? [ts.getDefaultLibFileName(options)]).filter((one) =>
        /^lib\.es/iu.test(one),
      );
      return [project, ecmascript];
    });
    expect(libraries).toEqual(projects.map((project) => [project, ['lib.es2023.d.ts']]));
    expect(Object.keys(NEEDED)).toContain('the ES2023 array methods');

    // And the floor is exactly the highest each engine needs: no lower, which
    // would ship a page that cannot start, and no higher, which would exclude
    // a browser for a reason nothing here records.
    for (const [engine, version] of floor) {
      const needed = Math.max(...Object.values(NEEDED).map((versions) => versions[engine] ?? 0));
      expect(version, `${engine} against what the named features need`).toBe(needed);
    }
  });

  it('keeps the text-size rule Safari on a phone reads in the stylesheet it builds', () => {
    // Safari on an iPhone or iPad reads the rule that keeps it from enlarging
    // text only as `-webkit-text-size-adjust`. The transformer drops a prefixed
    // declaration no engine of the floor needs, and no engine the browser suite
    // drives can tell the difference: Chromium reads the unprefixed form, and a
    // computed value is the same either way. So the stylesheet is built here as
    // the build builds it, through the transformer with the floor, and read as
    // the build-output gate reads a build.
    const targets = [...FLOOR].map(([engine, version]) => {
      const name = TRANSFORMER_NAMES.get(engine);
      if (name === undefined) throw new Error(`The floor names ${engine}, which no rule maps`);
      return `${name} ${version}`;
    });
    const built = TRANSFORMER.transform({
      filename: 'tokens.css',
      code: readFileSync(inRepository('packages/design-system/src/styles/tokens.css')),
      minify: true,
      targets: TRANSFORMER.browserslistToTargets(targets),
    });

    expect(declaresTheTextSize(new TextDecoder().decode(built.code))).toBe(true);
  });
});
