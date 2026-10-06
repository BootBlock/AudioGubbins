import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { SuiteOptions } from '../e2e/test.js';
import { inRepository } from '../repository.js';
import { parse, read, sourcesMatching } from './source-reading.js';

/**
 * The browser suite's matrix and what its specs are built on.
 *
 * The matrix is read by loading `playwright.config.ts` itself, as Playwright
 * does, rather than by matching its text: a project is an object whose
 * properties can be written in any order and across any number of lines, and a
 * pattern over the text would pass or fail on the layout rather than on what
 * the project runs. The specs are read by the parser, so a tag or an import is
 * found in whatever shape it is written and a comment that names one is not.
 *
 * Every way the configuration narrows what a project runs is read: the specs
 * its `testMatch` and `testIgnore` select, and the tests its `grep` and
 * `grepInvert` select, set on the project or on the configuration for every
 * project, and the tags a spec gives in a title as well as in `{ tag }`.
 */

/**
 * What this file reads of one project, each as Playwright gives it to the
 * project: the project's own, or the configuration's where the project sets
 * none.
 */
interface Project extends Selectors {
  readonly name: string;

  /**
   * The options its pages are opened with, each by its name: the project's
   * own, or the configuration's where the project sets none.
   */
  readonly use: Readonly<Record<string, unknown>>;
}

/**
 * The four settings that choose the tests a project runs, each of which the
 * configuration sets for every project that sets none of its own.
 */
interface Selectors {
  readonly testMatch: unknown;
  readonly testIgnore: unknown;
  readonly grep: unknown;
  readonly grepInvert: unknown;
}

/** Whether a value is an object with a string `name`. */
function isProject(value: unknown): value is { readonly name: string } {
  return (
    typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
  );
}

/** A member of a value of the configuration, or nothing where it has none. */
function member(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (Reflect.get(value, name) as unknown)
    : undefined;
}

/** The selectors a value of the configuration sets itself. */
function selectorsOf(value: unknown): Selectors {
  return {
    testMatch: member(value, 'testMatch'),
    testIgnore: member(value, 'testIgnore'),
    grep: member(value, 'grep'),
    grepInvert: member(value, 'grepInvert'),
  };
}

/** The options a value of the configuration sets itself, each by its name. */
function optionsOf(value: unknown): Readonly<Record<string, unknown>> {
  const options = member(value, 'use');
  return typeof options === 'object' && options !== null ? { ...options } : {};
}

/**
 * The suite's configuration, as Playwright is given it, with each project's
 * selectors and options as Playwright takes them.
 */
async function suiteConfig(): Promise<{
  readonly config: Selectors;
  readonly projects: readonly Project[];
}> {
  // The specifier is a URL built at run time, which the compiler does not
  // resolve, so it compiles no part of the configuration into this project, and
  // the value is narrowed here rather than typed by the import.
  const loaded: unknown = await import(pathToFileURL(inRepository('playwright.config.ts')).href);
  const config = member(loaded, 'default');
  const projects = member(config, 'projects');
  if (!Array.isArray(projects) || !projects.every(isProject)) {
    throw new Error('playwright.config.ts no longer gives its projects as a list of projects.');
  }
  const shared = selectorsOf(config);
  return {
    config: shared,
    projects: projects.map((project) => {
      const own = selectorsOf(project);
      return {
        name: project.name,
        use: { ...optionsOf(config), ...optionsOf(project) },
        testMatch: own.testMatch ?? shared.testMatch,
        testIgnore: own.testIgnore ?? shared.testIgnore,
        grep: own.grep ?? shared.grep,
        grepInvert: own.grepInvert ?? shared.grepInvert,
      };
    }),
  };
}

/**
 * Whether a pattern of the configuration, one expression or a list of them,
 * matches `text`, as Playwright matches a file path or a title and its tags.
 * A glob or a function is refused rather than guessed at, since the suite
 * writes neither.
 */
function matches(pattern: unknown, text: string): boolean {
  const patterns: readonly unknown[] = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.some((one) => {
    if (!(one instanceof RegExp)) {
      throw new Error(
        `The suite's configuration gives a pattern this rule cannot read: ${String(one)}`,
      );
    }
    return new RegExp(one.source, one.flags.replace('g', '')).test(text);
  });
}

