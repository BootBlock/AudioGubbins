import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { expect, type Page, type TestInfo } from '@playwright/test';

import { REPOSITORY_ROOT, forwardSlashes, inRepository } from '../../../repository.js';
import { test } from '../../test.js';
import { inventoryQuery, type InventorySettings } from './inventory-settings.js';

/**
 * The component inventory's screenshot comparison: every shared component, all
 * its states in one picture, in each theme and density, against the rendering
 * the product owner signed off.
 *
 * The pinned environment, which a baseline is only valid in:
 *
 * - the Chromium build `@playwright/test` installs at the version the root
 *   manifest pins, headless, with no other engine;
 * - a viewport of 1280 by 720 CSS pixels at a device pixel ratio of 1, text
 *   antialiased in greyscale rather than in subpixels, no forced colours, and
 *   no system preference for a colour scheme, for reduced motion or for more
 *   contrast (the project in `playwright.config.ts`); the page fixes the
 *   system appearance it themes from as well, so the theme is the address's
 *   and never the machine's;
 * - the operating system the run is on, which rasterises text its own way, so
 *   each platform has baselines of its own (`baselines/<platform>/`, named as
 *   the candidates are), and a run on a platform with none fails for want of
 *   one;
 * - the vendored faces, Inter and JetBrains Mono, loaded before any capture,
 *   and a run that cannot load one fails rather than capturing a fallback;
 * - motion off, and the specimens' content fixed: no time, no random value
 *   and no live data is drawn.
 *
 * The tolerance is none: a pixel that differs at all fails the comparison
 * (`threshold: 0`, `maxDiffPixels: 0`). One pinned engine on one platform
 * draws one page identically every time, so any difference is a change, and a
 * change of one token can move a colour by less than any non-zero threshold
 * would forgive.
 *
 * Baselines are never written by this suite. A missing one fails the test with
 * "no signed-off baseline", and the update flags that would make Playwright
 * write one are refused. To review a rendering, run the suite with
 * `AUDIOGUBBINS_INVENTORY_CANDIDATES=1`: it writes each picture to
 * `candidates/<platform>/<theme>-<density>-<component>.png` beside this file,
 * outside the baselines and ignored by git, and compares nothing. A candidate
 * becomes a baseline only by being copied into `baselines/` once the owner has
 * signed it off.
 */

/** Set to `1` to write candidate renderings for review instead of comparing. */
const CANDIDATE_MODE = process.env['AUDIOGUBBINS_INVENTORY_CANDIDATES'] === '1';

/** Where candidate renderings are written, outside the signed-off baselines. */
const CANDIDATES = inRepository(
  'tests',
  'e2e',
  'visual',
  'inventory',
  'candidates',
  process.platform,
);

/** The faces the design system vendors, by the family names their packages declare. */
const VENDORED_FACES = ['Inter Variable', 'JetBrains Mono Variable'] as const;

/** No difference forgiven: see the tolerance above. */
const TOLERANCE = { threshold: 0, maxDiffPixels: 0 } as const;

/** What the capture photographs, as `toHaveScreenshot` takes it by default, stated. */
const CAPTURE = { animations: 'disabled', caret: 'hide', scale: 'css' } as const;

/** What the theme writes onto the document for each setting, which shows it was applied. */
const MOTION_ATTRIBUTE = { full: 'full', reduced: 'reduced', off: 'minimal' } as const;

/**
 * Opens the inventory in one appearance and compares each component's
 * picture with its signed-off baseline, or writes it as a candidate.
 */
async function compareEveryComponent(
  page: Page,
  testInfo: TestInfo,
  settings: InventorySettings,
): Promise<void> {
  expect(
    testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed',
    'Baselines are signed off by the product owner and never written by a run. ' +
      'Run with AUDIOGUBBINS_INVENTORY_CANDIDATES=1 to write candidates for review.',
  ).toBe(false);

  await page.goto(`/${inventoryQuery(settings)}`);

  await expect(page.locator('[data-inventory-refusal]')).toHaveCount(0);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-ag-theme', settings.theme);
  await expect(html).toHaveAttribute('data-ag-density', settings.density);
  await expect(html).toHaveAttribute('data-ag-motion', MOTION_ATTRIBUTE[settings.motion]);

  const unloaded = await page.evaluate(async (faces) => {
    const loaded = await Promise.all(faces.map((face) => document.fonts.load(`1em "${face}"`)));
    await document.fonts.ready;
    return faces.filter((_, index) => loaded[index]?.length === 0);
  }, VENDORED_FACES);
  expect(unloaded, 'every vendored face loads before the capture').toEqual([]);

  const components = await page
    .locator('[data-inventory-component]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-inventory-component') ?? ''),
    );
  expect(components.length, 'the inventory draws at least one component').toBeGreaterThan(0);

  const appearance = `${settings.theme}-${settings.density}`;
  const unsigned: string[] = [];
  for (const component of components) {
    // Each on a page of its own, at the same place whatever is drawn above it
    // on the whole inventory (`COMPONENT_PARAMETER`).
    await page.goto(`/${inventoryQuery(settings, component)}`);
    await expect(page.locator('[data-inventory-refusal]')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const section = page.getByRole('region', { name: component, exact: true });
    const name = `${appearance}-${component}.png`;

    if (CANDIDATE_MODE) {
      const file = join(CANDIDATES, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await section.screenshot(CAPTURE));
      continue;
    }

    const baseline = testInfo.snapshotPath(name, { kind: 'screenshot' });
    if (!existsSync(baseline)) {
      unsigned.push(`${component}: ${forwardSlashes(relative(REPOSITORY_ROOT, baseline))}`);
      continue;
    }
    await expect.soft(section).toHaveScreenshot(name, { ...CAPTURE, ...TOLERANCE });
  }

  expect(
    unsigned,
    `no signed-off baseline for ${String(unsigned.length)} of ${String(components.length)} ` +
      `components at ${appearance} on ${process.platform}`,
  ).toEqual([]);
}

test.describe('the component inventory', () => {
  test('matches the signed-off rendering of every component, dark theme, comfortable density', async ({
    page,
  }, testInfo) => {
    await compareEveryComponent(page, testInfo, {
      theme: 'dark',
      density: 'comfortable',
      motion: 'off',
    });
  });

  test('matches the signed-off rendering of every component, dark theme, compact density', async ({
    page,
  }, testInfo) => {
    await compareEveryComponent(page, testInfo, {
      theme: 'dark',
      density: 'compact',
      motion: 'off',
    });
  });

  test('matches the signed-off rendering of every component, light theme, comfortable density', async ({
    page,
  }, testInfo) => {
    await compareEveryComponent(page, testInfo, {
      theme: 'light',
      density: 'comfortable',
      motion: 'off',
    });
  });

  test('matches the signed-off rendering of every component, light theme, compact density', async ({
    page,
  }, testInfo) => {
    await compareEveryComponent(page, testInfo, {
      theme: 'light',
      density: 'compact',
      motion: 'off',
    });
  });
});
