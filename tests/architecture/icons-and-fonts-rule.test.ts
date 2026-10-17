import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cruise, type ICruiseResult } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inRepository } from '../repository.js';

/**
 * The cruise's rule that keeps the icon set and the fonts behind the design
 * system (ADR-0108), run against fixtures that break it and one that does not.
 *
 * The tree holds no import that breaks the rule, so the cruise of the tree
 * passing proves nothing about whether the rule can fail: a rule whose path
 * matched no resolved package would pass as well. The fixtures are laid out as
 * a feature and the design system would be, in a directory of their own
 * outside the tree, and cruised with the rule as the repository's
 * configuration declares it.
 */

const RULE = 'icons-and-fonts-stay-behind-design-system';

/** Where the fixtures are, written as text so no gate but this one reads them. */
const FIXTURES = inRepository('tests', 'architecture', 'fixtures', 'icons-and-fonts');

/** Each fixture, and where in a repository's layout it is placed. */
const LAYOUT: Readonly<Record<string, string>> = {
  'feature-icon.ts.txt': 'apps/web/src/feature-icon.ts',
  'feature-font.ts.txt': 'apps/web/src/feature-font.ts',
  'design-system.ts.txt': 'packages/design-system/src/icons/design-system.ts',
};

let root = '';
let result: ICruiseResult | undefined;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'audiogubbins-icons-and-fonts-'));
  for (const [fixture, placed] of Object.entries(LAYOUT)) {
    mkdirSync(dirname(join(root, placed)), { recursive: true });
    copyFileSync(join(FIXTURES, fixture), join(root, placed));
  }

  const configuration = await extractDepcruiseConfig(inRepository('.dependency-cruiser.cjs'));
  const rule = configuration.forbidden?.find((one) => one.name === RULE);
  expect(rule, `the cruise declares ${RULE}`).toBeDefined();

  const { output } = await cruise(['apps', 'packages'], {
    baseDir: root,
    validate: true,
    ruleSet: { forbidden: rule === undefined ? [] : [rule] },
  });
  if (typeof output === 'string') throw new Error('The cruise reported text, not its result.');
  result = output;
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Each import the rule refused, written `from -> what it imported`. */
function refused(): readonly string[] {
  return (result?.summary.violations ?? [])
    .filter((violation) => violation.rule.name === RULE)
    .map((violation) => `${violation.from} -> ${violation.unresolvedTo ?? violation.to}`)
    .toSorted();
}

describe(RULE, () => {
  it('cruised every fixture', () => {
    expect(result?.modules.map((module) => module.source)).toEqual(
      expect.arrayContaining(Object.values(LAYOUT)),
    );
  });

  it('refuses the icon set and every font package imported from outside the design system', () => {
    expect(refused()).toEqual([
      'apps/web/src/feature-font.ts -> @fontsource-variable/inter',
      'apps/web/src/feature-font.ts -> @fontsource/jetbrains-mono/400.css',
      'apps/web/src/feature-icon.ts -> lucide-react',
    ]);
  });

  it('lets the design system import both', () => {
    const designSystem = result?.modules.find(
      (module) => module.source === LAYOUT['design-system.ts.txt'],
    );
    const imports = designSystem?.dependencies ?? [];

    expect(imports.map((dependency) => dependency.module).toSorted()).toEqual([
      '@fontsource-variable/inter',
      'lucide-react/dist/esm/icons/play.mjs',
    ]);
    expect(imports.filter((dependency) => !dependency.valid)).toEqual([]);
  });
});