/** Every spec of the browser suite, written with forward slashes. */
const SPECS = sourcesMatching('tests/e2e/*.spec.ts').toSorted();

/** A spec's name: its file's name before `.spec.ts`. */
function specName(path: string): string {
  return posix.basename(path, '.spec.ts');
}

/**
 * Whether a project runs a spec: its `testMatch` selects the file and its
 * `testIgnore` does not, each matched against the file's whole path as
 * Playwright matches it. A project that gives no `testMatch` is refused by
 * `matches`, since Playwright's own is a glob.
 */
function runs(project: Project, path: string): boolean {
  const file = inRepository(path);
  return (
    matches(project.testMatch, file) &&
    (project.testIgnore === undefined || !matches(project.testIgnore, file))
  );
}

/**
 * The specs each project runs, each named by its file's name before `.spec.ts`.
 * Every project runs every test of each of its specs, and only the Firefox
 * project at a text size of 110 per cent chooses among them, by the scale tag:
 * a test left out of an engine is a proof that engine never makes. The scaled
 * Chromium runs the whole of the smoke and accessibility specs, chosen by no
 * tag, because a ratio that is a fraction reaches whatever the page lays out.
 */
const SPECS_OF_EACH_PROJECT: Readonly<Record<string, readonly string[]>> = {
  'chromium-smoke': ['smoke'],
  'chromium-accessibility': ['accessibility'],
  'chromium-input': ['input', 'touch'],
  'chromium-projects': ['projects'],
  'firefox-projects': ['projects'],
  'chromium-transport': ['transport'],
  'chromium-timeline': ['timeline'],
  'chromium-core-editing': ['core-editing'],
  'chromium-analysis': ['analysis'],
  'chromium-renderer': ['renderer-loss'],
  'chromium-renderer-webgpu': ['renderer-webgpu'],
  'chromium-renderer-reduced': ['renderer-reduced'],
  'chromium-touch-pen': ['touch-pen'],
  'chromium-video-reference': ['video-reference'],
  firefox: ['accessibility', 'smoke'],
  webkit: ['accessibility', 'smoke'],
  'chromium-scaled': ['accessibility', 'smoke'],
  'firefox-text-110': ['accessibility', 'smoke'],
  tablet: ['smoke', 'touch'],
  pages: ['pages'],
};

/**
 * The calls that declare a test or a group, each written as Playwright writes
 * it, whose first argument is its title when it is text.
 */
const DECLARATIONS: ReadonlySet<string> = new Set([
  'test',
  'test.only',
  'test.skip',
  'test.fixme',
  'test.fail',
  'test.fail.only',
  'test.describe',
  'test.describe.only',
  'test.describe.skip',
  'test.describe.fixme',
  'test.describe.serial',
  'test.describe.serial.only',
  'test.describe.parallel',
  'test.describe.parallel.only',
]);

/**
 * The declarations that also take a condition in place of a title, as
 * `test.skip(condition, reason)` does, which declares no test.
 */
const CONDITIONAL: ReadonlySet<string> = new Set(['test.skip', 'test.fixme', 'test.fail']);

/**
 * A tag written in a title, as Playwright reads one from the titles of a test
 * and of the groups it is in.
 */
const TITLE_TAG = /@\S+/gu;

/**
 * The name a call is made by, such as `test.describe.only`, or nothing where it
 * is not a name and its members.
 */
function dottedName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  const owner = dottedName(expression.expression);
  return owner === undefined ? undefined : `${owner}.${expression.name.text}`;
}

/**
 * Every tag a spec gives a test or a group: each `{ tag: ... }`, one name or a
 * list of names, and each word a title starts with `@`, which Playwright reads
 * as a tag too. A tag or a title written in any other shape is refused, so the
 * rules below cannot pass by missing one.
 */
