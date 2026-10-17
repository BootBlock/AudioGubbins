import { posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parse, read, sourcesMatching } from './source-reading.js';

/**
 * The component inventory draws the design system as the application draws
 * it, or its screenshots prove nothing about the application: a stylesheet
 * the application loads and the inventory does not, or one loaded in another
 * order, would draw a component the user never sees.
 *
 * Each module names a stylesheet by a side-effect import of the design
 * system's exported path, so the two lists are read from the two modules and
 * held equal, in order. Every stylesheet of the design system must be reached
 * from those imports, directly or by a CSS `@import`, so a component's
 * stylesheet that nothing loads fails here rather than drawing nothing.
 */

const APPLICATION = 'apps/web/src/app.tsx';
const INVENTORY = 'tests/e2e/visual/inventory/harness.tsx';

/** How a module names one of the design system's stylesheets. */
const STYLESHEET_EXPORT = '@audiogubbins/design-system/styles/';

/** Where the export resolves. */
const STYLESHEET_SOURCE = 'packages/design-system/src/styles/';

/** The design system's stylesheets a module imports, in order, by their exported paths. */
function stylesheetsImported(path: string): readonly string[] {
  return parse(path)
    .statements.filter(ts.isImportDeclaration)
    .filter((statement) => statement.importClause === undefined)
    .map((statement) => statement.moduleSpecifier)
    .filter(ts.isStringLiteral)
    .map((specifier) => specifier.text)
    .filter((specifier) => specifier.startsWith(STYLESHEET_EXPORT));
}

/** The relative stylesheets a stylesheet imports, as paths from the repository's root. */
function cssImports(path: string): readonly string[] {
  const text = read(path).replaceAll(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/@import\s+(?:url\(\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) =>
    posix.join(posix.dirname(path), match[1] ?? ''),
  );
}

/** Every stylesheet reached from `roots`, following each one's relative imports. */
function reached(roots: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = [...roots];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...cssImports(next));
  }
  return seen;
}

describe('the component inventory loads the design system as the application does', () => {
  it('imports the same stylesheets of the design system, in the same order', () => {
    const application = stylesheetsImported(APPLICATION);
    expect(application.length, 'the application imports the design system').toBeGreaterThan(0);
    expect(stylesheetsImported(INVENTORY)).toEqual(application);
  });

  it('reaches every stylesheet of the design system from those imports', () => {
    const loaded = reached(
      stylesheetsImported(APPLICATION).map((specifier) =>
        specifier.replace(STYLESHEET_EXPORT, STYLESHEET_SOURCE),
      ),
    );
    expect(
      sourcesMatching(`${STYLESHEET_SOURCE}**/*.css`).filter((path) => !loaded.has(path)),
    ).toEqual([]);
  });
});