function tagsIn(path: string, source: ts.SourceFile): readonly string[] {
  const tags: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'tag') {
      const values = ts.isArrayLiteralExpression(node.initializer)
        ? node.initializer.elements
        : [node.initializer];
      for (const value of values) {
        if (!ts.isStringLiteralLike(value)) {
          throw new Error(`${path} gives a tag this rule cannot read: ${value.getText()}`);
        }
        tags.push(value.text);
      }
    }
    const declaration = ts.isCallExpression(node) ? dottedName(node.expression) : undefined;
    const title = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (declaration !== undefined && DECLARATIONS.has(declaration) && title !== undefined) {
      if (ts.isStringLiteralLike(title)) {
        tags.push(...(title.text.match(TITLE_TAG) ?? []));
      } else if (
        !ts.isArrowFunction(title) &&
        !ts.isFunctionExpression(title) &&
        !CONDITIONAL.has(declaration)
      ) {
        throw new Error(`${path} gives a title this rule cannot read: ${title.getText()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tags;
}

/** Every tag a spec gives a test or a group, as {@link tagsIn} reads them. */
function tagsOf(path: string): readonly string[] {
  return tagsIn(path, parse(path));
}

/** Every text a spec writes, as its string literals and template parts hold it. */
function textsOf(path: string): readonly string[] {
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      texts.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(path));
  return texts;
}

/**
 * The values a file imports from `module`, each by the name the module exports
 * it under: `default` for a default import and `*` for the whole module. A
 * type is left out, since it is no value a test runs.
 */
function valuesImported(path: string, module: string): readonly string[] {
  return parse(path).statements.flatMap((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== module
    ) {
      return [];
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
    const bindings = clause.namedBindings;
    return [
      ...(clause.name === undefined ? [] : ['default']),
      ...(bindings === undefined
        ? []
        : ts.isNamespaceImport(bindings)
          ? ['*']
          : bindings.elements
              .filter((element) => !element.isTypeOnly)
              .map((element) => (element.propertyName ?? element.name).text)),
    ];
  });
}

describe('the browser matrix', () => {
  it('reads the specs it is ruling on, so a passing rule is not passing vacuously', () => {
    expect(SPECS).toEqual([
      'tests/e2e/accessibility.spec.ts',
      'tests/e2e/analysis.spec.ts',
      'tests/e2e/core-editing.spec.ts',
      'tests/e2e/input.spec.ts',
      'tests/e2e/pages.spec.ts',
      'tests/e2e/projects.spec.ts',
      'tests/e2e/renderer-loss.spec.ts',
      'tests/e2e/renderer-reduced.spec.ts',
      'tests/e2e/renderer-webgpu.spec.ts',
      'tests/e2e/smoke.spec.ts',
      'tests/e2e/timeline.spec.ts',
      'tests/e2e/touch-pen.spec.ts',
      'tests/e2e/touch.spec.ts',
      'tests/e2e/transport.spec.ts',
      'tests/e2e/video-reference.spec.ts',
    ]);
    expect(SPECS.flatMap((path) => tagsOf(path))).toContain('@scale');
  });

  it('reads a tag written in the title of a test or a group, as Playwright does', () => {
    const control = ts.createSourceFile(
      'control.spec.ts',
      [
        "test.describe('a group @group-tag', () => {",
        "  test('a test @test-tag', { tag: '@property-tag' }, async () => {});",
        "  test.skip(true, 'a reason @no-tag');",
        "  test('another', async () => {",
        "    await test.step('a step @no-tag', async () => {});",
        '  });',
        '});',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );

    expect(tagsIn('control.spec.ts', control).toSorted()).toEqual([
      '@group-tag',
      '@property-tag',
      '@test-tag',
    ]);
  });

  it('gives each project the specs the matrix names, and every spec to some project', async () => {
    const { projects } = await suiteConfig();

    expect(projects.map((project) => project.name).toSorted()).toEqual(
      Object.keys(SPECS_OF_EACH_PROJECT).toSorted(),
    );
    expect(
      Object.fromEntries(
        projects.map((project) => [
          project.name,
          SPECS.filter((path) => runs(project, path)).map(specName),
        ]),
      ),
    ).toEqual(SPECS_OF_EACH_PROJECT);
    expect(
      SPECS.map(specName).filter(
        (spec) => !Object.values(SPECS_OF_EACH_PROJECT).some((specs) => specs.includes(spec)),
      ),
    ).toEqual([]);
  });

  it('selects by a tag in the Firefox text-size project alone, and there by the scale tag alone', async () => {
    const { config, projects } = await suiteConfig();

    expect(config.grep).toBeUndefined();
    expect(
      projects
        .filter((project) => project.grep !== undefined)
        .map((project) => [
          project.name,
          project.grep instanceof RegExp ? project.grep.toString() : project.grep,
        ]),
    ).toEqual([['firefox-text-110', '/@scale/']]);
  });

  it('leaves no test out of a project, by a tag or by a file', async () => {
    // Each project runs every test its specs hold, but the one that selects by
    // tag: a test left out of an engine by a tag or by its file is a proof that
    // engine never makes.
    const { config, projects } = await suiteConfig();

    expect({ grepInvert: config.grepInvert, testIgnore: config.testIgnore }).toEqual({
      grepInvert: undefined,
      testIgnore: undefined,
    });
    expect(
      projects
        .filter((project) => project.grepInvert !== undefined || project.testIgnore !== undefined)
        .map((project) => project.name),
    ).toEqual([]);
  });

  it('gives no test a tag that no project selects by', async () => {
    // A tag nothing selects by says something of its test that no run acts
    // on. `@once` is refused by name as well: a tag that calls a test's proof
    // the same on every engine is an invitation to leave it out of the rest.
    const { projects } = await suiteConfig();
    const selectors = projects
      .map((project) => project.grep)
      .filter((pattern) => pattern !== undefined);
    const tags = [...new Set(SPECS.flatMap((path) => tagsOf(path)))];

    expect(tags.filter((tag) => !selectors.some((pattern) => matches(pattern, tag)))).toEqual([]);
    expect(SPECS.filter((path) => textsOf(path).some((text) => text.includes('@once')))).toEqual(
      [],
    );
  });
});

/**
 * The first version of iOS and iPadOS the build supports, each part a number,
 * read from the targets the build declares.
 */
const IOS_FLOOR: readonly number[] = (() => {
  const targets = /const BROWSER_TARGETS = \[([^\]]*)\]/u.exec(
    read('apps/web/vite.config.ts'),
  )?.[1];
  const floor = /'ios(?<version>[\d.]+)'/u.exec(targets ?? '')?.groups?.['version'];
  if (floor === undefined) {
    throw new Error('apps/web/vite.config.ts names no version of iOS among its targets.');
  }
  return floor.split('.').map(Number);
})();

/** The agent Safari sends from a Mac, which iPadOS Safari sends by default. */
const MAC_AGENT = /\(Macintosh; Intel Mac OS X [\d_]+\)/u;

/**
 * The suite's option that gives the page the touch points it reports, named by
 * the suite's own type, so a rename of the option is a rename here.
 */
const TOUCH_POINTS: keyof SuiteOptions = 'touchPoints';

/**
 * Whether pages opened with `options` claim the Mac's agent with touch, which
 * is how iPadOS Safari presents an iPad.
 */
function claimsAMacWithTouch(options: Readonly<Record<string, unknown>>): boolean {
  const agent = options['userAgent'];
  return typeof agent === 'string' && MAC_AGENT.test(agent) && options['hasTouch'] === true;
}

/** The agent Safari sends from an iPhone or an iPad asking for a mobile site. */
const IOS_AGENT = /\((?:iPad|iPhone|iPod)\b[^)]*\bOS (?<version>\d+(?:_\d+)*) like Mac OS X\)/u;

/** Whether one version, each part a number, is before another. */
function before(version: readonly number[], other: readonly number[]): boolean {
  for (let part = 0; part < Math.max(version.length, other.length); part += 1) {
    const mine = version[part] ?? 0;
    const theirs = other[part] ?? 0;
    if (mine !== theirs) return mine < theirs;
  }
  return false;
}

/**
 * Why pages opened with `options` do not send what an iPad on the floor sends,
 * or nothing where they do.
 *
 * iPadOS Safari sends the Mac's agent by default, and the application tells an
 * iPad from a Mac by its touch points (`operatingSystemOf`), so the Mac's agent
 * stands for an iPad where touch is kept and the page is given more than one
 * touch point, which Playwright's WebKit does not report of itself. An agent
 * Safari sends for a mobile site claims its version, which is at the floor at
 * least.
 */
function tabletAgentProblems(options: Readonly<Record<string, unknown>>): readonly string[] {
  const agent = options['userAgent'];
  if (typeof agent !== 'string') return ['it sends no agent'];
  if (MAC_AGENT.test(agent)) {
    if (options['hasTouch'] !== true) return [`it claims a Mac with no touch: ${agent}`];
    const points = options[TOUCH_POINTS];
    if (typeof points === 'number' && points > 1) return [];
    const given = points === undefined ? "the engine's own" : JSON.stringify(points);
    return [
      `it claims a Mac with touch, and the page's touch points are ${given}, where an iPad's are more than one: ${agent}`,
    ];
  }
  const claimed = IOS_AGENT.exec(agent)?.groups?.['version'];
  if (claimed === undefined) return [`it claims neither a Mac nor iOS: ${agent}`];
  const version = claimed.split('_').map(Number);
  return before(version, IOS_FLOOR)
    ? [`it claims iOS ${version.join('.')}, below the floor's ${IOS_FLOOR.join('.')}: ${agent}`]
    : [];
}

describe('the device each project stands for', () => {
  it('sends from the tablet the agent an iPad on the floor sends, with its touch', async () => {
    const { projects } = await suiteConfig();
    const tablet = projects.find((project) => project.name === 'tablet');

    expect(tablet, 'no project stands for a tablet').toBeDefined();
    expect(tabletAgentProblems(tablet?.use ?? {})).toEqual([]);

    // The reading refuses what it is there to refuse, so its passing above is
    // not a reading that refuses nothing.
    const floor = IOS_FLOOR.join('_');
    expect([
      tabletAgentProblems({
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) Mobile/15E148 Safari/604.1',
        hasTouch: true,
      }),
      tabletAgentProblems({
        userAgent: `Mozilla/5.0 (iPad; CPU OS ${floor} like Mac OS X) Mobile/15E148 Safari/604.1`,
        hasTouch: true,
      }),
      tabletAgentProblems({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        hasTouch: false,
        [TOUCH_POINTS]: 5,
      }),
      tabletAgentProblems({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        hasTouch: true,
      }),
      tabletAgentProblems({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        hasTouch: true,
        [TOUCH_POINTS]: 1,
      }),
      tabletAgentProblems({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
        hasTouch: true,
        [TOUCH_POINTS]: 5,
      }),
    ]).toEqual([
      [
        `it claims iOS 12.2, below the floor's ${IOS_FLOOR.join('.')}: Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) Mobile/15E148 Safari/604.1`,
      ],
      [],
      [
        'it claims a Mac with no touch: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      ],
      [
        "it claims a Mac with touch, and the page's touch points are the engine's own, where an iPad's are more than one: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
      ],
      [
        "it claims a Mac with touch, and the page's touch points are 1, where an iPad's are more than one: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
      ],
      [],
    ]);
  });

  it('gives the page touch points of its own only where a project claims a Mac with touch', async () => {
    // The touch points stand in for an iPad's, which Playwright's WebKit does
    // not report; given to a page that claims anything else, they would make a
    // device no user has, such as a Mac with a touch screen.
    const { projects } = await suiteConfig();
    const claiming = projects.filter((project) => claimsAMacWithTouch(project.use));

    expect(
      claiming.map((project) => project.name),
      'no project claims a Mac with touch, so the rule below holds of nothing',
    ).toEqual(['tablet']);
    expect(
      projects
        .filter((project) => project.use[TOUCH_POINTS] !== undefined)
        .map((project) => project.name),
    ).toEqual(claiming.map((project) => project.name));
  });
});

describe('what each browser spec is built on', () => {
  it("takes its test from the suite's own, whose pages name the test in each request", () => {
    // Playwright's own `test` gives a page that sends no header naming its
    // project and test, and the request log could not say which made a request.
    expect(
      SPECS.filter(
        (path) =>
          valuesImported(path, '@playwright/test').some((name) => name !== 'expect') ||
          !valuesImported(path, './test.js').includes('test'),
      ),
    ).toEqual([]);
  });
});
