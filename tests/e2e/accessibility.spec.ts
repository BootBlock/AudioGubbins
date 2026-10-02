import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  type Locator,
  type Page,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
} from '@playwright/test';

import { LONGEST_WORKSPACE_NAME } from '../../packages/workspace/src/workspace-name.js';
import {
  groupInUse,
  groupShowing,
  groupsNotInUse,
  panelBody,
  tabsHidden,
  tabsShown,
} from './dock.js';
import {
  fieldTextSizes,
  HALF_A_PIXEL,
  lengthenRefusal,
  recordScrollOrder,
  roomForAControl,
  scrollOrderOf,
  scrollUntilInSight,
  seenOf,
  tabTo,
  unpaintedSides,
} from './dialogue.js';
import {
  brighten,
  darken,
  openPalette,
  openSettings,
  refuseBrightening,
  startAtTheBrightest,
} from './platform.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * Accessibility, checked against the rendered application.
 *
 * REQ-UX-005 makes accessibility a first-class requirement, and the Phase 01
 * acceptance criteria require the themes to meet contrast requirements and the
 * shell to be operable from the keyboard.
 *
 * Automated checks find a minority of accessibility problems, so these are not
 * the whole of the answer. They cover the ones a machine can be certain about:
 * missing names, wrong roles, broken relationships and insufficient contrast.
 * The keyboard tests below cover what axe cannot see at all, which is whether a
 * person can actually operate the thing.
 */

/**
 * Runs axe against the whole page and returns the violations.
 *
 * Once every transition on the page has ended: a button eases its colours
 * over the quick motion token, and contrast measured part of the way through
 * is a pair of colours neither theme draws. One that is cancelled has ended
 * too, since nothing is then drawn part of the way.
 */
async function audit(page: Page, { measureContrast = true } = {}) {
  await page.evaluate(async () => {
    await Promise.allSettled(
      document
        .getAnimations()
        .filter((running) => running.effect?.getComputedTiming().endTime !== Infinity)
        .map(async (running) => await running.finished),
    );
  });

  const builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
  ]);

  const results = await (
    measureContrast ? builder : builder.disableRules('color-contrast')
  ).analyze();

  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }));
}

/**
 * Why a forced-colours test does not run on WebKit.
 *
 * Forced colours is how Windows High Contrast reaches a page, through Chrome,
 * Edge and Firefox on Windows. Safari has no such mode: macOS reaches the page
 * through `prefers-contrast`, which the contrast tests below cover. A WebKit
 * run would test an emulation no Safari user can be in.
 */
const NO_FORCED_COLOURS =
  'Safari has no forced-colours mode; macOS reaches the page through prefers-contrast.';

/**
 * The least a focus ring may be drawn at, in CSS pixels, on every engine and at
 * every scale the suite runs at: what a reader needs to see it.
 *
 * The ring is declared wider than this, because an engine that draws a ring in
 * whole device pixels rounds its width down where a CSS pixel is a fraction of
 * one (see the test of the declaration).
 */
const LEAST_RING = 2;

/**
 * The width of the border drawn over the group in use around a group's
 * `contents`, which the engine draws as the contents' parent, as the engine
 * reports it. Fails where that group is not the one in use, which draws none.
 */
async function groupBorderAround(contents: Locator): Promise<number> {
  const border = await contents.evaluate((element) => {
    const group = element.parentElement;
    if (group === null) return { drawn: 'none', width: 0 };
    const style = getComputedStyle(group, '::after');
    return { drawn: style.borderTopStyle, width: Number.parseFloat(style.borderTopWidth) };
  });
  expect(border.drawn, 'the group around the contents is not marked as in use').toBe('solid');
  return border.width;
}

/**
 * How far inside the border over the group a ring drawn inside the group's
 * contents lies, in CSS pixels, from its `reach` past their edge: a ring drawn
 * inside reaches a negative distance past it, and the border lies along three
 * of their edges. Negative where the border covers part of the ring.
 */
function clearOfTheGroupBorder(reach: number, border: number): number {
  return -reach - border;
}

/** A colour as the page draws it, in its red, green and blue, from 0 to 255. */
type Drawn = readonly [number, number, number];

/**
 * The colours a dock `tab` is drawn in: its background, its label's text and
 * its ring, each painted on a canvas and read back, so any colour syntax the
 * theme writes is read alike.
 */
async function coloursOf(
  tab: Locator,
): Promise<{ readonly background: Drawn; readonly text: Drawn; readonly ring: Drawn }> {
  return await tab.evaluate((element) => {
    const label = element.querySelector('.ag-dock-tab') ?? element;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const drawing = canvas.getContext('2d', { willReadFrequently: true });
    if (drawing === null) throw new Error('The page draws on no canvas.');
    const drawn = (colour: string): [number, number, number] => {
      drawing.clearRect(0, 0, 1, 1);
      drawing.fillStyle = colour;
      drawing.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = drawing.getImageData(0, 0, 1, 1).data;
      return [red, green, blue];
    };
    const style = getComputedStyle(element);
    return {
      background: drawn(style.backgroundColor),
      text: drawn(getComputedStyle(label).color),
      ring: drawn(style.outlineColor),
    };
  });
}

/** The contrast of two drawn colours, as WCAG measures it, from 1 to 21. */
function contrastOf(one: Drawn, other: Drawn): number {
  const luminance = ([red, green, blue]: Drawn): number => {
    const linear = (channel: number) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  };
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** The colour this browser draws a system colour keyword in, read from a probe. */
async function systemColour(page: Page, keyword: string): Promise<string> {
  return await page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = name;
    document.body.append(probe);
    const drawn = getComputedStyle(probe).color;
    probe.remove();
    return drawn;
  }, keyword);
}

/** The size WCAG 1.4.10 measures reflow at, in CSS pixels. */
const REFLOW = { width: 320, height: 256 } as const;

/**
 * Opens `page` at the reflow size with the stored workspace unreadable and
 * every write to storage refused, and dismisses the one notice that raises, so
 * the status bar holds the advice on making room after its last button, which
 * is more than it shows. Gives the bar, scrolled to its top, where a reader
 * arriving at it finds it, and the advice.
 */
async function barHoldingTheAdvice(
  page: Page,
): Promise<{ readonly bar: Locator; readonly advice: Locator }> {
  await page.setViewportSize(REFLOW);
  await page.addInitScript(() => {
    window.localStorage.setItem('audiogubbins.workspace', '{"groups": [');
    Storage.prototype.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await openFresh(page);

  const bar = page.getByRole('contentinfo', { name: 'Status' });
  const advice = bar.locator('.ag-status-item', {
    hasText: 'To make room without losing anything',
  });
  const dismiss = bar.getByRole('button', {
    name: 'Dismiss the notice about the workspace on screen',
  });
  await dismiss.click();
  await expect(dismiss).toHaveCount(0);
  await expect(advice).toBeAttached();

  await bar.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(
    await bar.evaluate((element) => element.scrollHeight > element.clientHeight),
    'the bar shows everything it holds, so nothing needs reaching',
  ).toBe(true);
  return { bar, advice };
}

/**
 * The room a scrollbar takes beside what `element` shows, in CSS pixels: none
 * where no scrollbar is drawn, or one is drawn over what it shows. Run in the
 * page.
 */
function roomTakenByAScrollbar(element: Element): number {
  if (!(element instanceof HTMLElement)) throw new Error('The element is not HTML.');
  const style = getComputedStyle(element);
  return (
    element.offsetWidth -
    element.clientWidth -
    Number.parseFloat(style.borderLeftWidth) -
    Number.parseFloat(style.borderRightWidth)
  );
}

/** The project's options a page is opened with, which a test can pass on. */
type PageOptions = Pick<
  PlaywrightTestOptions,
  'baseURL' | 'deviceScaleFactor' | 'extraHTTPHeaders' | 'locale' | 'timezoneId' | 'userAgent'
>;

/**
 * Runs `use` on a page of a Chromium of the test's own that draws its
 * scrollbars, opened at `viewport` with the project's `options` on the page
 * the suite serves, and closes that Chromium after.
 *
 * Playwright launches Chromium with its scrollbars hidden, and every project
 * keeps that, so a page takes the same widths on every machine. A classic
 * scrollbar takes room at the inline end of what scrolls, inside its edge,
 * where a ring drawn inside it lies, and only a Chromium that draws its
 * scrollbars shows what is painted there.
 */
async function withScrollbarsDrawn(
  playwright: PlaywrightWorkerArgs['playwright'],
  options: PageOptions,
  viewport: { readonly width: number; readonly height: number },
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const { baseURL, deviceScaleFactor, extraHTTPHeaders, locale, timezoneId, userAgent } = options;
  if (baseURL === undefined) throw new Error('The suite serves no page to open.');
  const browser = await playwright.chromium.launch({
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  try {
    const context = await browser.newContext({
      viewport,
      baseURL,
      ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
      ...(extraHTTPHeaders === undefined ? {} : { extraHTTPHeaders }),
      ...(locale === undefined ? {} : { locale }),
      ...(timezoneId === undefined ? {} : { timezoneId }),
      ...(userAgent === undefined ? {} : { userAgent }),
    });
    await use(await context.newPage());
  } finally {
    await browser.close();
  }
}

test.describe('the text a floating surface is written in', () => {
  test(
    'writes a menu, a dialogue and the notice in the text of the application, in either density',
    { tag: '@scale' },
    async ({ page }) => {
      // Each is portalled into the document's body, outside the element the
      // theme sets its text on, so each takes its face, size and line height
      // from the body: set on the theme's element alone, they were drawn in the
      // browser's default serif, and the density did not reach them.
      //
      // Equal to the application's own text, and that text as it is declared:
      // the application inherits from the same body, so a face or a line height
      // lost from the body is lost from both, and equal alone they would still
      // agree.
      await startAtTheBrightest(page);
      await openFresh(page);
      const textOf = async (element: Locator): Promise<string> =>
        await element.evaluate((node) => {
          const style = getComputedStyle(node);
          return `${style.fontFamily} | ${style.fontSize} | ${style.lineHeight}`;
        });

      /**
       * The text as declared: the first face the body's rule names in the
       * served stylesheet, and the size and the line height the theme writes
       * for the density in force, read as the page has them.
       */
      const declared = async (): Promise<{
        readonly face: string;
        readonly size: string;
        readonly lineHeight: number;
      }> =>
        await page.evaluate(() => {
          const body = [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules])
            .find(
              (rule): rule is CSSStyleRule =>
                rule instanceof CSSStyleRule &&
                rule.selectorText
                  .split(',')
                  .some((selector) => selector.trim() === 'html[data-ag-theme] body') &&
                rule.style.fontFamily !== '',
            );
          const tokens = getComputedStyle(document.documentElement);
          return {
            face: body?.style.fontFamily.split(',')[0]?.trim() ?? '',
            size: tokens.getPropertyValue('--ag-text-body').trim(),
            lineHeight: Number.parseFloat(tokens.getPropertyValue('--ag-text-line-height')),
          };
        });

      const seen: string[] = [];
      for (const density of ['comfortable', 'compact']) {
        await test.step(density, async () => {
          if (density === 'compact') {
            await menuBarMenu(page, 'View').click();
            await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();
            await expect(page.locator('[data-ag-density="compact"]').first()).toBeAttached();
          }
          const own = await textOf(page.locator('.ag-app'));
          seen.push(own);
          const text = await declared();
          expect(text.face, 'the body declares no face').not.toBe('');
          const [face, size, lineHeight] = own.split(' | ');
          expect(face?.split(',')[0]?.trim(), 'the face').toBe(text.face);
          expect(size, 'the size').toBe(text.size);
          // To a tenth of a pixel, the line height: an engine keeps a length in
          // sixtieths or sixty-fourths of one.
          expect(Number.parseFloat(lineHeight ?? ''), 'the line height').toBeCloseTo(
            Number.parseFloat(text.size) * text.lineHeight,
            1,
          );

          await menuBarMenu(page, 'Help').click();
          expect(await textOf(page.getByRole('menu')), 'the menu').toBe(own);
          await page.getByRole('menuitem', { name: 'Export a diagnostic report' }).click();
          const dialog = page.getByRole('dialog', { name: 'Export a diagnostic report' });
          await expect(dialog).toBeVisible();
          expect(await textOf(dialog), 'the dialogue').toBe(own);
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();

          await refuseBrightening(page);
          const notice = page.locator('.ag-notice');
          await expect(notice).toBeVisible();
          expect(await textOf(notice), 'the notice').toBe(own);
        });
      }
      // The density changes the application's own text, so each step read a
      // different one.
      expect(new Set(seen).size).toBe(2);
    },
  );
});

test.describe('the text a field is typed in', () => {
  test(
    "draws each field at the density's size where no finger is among the inputs",
    { tag: '@scale' },
    async ({ page }) => {
      // A field is drawn at 16 pixels at least only where a finger is among the
      // inputs, which is where Safari on an iPhone would otherwise zoom into
      // it. With a mouse alone it keeps the density's size, so compact density
      // stays compact, at a text size that is not 100 as at one that is. It is
      // read in compact density, where every field's size is under 16, so a
      // floor of 16 would show in every field read.
      await openFresh(page);
      expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(false);
      await menuBarMenu(page, 'View').click();
      await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();
      await expect(page.locator('[data-ag-density="compact"]').first()).toBeAttached();

      for (const { field, drawn, density } of await fieldTextSizes(page)) {
        expect(density, `the density's size for ${field} is not under 16`).toBeLessThan(16);
        expect(drawn, `${field} is not drawn at the density's size`).toBe(density);
      }
    },
  );
});

// Every audit reads layout: the WCAG 2.2 rules measure each control's target,
// and contrast is read against the background each element is drawn over.
test.describe('the shell has no automatically detectable violation', { tag: '@scale' }, () => {
  test('in the dark theme, as it ships', async ({ page }) => {
    await openFresh(page);
    expect(await audit(page)).toEqual([]);
  });

  test('in the light theme', async ({ page }) => {
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();
    // Audited once the theme is in force, or the dark theme is what is read.
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');

    expect(await audit(page)).toEqual([]);
  });

  test('at the brightest the control allows', async ({ page }) => {
    // REQ-UX-070 requires contrast to hold across the whole brightness range,
    // and the ends are where a palette that merely offsets its tokens fails.
    await openFresh(page);

    for (let press = 0; press < 12; press += 1) {
      await brighten(page);
    }

    // Proof the end was reached. This audit once passed while every press did
    // nothing at all: the binding was the browser's zoom accelerator, so the
    // page zoomed and the palette was never at its brightest.
    await expect(page.locator('.ag-live-regions', { hasText: /brightest/ })).toHaveCount(1);
    expect(await audit(page)).toEqual([]);
  });

  test('at the darkest the control allows', async ({ page }) => {
    await openFresh(page);

    for (let press = 0; press < 12; press += 1) {
      await darken(page);
    }

    await expect(page.locator('.ag-live-regions', { hasText: /darkest/ })).toHaveCount(1);
    expect(await audit(page)).toEqual([]);
  });

  test('in high contrast', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Accessibility' }).click();
    await page.getByRole('combobox', { name: 'Contrast' }).click();
    await page.getByRole('option', { name: /^High/ }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-contrast', 'high');

    expect(await audit(page)).toEqual([]);
  });

  test(
    'in forced colours, where the browser replaces every colour it is given',
    { tag: '@scale' },
    async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', NO_FORCED_COLOURS);

      // Windows High Contrast. Nothing handled it: every surface token
      // collapsed to one colour, so the bars, the panels and the palette field
      // became one flat area with no boundary, and axe had no contrast to
      // measure.
      await openFresh(page);
      const panel = page.locator('.ag-panel').first();
      const borderOf = async (): Promise<string> =>
        await panel.evaluate((element) => getComputedStyle(element).borderTopWidth);

      // A panel has no border of its own, so a border in forced colours is the
      // layer's doing. The menu bar this read once has a border in every mode,
      // so the assertion held with the whole layer deleted.
      //
      // Read as a number: Firefox draws the 1px border at 0.95px on this
      // display.
      expect(Number.parseFloat(await borderOf())).toBe(0);
      await page.emulateMedia({ forcedColors: 'active' });
      await expect.poll(async () => Number.parseFloat(await borderOf())).toBeGreaterThan(0);

      // Every rule but the contrast one. Under the emulation the browser forces
      // the background and leaves the page's own text colour in place, so axe
      // measures a pair no browser in forced colours ever draws; a real one
      // replaces both. Measured: foreground #eff2f6 against background #ffffff,
      // which is the dark theme's text on the forced canvas.
      expect(await audit(page, { measureContrast: false })).toEqual([]);
    },
  );

  test('in compact density, where the controls are smallest', async ({ page }) => {
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-density', 'compact');

    expect(await audit(page)).toEqual([]);
  });

  test('with the command palette open', async ({ page }) => {
    await openFresh(page);
    await openPalette(page);
    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();

    expect(await audit(page)).toEqual([]);
  });

  test('with the settings dialogue open', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    expect(await audit(page)).toEqual([]);
  });

  test('on every tab of the settings dialogue, with defaults waiting and bindings taken', async ({
    page,
  }) => {
    // Audited on the tab it opens on alone, the dialogue's Shortcuts tab, with
    // its waiting and taken lists, and its Workspaces tab, with the name field,
    // were never audited. The layout map says the key at K types T, so the
    // defaults the profile follows wait for K; and the profile binds presses
    // the browser or the system takes on every platform.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'keyboard', {
        configurable: true,
        value: { getLayoutMap: async () => await Promise.resolve(new Map([['KeyK', 't']])) },
      });
      const binding = (command: string, press: string) => ({ command, presses: [press] });
      localStorage.setItem(
        'audiogubbins.shortcuts',
        JSON.stringify({
          schemaVersion: 1,
          selectedId: 'mine',
          profiles: [
            {
              id: 'mine',
              text: JSON.stringify({
                schemaVersion: 1,
                displayName: 'Mine',
                bindings: [
                  binding('settings.open', 'C+Comma'),
                  binding('settings.open', 'SM+Comma'),
                  binding('view.theme-dark', 'C+Equal'),
                  binding('view.theme-dark', 'M+Equal'),
                ],
              }),
              following: ['view.command-palette', 'workspace.save-as'],
            },
          ],
        }),
      );
    });
    await openFresh(page);
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    for (const tab of ['Appearance', 'Accessibility', 'Workspaces', 'Shortcuts', 'Diagnostics']) {
      await dialog.getByRole('tab', { name: tab, exact: true }).click();
      await expect(dialog.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      if (tab === 'Shortcuts') {
        await expect(
          dialog.getByRole('group', { name: 'Waiting for your keyboard' }),
        ).toBeVisible();
        await expect(
          dialog.getByRole('group', { name: 'Left to the browser or the system' }),
        ).toBeVisible();
      }
      expect([tab, await audit(page)]).toEqual([tab, []]);
    }
  });

  test('draws the name field placeholder in the theme supporting text', async ({ page }) => {
    // Left to the browser, the placeholder, which is where the workspace's
    // current name is shown, was drawn in a grey of the browser's own, with no
    // contrast the theme answered for.
    await openFresh(page);
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Workspaces', exact: true }).click();

    const field = dialog.getByLabel('New name');
    const placeholder = await field.evaluate((input) => {
      const style = getComputedStyle(input, '::placeholder');
      return { colour: style.color, opacity: style.opacity };
    });
    const supporting = await dialog
      .locator('.ag-text-field-description')
      .first()
      .evaluate((description) => getComputedStyle(description).color);

    expect(placeholder).toEqual({ colour: supporting, opacity: '1' });
  });

  test('with a menu open', async ({ page }) => {
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await expect(page.getByRole('menuitem', { name: 'Use the light theme' })).toBeVisible();

    expect(await audit(page)).toEqual([]);
  });
});

test.describe('forced colours keep what the user needs to see', () => {
  test.skip(({ browserName }) => browserName === 'webkit', NO_FORCED_COLOURS);

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
  });

  test('marks the palette entry Enter will run', async ({ page }) => {
    // The highlighted entry was marked by its background alone, which the
    // browser replaces with the canvas, and the entries never take focus, so no
    // focus ring marks them either. Arrowing showed nothing moving.
    await openFresh(page);
    await openPalette(page);
    await page.keyboard.press('ArrowDown');

    const highlighted = page.locator('.ag-palette-result[data-ag-highlighted]');
    const neighbour = page.locator('.ag-palette-result:not([data-ag-highlighted])').first();
    const background = async (row: typeof highlighted): Promise<string> =>
      await row.evaluate((element) => getComputedStyle(element).backgroundColor);

    await expect(highlighted).toHaveCount(1);
    expect(await background(highlighted)).toBe(await systemColour(page, 'Highlight'));
    expect(await background(highlighted)).not.toBe(await background(neighbour));

    // And its text in the colour drawn on that, the entry's own and its
    // label's: with the background alone asserted, the text could stay the
    // theme's.
    const highlightText = await systemColour(page, 'HighlightText');
    expect(await highlighted.evaluate((element) => getComputedStyle(element).color)).toBe(
      highlightText,
    );
    expect(
      await highlighted
        .locator('.ag-palette-label')
        .evaluate((element) => getComputedStyle(element).color),
    ).toBe(highlightText);
  });

  test('draws the highlighted entry readably when it cannot be chosen', async ({ page }) => {
    // The rule for an entry that cannot be chosen came later at the same
    // weight, and drew GrayText on Highlight on the entry the user had moved
    // to so as to read its reason.
    await openFresh(page);
    await openPalette(page);
    await page.keyboard.type('Use the dark theme');

    const highlighted = page.locator('.ag-palette-result[data-ag-highlighted]');
    await expect(highlighted).toHaveAttribute('aria-disabled', 'true');
    const highlightText = await systemColour(page, 'HighlightText');
    expect(await highlighted.evaluate((element) => getComputedStyle(element).color)).toBe(
      highlightText,
    );
    expect(
      await highlighted
        .locator('.ag-palette-label')
        .evaluate((element) => getComputedStyle(element).color),
    ).toBe(highlightText);
  });

  test('marks the menu entry the keyboard is on', async ({ page }) => {
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await page.keyboard.press('ArrowDown');

    const highlighted = page.locator('.ag-menu-item[data-highlighted]');
    const neighbour = page.locator('.ag-menu-item:not([data-highlighted])').first();
    const background = async (entry: typeof highlighted): Promise<string> =>
      await entry.evaluate((element) => getComputedStyle(element).backgroundColor);

    await expect(highlighted).toHaveCount(1);
    expect(await background(highlighted)).toBe(await systemColour(page, 'Highlight'));
    // Only the entry the keyboard is on: a rule that marked every entry would
    // pass the line above.
    expect(await background(neighbour)).not.toBe(await background(highlighted));

    // The first entry, the dark theme, is in use and cannot be chosen, and the
    // keyboard can stand on it. Its text is the platform's for a highlight, its
    // reason too: drawn in GrayText, it sat on Highlight, a pair no palette
    // designs to be read.
    await expect(highlighted).toHaveAttribute('aria-disabled', 'true');
    const highlightText = await systemColour(page, 'HighlightText');
    for (const part of [
      highlighted,
      highlighted.locator('.ag-menu-item-label'),
      highlighted.locator('.ag-menu-item-reason'),
    ]) {
      expect(await part.evaluate((element) => getComputedStyle(element).color)).toBe(highlightText);
    }
  });

  test('draws an entry that cannot be chosen in the colour the platform keeps for that', async ({
    page,
  }) => {
    // A built-in workspace cannot be deleted, so the entry cannot be chosen.
    await openFresh(page);
    await menuBarMenu(page, 'Workspace').click();

    const unavailable = page.getByRole('menuitem', { name: /Delete this workspace/ });
    const available = page.getByRole('menuitem', { name: 'Duplicate this workspace' });
    const colour = async (entry: typeof unavailable): Promise<string> =>
      await entry.evaluate((element) => getComputedStyle(element).color);

    await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    expect(await colour(unavailable)).toBe(await systemColour(page, 'GrayText'));
    // Only an entry that cannot be chosen: a rule that greyed every entry
    // would pass the line above.
    expect(await colour(available)).not.toBe(await colour(unavailable));
  });

  test('marks the tab each group shows, and the group in use', async ({ page }) => {
    // The engine marks both by colour alone, which the browser replaces.
    await openFresh(page);

    const shown = tabsShown(page).first();
    const highlight = await systemColour(page, 'Highlight');
    expect(await shown.evaluate((element) => getComputedStyle(element).borderBottomColor)).toBe(
      highlight,
    );
    expect(
      await groupInUse(page).evaluate(
        (element) => getComputedStyle(element, '::after').borderTopColor,
      ),
    ).toBe(highlight);

    // Only those: a rule that marked every tab or every group would pass the
    // lines above and tell nothing apart.
    //
    // The Diagnostics panel opens beside the Transport, so that group has a tab
    // it does not show.
    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();
    await expect(tabsHidden(page)).not.toHaveCount(0);
    expect(
      await tabsHidden(page)
        .first()
        .evaluate((element) => getComputedStyle(element).borderBottomColor),
    ).not.toBe(highlight);
    expect(
      await groupsNotInUse(page)
        .first()
        .evaluate((element) => getComputedStyle(element, '::after').borderTopColor),
    ).not.toBe(highlight);
  });

  test(
    "rings a group's contents reached by Tab, a pixel clear of the group's border",
    { tag: '@scale' },
    async ({ page }) => {
      // The engine's rule took the ring away here as well. Drawn, the ring and
      // the border over the group in use are both the platform's selection
      // colour, and touching they read as one band, so a pixel of the canvas
      // is left between them.
      await page.setViewportSize({ width: 1100, height: 700 });
      await openFresh(page);
      const contents = panelBody(groupShowing(page, 'Transport')).first();
      await tabTo(page, contents);

      const ring = await seenOf(contents, { ring: true });
      expect(ring.outline, 'no ring on the contents').toBe('solid');
      expect(ring.width, 'the ring on the contents is too thin to see').toBeGreaterThanOrEqual(
        LEAST_RING,
      );
      expect(ring.cutBy, 'the ring is cut').toEqual([]);
      // And nothing is painted over it: an outline is drawn under a
      // descendant positioned over it, which no reading of its box can see.
      expect(await unpaintedSides(contents), 'something is painted over the ring').toEqual([]);
      expect(await contents.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(
        await systemColour(page, 'Highlight'),
      );
      expect(
        clearOfTheGroupBorder(ring.reach, await groupBorderAround(contents)),
        'no pixel is left between the ring and the border over the group',
      ).toBeGreaterThanOrEqual(1 - HALF_A_PIXEL);
    },
  );

  test(
    'still marks the tab a group shows while that tab holds focus',
    { tag: '@scale' },
    async ({ page }) => {
      // The browser replaces the theme's fill with the canvas, and the ring
      // lies over the underline, which is the platform's selection colour, so
      // the focused shown tab takes the pair the platform keeps for a
      // selection, as the entry the keyboard is on in a menu does.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);
      await menuBarMenu(page, 'Workspace').click();
      await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();
      const shown = page.getByRole('tab', { name: 'Diagnostics', exact: true });
      const notShown = page.getByRole('tab', { name: 'Transport', exact: true });
      await expect(shown).toHaveAttribute('aria-selected', 'true');

      await page.locator('body').click();
      await tabTo(page, shown);
      const [highlight, highlightText] = await Promise.all([
        systemColour(page, 'Highlight'),
        systemColour(page, 'HighlightText'),
      ]);
      const drawn = await shown.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, text: style.color, ring: style.outlineColor };
      });
      expect(drawn).toEqual({ background: highlight, text: highlightText, ring: highlightText });

      await page.keyboard.press('ArrowLeft');
      await expect(notShown).toBeFocused();
      expect(
        await notShown.evaluate((element) => getComputedStyle(element).backgroundColor),
        'a focused tab not shown is marked as shown',
      ).not.toBe(highlight);
    },
  );

  test("draws a state in the user's colours, not the theme's", async ({ page }) => {
    // The layer opted the status items out of forcing and then lost the colour
    // race to the shell's own rules, so the dark theme's warning colours were
    // painted on the user's canvas.
    await page.addInitScript(() => {
      window.localStorage.setItem('audiogubbins.workspace', '{"groups": [');
    });
    await openFresh(page);

    const notice = page.locator('.ag-status-item[data-ag-status="unavailable"]').first();
    await expect(notice).toBeVisible();
    expect(await notice.evaluate((element) => getComputedStyle(element).color)).toBe(
      await systemColour(page, 'MarkText'),
    );
  });
});

test.describe('a notice does not cover what it points at', () => {
  test(
    'draws a notice clear of the status bar it points the reader at',
    { tag: '@scale' },
    async ({ page }) => {
      // The notice is fixed to the bottom of the page and the status bar is the
      // bottom row of the shell, so every notice was drawn over the bar and
      // over the Dismiss buttons in it, for as long as it stayed. Anything
      // focused there was obscured by something the page drew (WCAG 2.4.11),
      // and the start-up notice tells the reader that the status bar has the
      // rest of what it could not say.
      await page.addInitScript(() => {
        window.localStorage.setItem('audiogubbins.workspace', '{"groups": [');
      });
      await openFresh(page);

      const notice = page.locator('.ag-notice');
      await expect(notice).toBeVisible();

      const clear = await page.evaluate(() => {
        const shown = document.querySelector('.ag-notice')?.getBoundingClientRect();
        const bar = document.querySelector('.ag-status-bar')?.getBoundingClientRect();
        return Math.round((bar?.top ?? 0) - (shown?.bottom ?? 0));
      });
      expect(clear).toBeGreaterThanOrEqual(0);
    },
  );
});

test.describe('a floating surface is inside the theme', () => {
  /*
   * Every dialogue, menu, tooltip, popover and select is portalled into the
   * document body, so that no ancestor's overflow or stacking context can clip
   * it. Custom properties inherit down the tree and nowhere else, so the theme
   * is written onto the document element, which every portal inherits from.
   * Written onto an element inside the application, it would leave every
   * `var(--ag-…)` inside such a surface resolving to nothing and every
   * declaration reading one invalid: no background, no padding, no corner, no
   * focus ring.
   *
   * The accessibility audit would not catch that, because the text would land
   * on the page's pre-paint colour and meet contrast by accident. These tests
   * read the computed values instead.
   */

  test('resolves its tokens, so a dialogue has the surface it is drawn on', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    const drawn = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog === null) return undefined;
      const style = window.getComputedStyle(dialog);
      return {
        token: style.getPropertyValue('--ag-chrome-surface-overlay').trim(),
        background: style.backgroundColor,
        padding: style.padding,
        // Themed by inheritance from the document element rather than by
        // position in the application's own tree: the surface is portalled to
        // the document body, which is where it has to be so that no ancestor's
        // overflow can clip it.
        inheritsTheme: document.documentElement.dataset['agTheme'] !== undefined,
      };
    });

    expect(drawn?.inheritsTheme).toBe(true);
    expect(drawn?.token).not.toBe('');
    expect(drawn?.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(drawn?.padding).not.toBe('0px');
  });

  test('resolves its tokens in a menu, so the highlighted entry can be seen', async ({ page }) => {
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await expect(page.getByRole('menuitem', { name: 'Use the light theme' })).toBeVisible();

    const drawn = await page.evaluate(() => {
      const menu = document.querySelector('.ag-menu');
      if (menu === null) return undefined;
      const style = window.getComputedStyle(menu);
      return {
        background: style.backgroundColor,
        hover: style.getPropertyValue('--ag-chrome-surface-hover').trim(),
      };
    });

    expect(drawn?.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(drawn?.hover).not.toBe('');
  });

  test(
    'rings the entry the keyboard is on, in a menu, a select list and the palette',
    { tag: '@scale' },
    async ({ page }) => {
      // The background alone carried it, and the hover surface is a fifteenth
      // of a step from the overlay surface under it: about 1.05 to 1 in the
      // dark theme, where WCAG 1.4.11 asks three to one of a state that is
      // drawn. The ring was switched off on a menu entry as well, and a palette
      // row never takes focus, so nothing else drew it.
      //
      // The marked entry is found and measured in one read inside the page, and
      // never held from one call to the next. The mark moves: a select list and
      // the palette mark an entry as they open, and the arrow press then moves
      // the mark on within the frame. An entry picked out before that move and
      // measured after it is an entry the keyboard has left, and its outline is
      // the initial one, which is `none` at the medium width of three pixels.
      // That is how a ring WebKit does draw was read as no ring at all.

      const marked = async (
        selector: string,
      ): Promise<{ readonly on: string; readonly width: number; readonly offset: number }> =>
        await page.evaluate((match) => {
          const entries = document.querySelectorAll(match);
          // One entry and no other. A surface with no mark on it, and a surface
          // left holding two, are both states to wait through rather than to
          // measure a ring on.
          const entry = entries.length === 1 ? entries.item(0) : null;
          if (entry === null) return { on: '', width: 0, offset: 0 };
          const style = getComputedStyle(entry);
          return {
            on: entry.textContent,
            width: style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth),
            // Which rule drew it. The block that marks the keyboard's position
            // draws inside the entry, at minus its own width; the ring every
            // focused control draws is outside, at plus the offset token.
            offset: style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineOffset),
          };
        }, selector);

      /**
       * The most entries the mark was on at once over a short run of frames.
       *
       * Counted rather than read through `marked`, which answers "no mark" for
       * a surface holding two of them as readily as for one holding none, and
       * held over several frames rather than read once: a surface that began
       * marking an entry a tick after its first item painted would pass a
       * single synchronous read, which is the state this is here to catch.
       */
      const mostMarked = async (selector: string, frames: number): Promise<number> =>
        await page.evaluate(
          async ({ match, over }) => {
            let most = 0;
            for (let frame = 0; frame < over; frame += 1) {
              most = Math.max(most, document.querySelectorAll(match).length);
              await new Promise((settle) => {
                requestAnimationFrame(settle);
              });
            }
            return most;
          },
          { match: selector, over: frames },
        );

      /**
       * Arrows onto an entry and asserts the ring that entry draws is the one
       * the block that marks the keyboard's position draws.
       *
       * The wait is for the mark to reach an entry other than the one it was
       * on, so what is measured is the entry the press moved to and not the
       * entry the surface opened on. A press that moves no mark fails here.
       *
       * A menu marks nothing until a key press, and a select list and the
       * palette mark an entry as they open. Where a surface marks on opening,
       * the opening mark is waited for before the press, so the press has a
       * mark to move; where it does not, that it marked nothing is asserted
       * rather than assumed, because a surface that began marking as it opened
       * would leave the press below proved by the opening mark instead.
       */
      const ringedAfterArrowing = async (
        selector: string,
        { surface, marksOnOpening }: { surface: string; marksOnOpening: boolean },
      ): Promise<void> => {
        if (marksOnOpening) {
          await expect
            .poll(async () => (await marked(selector)).on, {
              message: `the ${surface} marked no entry as it opened`,
            })
            .not.toBe('');
        } else {
          expect(
            await mostMarked(selector, 10),
            `the ${surface} marked an entry as it opened`,
          ).toBe(0);
        }

        const opened = (await marked(selector)).on;
        await page.keyboard.press('ArrowDown');
        await expect
          .poll(
            async () => {
              const now = (await marked(selector)).on;
              return now !== '' && now !== opened;
            },
            { message: `the arrow press moved no mark in the ${surface}` },
          )
          .toBe(true);

        const { width, offset } = await marked(selector);
        expect(width, `no ring on the ${surface} entry the keyboard is on`).toBeGreaterThanOrEqual(
          LEAST_RING,
        );
        // The ring the shared block draws, which is inside the entry, and not
        // the one every focused control draws outside it. A menu entry and a
        // select option both take DOM focus, so a width read on its own would
        // be satisfied by the focus ring whatever the block says, and the
        // select list could be struck from the block with every assertion here
        // green.
        expect(
          offset,
          `the ring on the ${surface} entry is not the highlight block's`,
        ).toBeLessThan(0);
      };

      await openFresh(page);
      await menuBarMenu(page, 'View').click();
      // The menu is open before the mark is read, so "nothing is marked" is
      // read of an open menu rather than of a page that has not drawn one yet.
      await expect(page.locator('.ag-menu-item').first()).toBeVisible();
      await ringedAfterArrowing('.ag-menu-item[data-highlighted]', {
        surface: 'menu',
        marksOnOpening: false,
      });
      await page.keyboard.press('Escape');

      await openPalette(page);
      await ringedAfterArrowing('.ag-palette-result[data-ag-highlighted]', {
        surface: 'palette',
        marksOnOpening: true,
      });
      await page.keyboard.press('Escape');

      // And a select list, which the three selectors share one declaration
      // block with: struck from that block, the Show, Verbosity and Accent
      // lists would mark the keyboard's position by a background difference of
      // about 1.05 to 1 again, and every test here would pass.
      await openSettings(page);
      await page.getByRole('combobox', { name: 'Density' }).click();
      await ringedAfterArrowing('.ag-select-item[data-highlighted]', {
        surface: 'select list',
        marksOnOpening: true,
      });
    },
  );

  test('follows the theme, so a dialogue is light in the light theme', async ({ page }) => {
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();

    await openSettings(page);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    // Lightness read from the resolved colour rather than from the attribute:
    // the attribute was right while the surface was unthemed.
    const lightness = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog === null) return 0;
      const match = /oklch\(([0-9.]+)/.exec(window.getComputedStyle(dialog).backgroundColor);
      return match?.[1] === undefined ? 0 : Number.parseFloat(match[1]);
    });

    expect(lightness).toBeGreaterThan(0.5);
  });

  test(
    'shows where focus is on every control of a dialogue',
    { tag: '@scale' },
    async ({ page }) => {
      await openFresh(page);
      await openSettings(page);
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

      // One Tab per control, all the way round the dialogue: a single Tab
      // lands on the menu bar and proves nothing about any overlay.
      for (let press = 0; press < 10; press += 1) {
        await page.keyboard.press('Tab');

        const outline = await page.evaluate(() => {
          const active = document.activeElement;
          if (active === null) return { name: 'nothing', style: 'none', themed: false, width: 0 };
          const style = window.getComputedStyle(active);
          return {
            name: `${active.tagName}.${typeof active.className === 'string' ? active.className : ''}`,
            style: `${style.outlineStyle} ${style.outlineWidth}`,
            // The theme has to have reached the element, which is the state
            // this test was written to catch: an unthemed surface resolves no
            // token at all. The ring's own colour is asserted separately,
            // because on some controls the browser draws it at its own width
            // and colour even though the stylesheet it was served says
            // otherwise, which is still an open question.
            themed: style.getPropertyValue('--ag-chrome-border-focus').trim() !== '',
            width: Number.parseFloat(style.outlineWidth),
          };
        });

        expect(outline.style, `no focus ring on ${outline.name}`).not.toContain('none');
        expect(outline.themed, `the theme does not reach ${outline.name}`).toBe(true);
        // At least the least a reader needs to see, on every engine and at
        // every scale the suite runs at. The declaration is wider, so that an
        // engine rounding the ring down to whole device pixels still draws that
        // much.
        expect(
          outline.width,
          `the ring on ${outline.name} is too thin to see`,
        ).toBeGreaterThanOrEqual(LEAST_RING);
      }
    },
  );

  test(
    'declares the focus ring wide enough that no scale of one or more draws it under two pixels, and lets no rule take it away',
    { tag: '@scale' },
    async ({ page }) => {
      // What the served stylesheet says, read from the rule rather than from a
      // rendered ring: the rendered width is rounded by the engine, so it
      // cannot hold the declaration on its own.
      await openFresh(page);

      // The ring is declared in AudioGubbins' own rules, and the docking
      // engine's stylesheet carries rules that take an outline away, one of
      // which took the ring from a group's contents. So the width is read of
      // AudioGubbins' rules, and what takes a ring away of every rule served.
      // Inside media rules as well: the forced-colours ring is declared in
      // one, and a walk over the top level never read it.
      const { token, rules, fallbacks, layered, switchedOff, takenAway } = await page.evaluate(
        () => {
          // Each rule with the media condition it is declared under, if any,
          // and whether it is in a cascade layer.
          const within = (
            list: CSSRuleList,
            media: string,
            inLayer: boolean,
          ): { rule: CSSStyleRule; media: string; inLayer: boolean }[] =>
            [...list].flatMap((rule) =>
              rule instanceof CSSStyleRule
                ? [{ rule, media, inLayer }]
                : rule instanceof CSSMediaRule
                  ? within(rule.cssRules, rule.conditionText, inLayer)
                  : rule instanceof CSSLayerBlockRule
                    ? within(rule.cssRules, media, true)
                    : rule instanceof CSSGroupingRule
                      ? within(rule.cssRules, media, inLayer)
                      : [],
            );
          // In the order they are served, which is the order the cascade
          // breaks a tie of specificity in.
          const every = [...document.styleSheets]
            .flatMap((sheet) => within(sheet.cssRules, '', false))
            .map((entry, order) => ({ ...entry, order }));
          const ours = /\[data-ag-theme\]|\.ag-/;
          const all = every.filter(({ rule }) => ours.test(rule.selectorText));
          // The ring's width is declared once, as a property the ring and a
          // scrolling container that pads for it both read; read as declared.
          const declared = all
            .filter(({ rule }) => rule.selectorText === '[data-ag-theme]')
            .map(({ rule }) => rule.style.getPropertyValue('--ag-focus-ring-width').trim())
            .filter((value) => value !== '');
          // The token, or the token with a fallback for a screen drawn
          // before the theme applies, which has to be the width the token
          // declares: a different fallback is reported as itself, and fails.
          const resolved = (width: string): string => {
            const read = /^var\(--ag-focus-ring-width(?:,\s*([^)]+))?\)$/.exec(width);
            if (read === null || declared.length !== 1) return width;
            const fallback = read[1]?.trim();
            return fallback === undefined || fallback === declared[0]
              ? (declared[0] ?? '')
              : `fallback ${fallback}`;
          };
          // The width an outline is drawn at: its longhand, or the token where
          // the shorthand names it, which leaves the longhand unread until the
          // property is substituted. A shorthand that names no token is
          // reported whole, and fails.
          const ringWidth = /var\(--ag-focus-ring-width(?:,[^)]*)?\)/;
          const outlineWidth = (style: CSSStyleDeclaration): string => {
            const shorthand = style.getPropertyValue('outline').trim();
            return style.outlineWidth !== ''
              ? style.outlineWidth
              : (ringWidth.exec(shorthand)?.[0] ?? shorthand);
          };
          // A rule draws the ring where it gives an outline the token's width,
          // or gives any outline to an element with focus, or in it, or to the
          // entry the keyboard is on in a list: a ring there at a width of its
          // own is read as well, and fails. A rule that recolours a ring and
          // declares no width draws none of its own.
          const marksAnEntry = /:focus|\[data-(?:ag-)?highlighted\]/;
          const drawsTheRing = (rule: CSSStyleRule): boolean => {
            const width = outlineWidth(rule.style);
            return width !== '' && (ringWidth.test(width) || marksAnEntry.test(rule.selectorText));
          };
          // Every served rule, the engine's included, that takes the outline
          // away from an element the page puts in the tab order, as it matches
          // that element with focus, where no rule of AudioGubbins' that draws
          // the ring on focus outranks it there. A rule outranks another by
          // importance, then by the specificity of its most specific selector
          // that matches, then by coming later; a rule under a media condition
          // answers one under no condition only where that condition holds, so
          // it answers only rules under the same condition.
          const reachedByTab = [...document.querySelectorAll('*')].filter(
            (element) =>
              element instanceof HTMLElement &&
              element.tabIndex >= 0 &&
              !element.matches(':disabled') &&
              element.getClientRects().length > 0,
          );
          // The selectors of a list, split at no comma inside a function or
          // an attribute.
          const selectorsOf = (list: string): string[] => {
            const found: string[] = [];
            let depth = 0;
            let from = 0;
            for (let at = 0; at < list.length; at += 1) {
              const char = list[at];
              if (char === '(' || char === '[') depth += 1;
              else if (char === ')' || char === ']') depth -= 1;
              else if (char === ',' && depth === 0) {
                found.push(list.slice(from, at).trim());
                from = at + 1;
              }
            }
            found.push(list.slice(from).trim());
            return found;
          };
          const closing = (text: string, open: number): number => {
            let depth = 0;
            for (let at = open; at < text.length; at += 1) {
              if (text[at] === '(') depth += 1;
              else if (text[at] === ')') {
                depth -= 1;
                if (depth === 0) return at;
              }
            }
            return text.length;
          };
          type Weight = readonly number[];
          const outranks = (one: Weight, other: Weight): boolean => {
            for (let at = 0; at < Math.max(one.length, other.length); at += 1) {
              const mine = one[at] ?? 0;
              const theirs = other[at] ?? 0;
              if (mine !== theirs) return mine > theirs;
            }
            return false;
          };
          const larger = (one: Weight, other: Weight): Weight =>
            outranks(other, one) ? other : one;
          // Ids; classes, attributes and pseudo-classes; types and
          // pseudo-elements. `:where()` weighs nothing, and `:is()`, `:not()`
          // and `:has()` weigh what the heaviest selector in them weighs.
          const name = /^-?[\w-]+/;
          const specificity = (selector: string): Weight => {
            const weight = [0, 0, 0];
            const add = (more: Weight) => {
              for (let at = 0; at < 3; at += 1) weight[at] = (weight[at] ?? 0) + (more[at] ?? 0);
            };
            let at = 0;
            while (at < selector.length) {
              const rest = selector.slice(at);
              const past = (skip: number) => skip + (name.exec(rest.slice(skip))?.[0].length ?? 0);
              if (rest.startsWith('::')) {
                add([0, 0, 1]);
                at += past(2);
                if (selector[at] === '(') at = closing(selector, at) + 1;
              } else if (rest.startsWith(':')) {
                const pseudo = name.exec(rest.slice(1))?.[0] ?? '';
                at += 1 + pseudo.length;
                if (selector[at] === '(') {
                  const end = closing(selector, at);
                  const inner = selector.slice(at + 1, end);
                  at = end + 1;
                  if (['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any'].includes(pseudo)) {
                    add(selectorsOf(inner).map(specificity).reduce(larger, [0, 0, 0]));
                  } else if (pseudo !== 'where') {
                    add([0, 1, 0]);
                  }
                } else if (['before', 'after', 'first-line', 'first-letter'].includes(pseudo)) {
                  add([0, 0, 1]);
                } else {
                  add([0, 1, 0]);
                }
              } else if (rest.startsWith('#')) {
                add([1, 0, 0]);
                at += past(1);
              } else if (rest.startsWith('.')) {
                add([0, 1, 0]);
                at += past(1);
              } else if (rest.startsWith('[')) {
                add([0, 1, 0]);
                at = Math.max(at + 1, selector.indexOf(']', at) + 1);
              } else if (/^[a-zA-Z]/.test(rest)) {
                add([0, 0, 1]);
                at += past(0);
              } else {
                at += 1;
              }
            }
            return weight;
          };
          // A selector as it matches an element with focus, which is how the
          // element is when its ring is drawn. One naming a pseudo-element
          // styles that and not the element, and is left out.
          const pseudoElement = /::|:(?:before|after|first-line|first-letter)(?![\w-])/;
          const withFocus = (selector: string): string =>
            selector.replaceAll(/:focus(?:-visible|-within)?(?![\w-])/g, ':is(*)');
          const matching = (list: string, element: Element): Weight | undefined => {
            const weights = selectorsOf(list)
              .filter((selector) => !pseudoElement.test(selector))
              .filter((selector) => element.matches(withFocus(selector)))
              .map(specificity);
            return weights.length === 0 ? undefined : weights.reduce(larger);
          };
          const important = (style: CSSStyleDeclaration): number =>
            style.getPropertyPriority('outline-style') === 'important' ||
            style.getPropertyPriority('outline-width') === 'important'
              ? 1
              : 0;
          const takesItAway = (style: CSSStyleDeclaration): boolean =>
            style.outlineStyle === 'none' || /^0(?:\.0+)?(?:px)?$/.test(style.outlineWidth);
          const rings = every.filter(
            ({ rule }) =>
              ours.test(rule.selectorText) &&
              rule.selectorText.includes(':focus-visible') &&
              drawsTheRing(rule) &&
              rule.style.outlineStyle !== '' &&
              rule.style.outlineStyle !== 'none',
          );
          const named = (element: Element): string =>
            `${element.tagName.toLowerCase()}${element.hasAttribute('role') ? `[role="${element.getAttribute('role') ?? ''}"]` : ''}`;
          const offences = every
            .filter(({ rule }) => takesItAway(rule.style))
            .flatMap(({ rule, media, order }) =>
              reachedByTab.flatMap((element) => {
                const weight = matching(rule.selectorText, element);
                if (weight === undefined) return [];
                const rank = [important(rule.style), ...weight, order];
                const answered = rings.some((ring) => {
                  if (ring.media !== '' && ring.media !== media) return false;
                  const ringWeight = matching(ring.rule.selectorText, element);
                  return (
                    ringWeight !== undefined &&
                    outranks([important(ring.rule.style), ...ringWeight, ring.order], rank)
                  );
                });
                const where = media === '' ? '' : ` under ${media}`;
                return [{ answered, what: `${rule.selectorText}${where}, on ${named(element)}` }];
              }),
            );

          return {
            token: declared.length === 1 ? (declared[0] ?? '') : '',
            rules: all
              .filter(({ rule }) => drawsTheRing(rule))
              .map(({ rule, media }) => ({
                selector: rule.selectorText,
                width: resolved(outlineWidth(rule.style)),
                media,
              })),
            // Every fallback the token is given, in any declaration: a ring's
            // offset is its width taken inwards, so a fallback there narrower
            // or wider than the token moves the ring on a screen drawn before
            // the theme applies. Each is reported where it is not the token.
            fallbacks: all.flatMap(({ rule }) =>
              Array.from(
                rule.style.cssText.matchAll(/var\(--ag-focus-ring-width,\s*([^)]+)\)/g),
                (found) => found[1]?.trim() ?? '',
              )
                .filter((fallback) => declared.length !== 1 || fallback !== declared[0])
                .map((fallback) => `${rule.selectorText}: fallback ${fallback}`),
            ),
            layered: every.filter(({ inLayer }) => inLayer).length,
            switchedOff: offences.length,
            takenAway: [
              ...new Set(offences.filter(({ answered }) => !answered).map(({ what }) => what)),
            ],
          };
        },
      );

      // Drawn in whole device pixels and rounded down, as Firefox draws it, a
      // ring declared w pixels wide is floor(w * s) / s CSS pixels at a scale
      // of s device pixels to a CSS pixel. Firefox lays a page out in sixtieths
      // of a CSS pixel, a whole number n of them to a device pixel, so its
      // scales are 60 / n: at a text size of 110 per cent n is 55, and a ring
      // declared two wide is drawn floor(2 * 60/55) * 55/60 = 1.83 wide; at 125
      // per cent n is 48, and it is drawn 1.6 wide. Read at every hundredth of
      // a scale from one to four, and at every 60 / n between them, the
      // declaration holds the least a reader needs at each; three is the least
      // whole width that does.
      expect(token, 'the ring is declared other than once').toMatch(/^[\d.]+px$/);
      const width = Number.parseFloat(token);
      const scales = [
        ...Array.from({ length: 301 }, (_, step) => (100 + step) / 100),
        ...Array.from({ length: 46 }, (_, step) => 60 / (15 + step)),
      ];
      expect(scales).toContain(60 / 55);
      const narrowest = Math.min(...scales.map((scale) => Math.floor(width * scale) / scale));
      expect(
        narrowest,
        `a ${token} ring is drawn under the least at some scale`,
      ).toBeGreaterThanOrEqual(LEAST_RING);

      expect(rules.map((rule) => rule.selector)).toContain('[data-ag-theme] :focus-visible');
      // The forced-colours ring itself, found by its condition: counted, any
      // other rule standing in its place would pass.
      expect(rules).toContainEqual({
        selector: '[data-ag-theme] :focus-visible',
        width: token,
        media: '(forced-colors: active)',
      });
      // The ring on the entry the keyboard is on, which no element with focus
      // draws: counted, so that a reading of focus rules alone fails.
      expect(rules).toContainEqual({
        selector: expect.stringContaining('.ag-menu-item[data-highlighted]'),
        width: token,
        media: '',
      });
      expect(rules.filter((rule) => rule.width !== token)).toEqual([]);
      expect(fallbacks).toEqual([]);

      // Nothing takes the ring away from what Tab reaches. The engine's rules
      // that take an outline away from its tabs are read and answered, so a
      // reading that found no such rule would have read none of the engine's.
      expect(layered, 'a served rule is in a cascade layer, which this does not rank').toBe(0);
      expect(switchedOff, 'no served rule takes an outline away').toBeGreaterThan(0);
      expect(takenAway, 'a rule takes the ring away from what Tab reaches').toEqual([]);
    },
  );
});

test.describe('the shell is operable from the keyboard alone', () => {
  test('reaches the menu bar with one Tab', async ({ page }) => {
    await openFresh(page);

    await page.keyboard.press('Tab');

    // The toolbar's roving focus means the whole menu bar costs one stop, not
    // one per menu. The stop is the first menu, File.
    await expect(menuBarMenu(page, 'File')).toBeFocused();
  });

  test('moves between the menus with the arrow keys', async ({ page }) => {
    await openFresh(page);

    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');

    await expect(menuBarMenu(page, 'Edit')).toBeFocused();
  });

  test('opens a menu with Enter and chooses with the arrow keys', async ({ page }) => {
    await openFresh(page);

    // To the View menu, past File and Edit, and into it, each press waiting
    // for the focus the one before moved.
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    await expect(menuBarMenu(page, 'Edit')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(menuBarMenu(page, 'View')).toBeFocused();
    await page.keyboard.press('Enter');

    // The dark theme is in use, so its entry cannot be chosen; focus opens on
    // it all the same, and its name carries the reason, which is how a
    // keyboard or screen-reader user learns which theme is in force. The arrow
    // keys passed over it, and only a pointer user could tell.
    const dark = page.getByRole('menuitem', { name: /Use the dark theme/ });
    await expect(dark).toBeFocused();
    await expect(dark).toHaveAttribute('aria-disabled', 'true');
    await expect(dark).toHaveAccessibleName(/The dark theme is already in use\./);

    // Chosen, it runs nothing and the menu stays open.
    await page.keyboard.press('Enter');
    await expect(dark).toBeVisible();
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'dark');

    // Waiting for the focus to arrive rather than pressing straight on: the
    // menu moves focus on the next task, so a test that pressed Enter in the
    // same millisecond would choose the entry the user had just moved off.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Use the light theme' })).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
  });

  test('shows where focus is', { tag: '@scale' }, async ({ page }) => {
    // An invisible focus position makes keyboard operation impossible however
    // correct the tab order is.
    await openFresh(page);
    await page.keyboard.press('Tab');

    const outline = await page.evaluate(() => {
      const focused = document.activeElement;
      if (focused === null) return { style: '', width: 0 };
      const style = window.getComputedStyle(focused);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });

    expect(outline.style).not.toBe('none');
    expect(outline.style).not.toBe('');
    // And wide enough to see, as on every control of a dialogue: a ring drawn
    // a pixel wide is a style that is not `none` and one a reader can miss.
    expect(outline.width).toBeGreaterThanOrEqual(LEAST_RING);
  });

  test('keeps focus inside an open dialogue', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);

    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab');

      const inside = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.contains(document.activeElement) === true;
      });

      expect(inside).toBe(true);
    }
  });

  test('returns focus to where it started when a dialogue closes', async ({ page }) => {
    await openFresh(page);

    await page.keyboard.press('Tab');
    await expect(menuBarMenu(page, 'File')).toBeFocused();

    await openSettings(page);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(menuBarMenu(page, 'File')).toBeFocused();
  });

  test('returns focus after a portalled control was used inside the dialogue', async ({ page }) => {
    // The defect: a select, a popover and a menu render into the document body
    // rather than inside the dialogue, so choosing an accent colour recorded a
    // portalled option as the place to go back to. That option is removed when
    // the select closes, so there was nothing to restore and focus fell to the
    // document body, which drops a keyboard user out of the application.
    await openFresh(page);

    await page.keyboard.press('Tab');
    await expect(menuBarMenu(page, 'File')).toBeFocused();

    await openSettings(page);
    await page.getByRole('combobox', { name: 'Accent colour' }).click();
    await page.getByRole('option', { name: 'Green' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();

    await expect(menuBarMenu(page, 'File')).toBeFocused();
  });

  test('returns focus when the dialogue was opened from the palette', async ({ page }) => {
    // The palette closes and the dialogue opens in one commit, so the most
    // recent position outside the dialogue is an element that no longer exists.
    await openFresh(page);

    await page.keyboard.press('Tab');
    await expect(menuBarMenu(page, 'File')).toBeFocused();

    await openPalette(page);
    await page.getByRole('combobox').fill('Settings');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();

    await expect(menuBarMenu(page, 'File')).toBeFocused();
  });

  test('returns focus when the palette itself closes', async ({ page }) => {
    await openFresh(page);

    await page.keyboard.press('Tab');
    await expect(menuBarMenu(page, 'File')).toBeFocused();

    await openPalette(page);
    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(menuBarMenu(page, 'File')).toBeFocused();
  });

  test(
    'reaches the advice on making room from the keyboard, every notice dismissed, at the reflow size',
    { tag: '@scale' },
    async ({ page }) => {
      // The advice is text after every button of a bar that scrolls, so without
      // a stop of the Tab order on the bar itself, a keyboard reader with the
      // notices dismissed cannot bring the rest of it into view (WCAG 2.1.1).
      const { bar, advice } = await barHoldingTheAdvice(page);
      const endInSight = async (): Promise<boolean> => {
        const { seen } = await seenOf(advice);
        const end = await advice.evaluate((element) => element.getBoundingClientRect().bottom);
        return seen.bottom >= end - HALF_A_PIXEL;
      };
      expect(await endInSight(), 'the end of the advice is in sight before any key').toBe(false);

      // Tab is pressed from the menu bar, as a reader comes to the foot of the
      // page.
      await menuBarMenu(page, 'View').focus();
      await expect(bar).not.toBeFocused();
      await tabTo(page, bar);

      // The ring is drawn inside the bar, which sits at the foot of a page
      // that would cut a ring drawn outside it.
      const ring = await seenOf(bar, { ring: true });
      expect(ring.outline, 'no ring on the bar').toBe('solid');
      expect(ring.width, 'the ring on the bar is too thin to see').toBeGreaterThanOrEqual(
        LEAST_RING,
      );
      expect(ring.cutBy, 'the ring is cut').toEqual([]);
      // And nothing is painted over it, an item positioned over its band or a
      // scrollbar the engine draws, which no reading of its box can see.
      expect(await unpaintedSides(bar), 'something is painted over the ring').toEqual([]);

      await page.keyboard.press('End');
      await expect
        .poll(endInSight, { message: 'the End key does not bring the end of the advice into view' })
        .toBe(true);
      await expect(bar, 'the key moved the reader off the bar').toBeFocused();
    },
  );

  test('shows the whole ring on the status bar beside a classic scrollbar', async ({
    playwright,
    baseURL,
    deviceScaleFactor,
    extraHTTPHeaders,
    locale,
    timezoneId,
    userAgent,
  }, testInfo) => {
    // The bar scrolls while it holds more than it shows, and its ring is drawn
    // inside it, along the inline end where a classic scrollbar takes room.
    // One engine's scrollbar is read once, so it runs in one Chromium project.
    test.skip(
      testInfo.project.name !== 'chromium-accessibility',
      'Read once, in a Chromium of its own that draws its scrollbars.',
    );
    const options = { baseURL, deviceScaleFactor, extraHTTPHeaders, locale, timezoneId, userAgent };
    await withScrollbarsDrawn(playwright, options, REFLOW, async (page) => {
      const { bar } = await barHoldingTheAdvice(page);
      expect(
        await bar.evaluate(roomTakenByAScrollbar),
        'no scrollbar takes room beside the bar',
      ).toBeGreaterThan(0);

      await menuBarMenu(page, 'View').focus();
      await expect(bar).not.toBeFocused();
      await tabTo(page, bar);

      expect((await seenOf(bar, { ring: true })).cutBy, 'the ring is cut').toEqual([]);
      expect(
        await unpaintedSides(bar),
        'the scrollbar, or something else, is painted over the ring',
      ).toEqual([]);
    });
  });

  test(
    'keeps a name with no space inside the status bar at the reflow size, and stops Tab at the bar exactly while it holds more than it shows',
    { tag: '@scale' },
    async ({ page }) => {
      // A workspace name may run to its bound with no space, wider than the
      // bar at the reflow size. Held to its longest word, the name would
      // reach past the bar's end, which the bar would scroll sideways to and
      // a keyboard reader could not (WCAG 1.4.10 and 2.1.1). The bar is a
      // stop of the Tab order while it holds more than it shows on either
      // axis, and only then: at the reflow size, where the name runs over
      // several lines, and not at a desktop size, where all of it fits.
      const name = 'W'.repeat(LONGEST_WORKSPACE_NAME);
      await openFresh(page);
      await menuBarMenu(page, 'Workspace').click();
      await page.getByRole('menuitem', { name: 'Save this workspace as a new one' }).click();
      await openSettings(page);
      const dialog = page.getByRole('dialog', { name: 'Settings' });
      await dialog.getByRole('tab', { name: 'Workspaces' }).click();
      await dialog.getByLabel('New name').fill(name);
      await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      const bar = page.getByRole('contentinfo', { name: 'Status' });
      const named = bar.locator('.ag-status-item').first();
      await expect(named).toHaveText(name);
      await expect(bar.getByRole('button', { name: /^Dismiss/u }), 'a notice stands').toHaveCount(
        0,
      );

      /** Whether the bar holds more than it shows, downwards and sideways. */
      const overflows = async () =>
        await bar.evaluate((element) => ({
          down: element.scrollHeight > element.clientHeight,
          across: element.scrollWidth > element.clientWidth,
        }));

      await page.setViewportSize(REFLOW);
      expect((await overflows()).across, 'the bar scrolls sideways').toBe(false);

      // The name's last letter lies between the bar's sides, so no part of the
      // name is cut at the side.
      const end = await named.evaluate((item) => {
        const text = item.firstChild;
        const holder = item.parentElement;
        if (text === null || holder === null) throw new Error('The name is not in the bar.');
        const letter = document.createRange();
        letter.setStart(text, (text.textContent ?? '').length - 1);
        letter.setEnd(text, (text.textContent ?? '').length);
        const drawn = letter.getBoundingClientRect();
        const box = holder.getBoundingClientRect();
        const start = box.left + holder.clientLeft;
        return {
          left: drawn.left - start,
          right: start + holder.clientWidth - drawn.right,
        };
      });
      expect(
        end.left,
        'the end of the name lies before the start of the bar',
      ).toBeGreaterThanOrEqual(-HALF_A_PIXEL);
      expect(end.right, 'the end of the name lies past the end of the bar').toBeGreaterThanOrEqual(
        -HALF_A_PIXEL,
      );

      // The bar holds more than it shows here, so Tab stops at it.
      const narrow = await overflows();
      expect(narrow.down || narrow.across, 'the bar shows all it holds at the reflow size').toBe(
        true,
      );
      await expect(bar).toHaveAttribute('tabindex', '0');
      await menuBarMenu(page, 'View').focus();
      await expect(bar).not.toBeFocused();
      await tabTo(page, bar);

      // And at a desktop size it shows all of it, so Tab passes it by.
      await page.setViewportSize({ width: 1280, height: 720 });
      expect(await overflows(), 'the bar holds more than it shows at a desktop size').toEqual({
        down: false,
        across: false,
      });
      await expect(bar, 'the bar stops Tab with nothing to reach').toHaveAttribute(
        'tabindex',
        '-1',
      );
    },
  );
});

test.describe('the dock says which panel and which group without colour', () => {
  test(
    'underlines the tab each group shows and outlines the group in use',
    { tag: '@scale' },
    async ({ page }) => {
      // The engine tells both apart by colour alone: the two groups' tab
      // backgrounds resolve to one token here, so the only difference between
      // the group in use and the one beside it was primary text against
      // secondary (WCAG 1.4.1). The marks existed only under forced colours.
      // Five menu entries act on "this panel", so which group is in use is
      // something a user has to be able to see.
      await openFresh(page);

      /**
       * The bottom border a locator's first element draws: its style, and its
       * width as a number.
       *
       * A number rather than the text, because an engine draws a border in
       * whole device pixels and, where a CSS pixel is a fraction of one,
       * reports the width it drew: Firefox at a text size of 110 per cent
       * reports a two-pixel border as 1.83 pixels.
       */
      const border = (locator: ReturnType<typeof tabsShown>) =>
        locator.first().evaluate((element) => {
          const drawn = getComputedStyle(element);
          return {
            style: drawn.borderBottomStyle,
            width: Number.parseFloat(drawn.borderBottomWidth),
            colour: drawn.borderBottomColor,
          };
        });

      /** The same of the border a group draws over itself. */
      const outlineOf = (locator: ReturnType<typeof groupInUse>) =>
        locator.first().evaluate((element) => {
          const drawn = getComputedStyle(element, '::after');
          return { style: drawn.borderTopStyle, width: Number.parseFloat(drawn.borderTopWidth) };
        });

      const shown = await border(tabsShown(page));
      expect(shown.style).toBe('solid');
      expect(shown.width).toBeGreaterThan(1.5);

      const inUse = await outlineOf(groupInUse(page));
      expect(inUse.style).toBe('solid');
      expect(inUse.width).toBeGreaterThan(1.5);

      // A second group, so the marks tell groups apart rather than marking
      // everything.
      await menuBarMenu(page, 'Workspace').click();
      await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();
      await expect(tabsHidden(page)).not.toHaveCount(0);

      // The tab not being shown reserves the same two pixels and draws nothing
      // in them. The engine lays a tab out as a stretched flex item with no
      // height of its own, so a border that appears only on the shown tab comes
      // out of its content box and the label moves up two pixels the moment its
      // tab becomes the shown one.
      const hidden = await border(tabsHidden(page));
      expect(hidden.width).toBeGreaterThan(1.5);
      expect(hidden.colour).toBe('rgba(0, 0, 0, 0)');
      expect(shown.colour).not.toBe('rgba(0, 0, 0, 0)');

      expect((await outlineOf(groupsNotInUse(page))).width).toBeLessThan(1.5);
    },
  );

  test(
    'still marks the tab a group shows while that tab holds focus, in every theme, density and contrast',
    { tag: '@scale' },
    async ({ page }) => {
      // The ring is drawn inside a focused tab, over the underline that marks
      // the shown one, so a focused shown tab looked the same as a focused tab
      // not shown. The second mark is a fill, which has to be told from the
      // tab as it was and from a focused tab not shown, and to carry its label
      // and its ring readably (WCAG 1.4.11 and 1.4.3).
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);
      await menuBarMenu(page, 'Workspace').click();
      await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();
      const shown = page.getByRole('tab', { name: 'Diagnostics', exact: true });
      const notShown = page.getByRole('tab', { name: 'Transport', exact: true });
      await expect(shown).toHaveAttribute('aria-selected', 'true');
      await expect(notShown).toHaveAttribute('aria-selected', 'false');

      for (const setting of ['dark', 'light', 'compact', 'high contrast'] as const) {
        await test.step(setting, async () => {
          if (setting === 'light') {
            await menuBarMenu(page, 'View').click();
            await page.getByRole('menuitem', { name: 'Use the light theme' }).click();
          } else if (setting === 'compact') {
            await menuBarMenu(page, 'View').click();
            await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();
            await expect(page.locator('[data-ag-density="compact"]').first()).toBeAttached();
          } else if (setting === 'high contrast') {
            await openSettings(page);
            await page.getByRole('tab', { name: 'Accessibility' }).click();
            await page.getByRole('combobox', { name: 'Contrast' }).click();
            await page.getByRole('option', { name: /^High/ }).click();
            await page.keyboard.press('Escape');
          }
          await page.locator('body').click();
          await expect(shown).not.toBeFocused();
          const before = await coloursOf(shown);

          await tabTo(page, shown);
          const focused = await coloursOf(shown);
          expect(
            contrastOf(focused.background, before.background),
            'the focused shown tab is not told from the tab as it was',
          ).toBeGreaterThanOrEqual(3);
          expect(
            contrastOf(focused.text, focused.background),
            'the label of the focused shown tab cannot be read',
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrastOf(focused.ring, focused.background),
            'the ring of the focused shown tab cannot be seen on it',
          ).toBeGreaterThanOrEqual(3);

          await page.keyboard.press('ArrowLeft');
          await expect(notShown).toBeFocused();
          expect(
            contrastOf(focused.background, (await coloursOf(notShown)).background),
            'a focused tab not shown is not told from the focused shown tab',
          ).toBeGreaterThanOrEqual(3);

          // Back to the shown tab, which the tab list then gives to Tab again.
          await page.keyboard.press('ArrowRight');
          await expect(shown).toBeFocused();
        });
      }
    },
  );
});

test.describe("the dock's tabs", () => {
  test(
    'are reached by Tab, moved along by the arrow keys, and chosen by Enter',
    { tag: '@scale' },
    async ({ page }) => {
      // The adapter replaces the engine's own tab because of two accessibility
      // defects in it, and then leans on the engine for the tab list's
      // keyboard behaviour. Nothing held that: the one thing between a
      // keyboard user and the dock was a third-party behaviour with no test on
      // it, in the module that exists because the engine's accessibility
      // cannot be relied upon (WCAG 2.1.1).
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      // A second tab in the Transport's group, so there is somewhere to move
      // to.
      await menuBarMenu(page, 'Workspace').click();
      await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();
      const transport = page.getByRole('tab', { name: 'Transport', exact: true });
      const diagnostics = page.getByRole('tab', { name: 'Diagnostics', exact: true });
      await expect(diagnostics).toHaveAttribute('aria-selected', 'true');

      // Walked from the top of the shell rather than focused directly, so what
      // is held is that a keyboard can get there at all.
      await page.locator('body').click();
      await tabTo(page, diagnostics);

      // And that the position is visible once it is there, and whole. A tab
      // fills the height of the strip, which clips whatever reaches past it,
      // so a ring drawn outside the tab lost its top and bottom; and the
      // engine drew a line of its own over the tab's edge, over the ring.
      const ring = await seenOf(diagnostics, { ring: true });
      expect(ring.outline, 'no ring on the tab').toBe('solid');
      expect(ring.width, 'the ring on the tab is too thin to see').toBeGreaterThanOrEqual(
        LEAST_RING,
      );
      expect(ring.cutBy, 'the ring is cut').toEqual([]);
      // And nothing is painted over it: an outline is drawn under a
      // descendant positioned over it, which no reading of its box can see.
      expect(await unpaintedSides(diagnostics), 'something is painted over the ring').toEqual([]);
      expect(
        await diagnostics.evaluate((element) => getComputedStyle(element, '::after').content),
        "the engine's line is drawn over the ring",
      ).toBe('none');

      await page.keyboard.press('ArrowLeft');
      await expect(transport).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(transport).toHaveAttribute('aria-selected', 'true');
      await expect(diagnostics).toHaveAttribute('aria-selected', 'false');
    },
  );
});

test.describe('a panel with more in it than fits', () => {
  test('is reachable by keyboard and scrolls', { tag: '@scale' }, async ({ page }) => {
    // The adapter puts each group's contents into the tab order and the
    // stylesheet makes them scroll. The evidence claimed both as a result while
    // no test read either, so deleting the line that sets the tab index broke
    // nothing (WCAG 2.1.1).
    await page.setViewportSize({ width: 1100, height: 700 });
    await openFresh(page);

    const panels = page.locator('[role="tabpanel"]');
    expect(await panels.count()).toBeGreaterThan(0);
    for (const panel of await panels.all()) {
      await expect(panel).toHaveAttribute('tabindex', '0');
    }

    const body = panelBody(groupShowing(page, 'Transport')).first();

    // Made taller than its group, so the scrolling is measured rather than read
    // off the stylesheet.
    await body.evaluate((element) => {
      const filler = document.createElement('div');
      filler.style.blockSize = '4000px';
      element.append(filler);
    });

    const measured = await body.evaluate((element) => ({
      scrollable: element.scrollHeight > element.clientHeight,
      overflow: getComputedStyle(element).overflowY,
    }));

    expect(measured.scrollable).toBe(true);
    expect(measured.overflow).toBe('auto');
  });

  test(
    'shows where focus is when Tab reaches its contents, with the whole ring',
    { tag: '@scale' },
    async ({ page }) => {
      // The engine took the outline away from a group's contents in a rule
      // that tied with the theme's ring and came after it, so contents reached
      // by Tab drew no ring at all (WCAG 2.4.7). And the contents fill a group
      // that clips whatever reaches past it, so a ring drawn outside them
      // would lose three of its sides.
      await page.setViewportSize({ width: 1100, height: 700 });
      await openFresh(page);
      const contents = panelBody(groupShowing(page, 'Transport')).first();
      await tabTo(page, contents);

      const ring = await seenOf(contents, { ring: true });
      expect(ring.outline, 'no ring on the contents').toBe('solid');
      expect(ring.width, 'the ring on the contents is too thin to see').toBeGreaterThanOrEqual(
        LEAST_RING,
      );
      expect(ring.cutBy, 'the ring is cut').toEqual([]);
      // And nothing is painted over it: an outline is drawn under a
      // descendant positioned over it, which no reading of its box can see.
      expect(await unpaintedSides(contents), 'something is painted over the ring').toEqual([]);
      expect(
        clearOfTheGroupBorder(ring.reach, await groupBorderAround(contents)),
        'the ring is drawn under the border over the group',
      ).toBeGreaterThanOrEqual(-HALF_A_PIXEL);
    },
  );

  test('shows the whole ring on contents that scroll, beside a classic scrollbar', async ({
    playwright,
    baseURL,
    deviceScaleFactor,
    extraHTTPHeaders,
    locale,
    timezoneId,
    userAgent,
  }, testInfo) => {
    // Contents with more in them than fits scroll, and a classic scrollbar
    // takes room at their inline end, inside their edge, where their ring is
    // drawn. One engine's scrollbar is read once, so it runs in one Chromium
    // project.
    test.skip(
      testInfo.project.name !== 'chromium-accessibility',
      'Read once, in a Chromium of its own that draws its scrollbars.',
    );
    const options = { baseURL, deviceScaleFactor, extraHTTPHeaders, locale, timezoneId, userAgent };
    await withScrollbarsDrawn(playwright, options, { width: 1100, height: 700 }, async (page) => {
      await openFresh(page);
      const contents = panelBody(groupShowing(page, 'Transport')).first();
      await contents.evaluate((element) => {
        const filler = document.createElement('div');
        filler.style.blockSize = '4000px';
        element.append(filler);
      });
      await tabTo(page, contents);

      expect(
        await contents.evaluate(roomTakenByAScrollbar),
        'no scrollbar takes room beside the contents',
      ).toBeGreaterThan(0);
      expect(
        await unpaintedSides(contents),
        'the scrollbar, or something else, is painted over the ring',
      ).toEqual([]);
    });
  });
});

test.describe('a control that cannot be used looks it', () => {
  /** The reason every control that names something gives where naming is unavailable. */
  const NAMING_UNAVAILABLE =
    'Naming workspaces and shortcut profiles is unavailable in this browser; the Capabilities panel says why.';

  /** How a control is drawn, in what the look of one that cannot be used sets. */
  interface Look {
    readonly opacity: string;
    readonly cursor: string;
    readonly colour: string;
    readonly surface: string;
    readonly border: string;
  }

  /**
   * How `control` is drawn, each part as the engine computes it once every
   * transition on the page has ended: a button eases its colours, and a
   * colour read part of the way is one neither look draws.
   */
  async function lookOf(control: Locator): Promise<Look> {
    return await control.evaluate(async (element) => {
      await Promise.allSettled(
        document
          .getAnimations()
          .filter((running) => running.effect?.getComputedTiming().endTime !== Infinity)
          .map(async (running) => await running.finished),
      );
      const style = getComputedStyle(element);
      return {
        opacity: style.opacity,
        cursor: style.cursor,
        colour: style.color,
        surface: style.backgroundColor,
        border: [
          style.borderTopColor,
          style.borderRightColor,
          style.borderBottomColor,
          style.borderLeftColor,
        ].join(' '),
      };
    });
  }

  test('draws Import as unavailable where no name can be compared, as the Change beside it is', async ({
    page,
  }) => {
    // Where the runtime makes no collator, no profile can be named, so none
    // can be imported, and the file input says so to a screen reader. What a
    // sighted reader sees and presses is the label drawn as its button, which
    // drawn as an available one would look ready to press.
    await page.addInitScript(() => {
      Reflect.set(Intl, 'Collator', function Collator(): never {
        throw new RangeError('This runtime makes no collator.');
      });
    });
    await openFresh(page);
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Shortcuts' }).click();

    // The built-in profile, whose every naming control the one note explains.
    const note = dialog.getByText(NAMING_UNAVAILABLE, { exact: true });
    await expect(note).toHaveCount(1);
    await expect(note).toBeVisible();

    const input = dialog.getByLabel('Import', { exact: true });
    await expect(input).toHaveAttribute('aria-disabled', 'true');
    await expect(input).toHaveAccessibleDescription(NAMING_UNAVAILABLE);
    // The inner locator is read inside each label, so it is the page's own.
    const label = dialog
      .locator('label')
      .filter({ has: page.getByLabel('Import', { exact: true }) });
    await expect(label).toBeVisible();
    const change = dialog.getByRole('button', {
      name: 'Change the shortcut for Show the command palette',
    });
    await expect(change).toHaveAttribute('aria-disabled', 'true');
    const available = dialog.getByRole('button', { name: 'Export', exact: true });
    await expect(available).toBeEnabled();
    await expect(available).not.toHaveAttribute('aria-disabled', 'true');

    // Read with the pointer over none of them, so none is drawn hovered.
    await page.mouse.move(0, 0);
    const unavailable = await lookOf(change);
    expect(await lookOf(label), 'Import is not drawn as an unavailable button is').toEqual(
      unavailable,
    );
    expect(
      (await lookOf(available)).colour,
      'an unavailable button is drawn in the colour of an available one',
    ).not.toBe(unavailable.colour);
  });
});

test.describe('a screen reader is told what changed', () => {
  test('says a stored workspace could not be read, rather than only showing it', async ({
    page,
  }) => {
    // The notice was drawn in the status bar and nowhere else. The status bar
    // is not a live region, so a screen-reader user was handed the built-in
    // workspace with no word of what had happened to theirs (REQ-UX-059).
    await page.addInitScript(() => {
      window.localStorage.setItem('audiogubbins.workspace', '{"groups": [');
    });
    await openFresh(page);

    await expect(
      page.locator('.ag-live-regions [role="alert"]', {
        hasText: 'The stored workspace could not be read.',
      }),
    ).toHaveCount(1);
  });

  test('announces a refused command rather than appearing to do nothing', async ({ page }) => {
    // A shortcut that seems to do nothing is how a user decides the application
    // is unreliable.
    await startAtTheBrightest(page);
    await openFresh(page);
    await refuseBrightening(page);

    // An unavailable command is said politely, and a failed one urgently (see
    // `voiced-execution.test.ts`). Scoped to AudioGubbins' own regions: the
    // docking engine renders two of its own.
    await expect(
      page.locator('.ag-live-regions [role="status"]', { hasText: /brightest/ }),
    ).toHaveCount(1);
  });

  test('says the same refusal again, rather than falling silent the second time', async ({
    page,
  }) => {
    // The defect: the same sentence written into the same region twice is one
    // announcement. React sees the same string and leaves the text node alone,
    // so the live region never fires and the second refusal is silent. Measured
    // in Chromium before the fix: three repeated refusals produced no DOM
    // mutation in the region at all.
    await startAtTheBrightest(page);
    await openFresh(page);
    await refuseBrightening(page);

    // Let the refusals already made finish reaching the page before listening.
    // Listening straight after the presses let a late commit from one of them
    // count as the repeat this test is about, so the test could pass while
    // every repeat was silent.
    await expect(
      page.locator('.ag-live-regions [role="status"]', { hasText: /brightest/ }),
    ).toHaveCount(1);
    await page.evaluate(
      async () =>
        await new Promise((settled) => {
          requestAnimationFrame(() => requestAnimationFrame(settled));
        }),
    );

    await page.evaluate(() => {
      const record: string[] = [];
      (window as unknown as { agMutations: string[] }).agMutations = record;
      const regions = document.querySelector('.ag-live-regions');
      if (regions === null) return;
      new MutationObserver((entries) => {
        for (const entry of entries) record.push(entry.type);
      }).observe(regions, { childList: true, characterData: true, subtree: true });
    });

    await brighten(page);

    await expect
      .poll(
        async () =>
          await page.evaluate(
            () => (window as unknown as { agMutations: string[] }).agMutations.length,
          ),
      )
      .toBeGreaterThan(0);
  });

  test('keeps a region of each politeness, rather than changing one', async ({ page }) => {
    // Mutating `aria-live` on one element is unreliable: a region's politeness
    // is taken when the region is created rather than when its text changes.
    await startAtTheBrightest(page);
    await openFresh(page);

    const polite = page.locator('.ag-live-regions [role="status"]');
    const assertive = page.locator('.ag-live-regions [role="alert"]');

    await expect(polite).toHaveCount(2);
    await expect(assertive).toHaveCount(2);
    await expect(polite.first()).toHaveAttribute('aria-live', 'polite');
    await expect(assertive.first()).toHaveAttribute('aria-live', 'assertive');

    // And it stays that way after a refusal is said.
    await refuseBrightening(page);
    await expect(polite.first()).toHaveAttribute('aria-live', 'polite');
    await expect(assertive.first()).toHaveAttribute('aria-live', 'assertive');
  });

  test('is not hidden from a screen reader while a dialogue is open', async ({ page }) => {
    // The opposite is easy to expect, because the primitive library marks every
    // sibling of an open dialogue `aria-hidden`. It does not mark this one: the
    // library it uses keeps every element carrying `aria-live`, and their
    // ancestors with them. This test keeps that true, because it would stop
    // being true the moment the regions were rendered only when there is
    // something to say.
    await openFresh(page);
    await openSettings(page);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    const hiddenFrom = await page.evaluate(() => {
      const region = document.querySelector('.ag-live-regions [role="alert"]');
      // Answered separately from "nothing hides it", which a page with no
      // region at all also satisfied: this test passed on an empty page.
      if (region === null) return undefined;

      const chain: string[] = [];
      let node: Element | null = region;
      while (node !== null) {
        if (node.getAttribute('aria-hidden') === 'true') chain.push(node.tagName);
        node = node.parentElement;
      }
      return chain;
    });

    expect(hiddenFrom, 'there is no live region to hide').toBeDefined();
    expect(hiddenFrom).toEqual([]);
  });

  test('shows a refusal, so a sighted user is told as well', async ({ page }) => {
    // There was no visual channel at all: a sighted user who ran an unavailable
    // command got nothing.
    await startAtTheBrightest(page);
    await openFresh(page);
    await refuseBrightening(page);

    const notice = page.locator('.ag-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/brightest/);
    await expect(notice).toHaveAttribute('data-ag-notice', 'ordinary');

    // Hidden from assistive technology, because the live region holds the
    // same sentence where a screen-reader user can find it again.
    await expect(notice).toHaveAttribute('aria-hidden', 'true');
  });

  /** Whether the reader can see all of `element`. */
  async function wholeInSight(element: Locator): Promise<boolean> {
    return (await seenOf(element)).cutBy.length === 0;
  }

  /** Opens the export dialogue from the Help menu. */
  async function exportDialogue(page: Page): Promise<Locator> {
    await menuBarMenu(page, 'Help').click();
    await page.getByRole('menuitem', { name: 'Export a diagnostic report' }).click();
    return page.getByRole('dialog', { name: 'Export a diagnostic report' });
  }

  /** Opens the settings from their shortcut. */
  async function settingsDialogue(page: Page): Promise<Locator> {
    await openSettings(page);
    return page.getByRole('dialog', { name: 'Settings' });
  }

  /**
   * A refusal raised while a dialogue is open, read against the control the
   * reader is on (WCAG 2.4.11) and against the dialogue it is shown in.
   *
   * It is part of the dialogue's own flow, above its actions. Over the page it
   * would lie over part of the dialogue wherever it was put, and placed beside
   * the reader's focus it would be squeezed to a sliver once the dialogue
   * itself held focus. `focusOn` gives the control to put focus on, or nothing,
   * for a click on the dialogue's description, which leaves focus on the
   * dialogue. `atTheTopEdge` scrolls the control to the top edge of the part
   * that scrolls first, where the least of it is in sight. `open` opens the
   * dialogue, the export dialogue unless it names another.
   */
  async function refusalInTheDialogue(
    page: Page,
    focusOn: ((dialog: Locator) => Locator) | undefined,
    refuse: (page: Page) => Promise<void>,
    { atTheTopEdge = false, open = exportDialogue } = {},
  ): Promise<{ readonly dialog: Locator; readonly notice: Locator }> {
    await openFresh(page);
    const dialog = await open(page);
    await expect(dialog).toBeVisible();

    const focused = focusOn?.(dialog);
    if (focused === undefined) {
      const description = await dialog.getAttribute('aria-describedby');
      if (description === null) throw new Error('The dialogue has no description to click.');
      await dialog.locator(`[id="${description}"]`).click();
      await expect(dialog, 'the click left focus somewhere else').toBeFocused();
    } else {
      await focused.focus();
      await expect(focused).toBeFocused();
      if (atTheTopEdge) {
        await focused.evaluate((element) => {
          element.scrollIntoView({ block: 'start' });
        });
      }
    }

    await refuse(page);
    const notice = dialog.locator('.ag-dialog-notice');
    await expect(notice).toBeVisible();
    await expect(page.locator('.ag-notice'), 'the refusal is drawn over the page too').toHaveCount(
      0,
    );

    // Nothing inside it is cut, and nothing around it cuts it or leaves it
    // out of sight.
    const whole = await notice.evaluate((element) => element.scrollHeight <= element.clientHeight);
    expect(whole, 'the refusal is cut short').toBe(true);
    expect(await wholeInSight(notice), 'the refusal is cut, or out of sight').toBe(true);

    if (focused !== undefined) {
      const noticeBox = await notice.boundingBox();
      const focusBox = await focused.boundingBox();
      if (noticeBox === null || focusBox === null) {
        throw new Error('The refusal or the focused control has no box.');
      }
      const apart =
        noticeBox.y + noticeBox.height <= focusBox.y || noticeBox.y >= focusBox.y + focusBox.height;
      expect(apart, 'the refusal covers the control the reader is on').toBe(true);
      expect(
        await wholeInSight(focused),
        'the control the reader is on is cut, or out of sight',
      ).toBe(true);
    }
    return { dialog, notice };
  }

  /** The sizes a dialogue is read at: the suite's, a phone on its side, and reflow's. */
  function dialogueSizes(
    page: Page,
  ): readonly { readonly width: number; readonly height: number }[] {
    const suiteSize = page.viewportSize();
    if (suiteSize === null) throw new Error('The page has no viewport size.');
    // WCAG 1.4.10 measures reflow at 320 by 256 pixels.
    return [suiteSize, { width: 844, height: 390 }, { width: 320, height: 256 }];
  }

  test(
    'shows a refusal in the dialogue it was raised in, beside the control the reader pressed',
    { tag: '@scale' },
    async ({ page }) => {
      // The reader's focus on the button they pressed, in the dialogue's
      // footer, which never scrolls: the refusal is read beside it.
      await startAtTheBrightest(page);
      const { notice } = await refusalInTheDialogue(
        page,
        (on) => on.getByRole('button', { name: 'Save the report', exact: true }),
        refuseBrightening,
      );
      await expect(notice).toContainText(/brightest/);
    },
  );

  test(
    'keeps a refusal in sight, whatever control near the top of a dialogue raised it',
    { tag: '@scale' },
    async ({ page }) => {
      // Above the actions of a dialogue that scrolled as a whole, the refusal
      // was out of sight whenever the reader pressed a control near the top,
      // on every engine and at every size the export dialogue scrolls at. The
      // footer it is in now does not scroll.
      await startAtTheBrightest(page);
      for (const size of dialogueSizes(page)) {
        await page.setViewportSize(size);
        const at = `${String(size.width)} by ${String(size.height)}`;

        await test.step(`the export dialogue, ${at}`, async () => {
          await refusalInTheDialogue(
            page,
            (on) => on.getByRole('switch').first(),
            refuseBrightening,
          );
        });

        await test.step(`the settings, ${at}`, async () => {
          await refusalInTheDialogue(page, (on) => on.getByRole('tab').first(), refuseBrightening, {
            open: settingsDialogue,
          });
        });
      }
    },
  );

  test(
    'keeps a long refusal clear of the control the reader is on, at either end of a dialogue and on a short page',
    { tag: '@scale' },
    async ({ page }) => {
      // A refusal of several lines, raised by a setting changed while storage
      // refuses every write. A notice one line tall clears a control by
      // accident, so the height is asserted as well.
      await page.addInitScript(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        };
      });

      for (const size of dialogueSizes(page)) {
        await page.setViewportSize(size);
        for (const [where, focusOn, atTheTopEdge] of [
          [
            'the foot',
            (dialog: Locator) =>
              dialog.getByRole('button', { name: 'Save the report', exact: true }),
            false,
          ],
          ['the top', (dialog: Locator) => dialog.getByRole('switch').first(), false],
          [
            'the top edge of a dialogue scrolled down',
            (dialog: Locator) => dialog.getByRole('switch').last(),
            true,
          ],
        ] as const) {
          await test.step(`focus at ${where}, ${String(size.width)} by ${String(size.height)}`, () =>
            refusalInTheDialogue(
              page,
              focusOn,
              async (on) => {
                await brighten(on);
                const height =
                  (await on.locator('.ag-dialog .ag-dialog-notice').boundingBox())?.height ?? 0;
                expect(height, 'the refusal is one line').toBeGreaterThan(40);
              },
              { atTheTopEdge },
            ));
        }
      }
    },
  );

  test(
    'shows the whole of a refusal, however long, with the dialogue itself focused',
    { tag: '@scale' },
    async ({ page }) => {
      // A click on the dialogue's text leaves focus on the dialogue, and so
      // does a click on a button on macOS and iPadOS, where a button takes no
      // focus from a click. Measured beside the focus, the notice was then the
      // room beside the whole dialogue, a sliver less than a line tall.
      await startAtTheBrightest(page);
      for (const size of dialogueSizes(page)) {
        await page.setViewportSize(size);
        await test.step(`${String(size.width)} by ${String(size.height)}`, async () => {
          const { dialog } = await refusalInTheDialogue(page, undefined, refuseBrightening);

          // No refusal this shell raises runs to many lines, so the one on
          // screen is made to.
          const notice = await lengthenRefusal(dialog);
          // In lines of the font's size, which the density sets, so the check
          // reads the same in either.
          const tall = await notice.evaluate(
            (element) =>
              element.clientHeight / Number.parseFloat(getComputedStyle(element).fontSize),
          );
          expect(tall, 'the refusal is squeezed').toBeGreaterThan(10);
          expect(
            await notice.evaluate((element) => element.scrollHeight <= element.clientHeight),
            'the refusal is cut short',
          ).toBe(true);

          // The part that scrolls keeps room inside its padding for the
          // tallest control in it and that control's focus ring, whatever the
          // footer holds: here, a refusal that leaves it no more than that.
          const { room, needed } = await dialog
            .locator('.ag-dialog-scroll')
            .evaluate(roomForAControl);
          expect(
            room,
            'the refusal left the dialogue no room for a control and its ring',
          ).toBeGreaterThanOrEqual(needed - HALF_A_PIXEL);

          // The reader reaches the end of it as they would, with the wheel over
          // the dialogue.
          const box = await dialog.boundingBox();
          if (box === null) throw new Error('The dialogue has no box.');
          await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
          await scrollUntilInSight(notice, 'end', 'wheel', 'stops', async () => {
            await page.mouse.wheel(0, 120);
          });
        });
      }
    },
  );

  test(
    'shows the whole of a refusal, however long, to the keys from the button pressed',
    { tag: '@scale' },
    async ({ page }) => {
      // A keyboard reader, on the button they pressed in the footer, which does
      // not scroll of its own, at every size the suite reads a dialogue at, a
      // desktop's among them. The keys a reader reads on with scroll the
      // dialogue that holds the button, down to the end of the refusal and back
      // up to its start, and leave them on the button. Space is not among them:
      // on a button it presses it.
      const pressed = (on: Locator) =>
        on.getByRole('button', { name: 'Save the report', exact: true });
      await startAtTheBrightest(page);
      await recordScrollOrder(page);
      for (const size of dialogueSizes(page)) {
        await page.setViewportSize(size);
        await test.step(`${String(size.width)} by ${String(size.height)}`, async () => {
          const { dialog } = await refusalInTheDialogue(page, pressed, refuseBrightening);
          const notice = await lengthenRefusal(dialog);
          await expect(pressed(dialog)).toBeFocused();

          await scrollUntilInSight(notice, 'end', 'PageDown key', 'ends', async () => {
            await page.keyboard.press('PageDown');
          });
          await scrollUntilInSight(notice, 'start', 'ArrowUp key', 'ends', async () => {
            await page.keyboard.press('ArrowUp');
          });
          await expect(pressed(dialog), 'the keys moved the reader off the button').toBeFocused();

          // Every press reached the page after the end of the scroll before
          // it, as the page received them, the first after the scrolls that
          // raising and lengthening the refusal made. A press made before that
          // end is lost in some runs and kept in others, so the order is what
          // is held, and not only where the refusal came to.
          const order = await scrollOrderOf(notice, ['PageDown', 'ArrowUp']);
          expect(new Set(order.pressed), 'the page received none of a key').toEqual(
            new Set(['PageDown', 'ArrowUp']),
          );
          expect(order.early, 'a key was pressed before the scroll before it ended').toEqual([]);
        });
      }
    },
  );

  test(
    'draws the whole focus ring of a control in a dialogue, at either end of the part that scrolls and in its footer',
    { tag: '@scale' },
    async ({ page }) => {
      // The part that scrolls and the footer are containers of their own, so
      // the ring of a control at one of their edges keeps its edges only with
      // room left for it: at the top of the part, at its foot where the
      // browser scrolls a control reached with Tab, and in the footer.
      for (const size of dialogueSizes(page)) {
        await page.setViewportSize(size);
        const at = `${String(size.width)} by ${String(size.height)}`;
        const cases: readonly [string, (page: Page) => Promise<Locator>][] = [
          [
            "the palette's field",
            async (on) => {
              await openPalette(on);
              return on.getByRole('dialog').getByRole('combobox');
            },
          ],
          [
            "the settings' first tab",
            async (on) => (await settingsDialogue(on)).getByRole('tab').first(),
          ],
          [
            "the export dialogue's last switch",
            async (on) => (await exportDialogue(on)).getByRole('switch').last(),
          ],
          [
            "the export dialogue's last action",
            async (on) => (await exportDialogue(on)).locator('.ag-dialog-actions button').last(),
          ],
        ];
        // One page at each size. Each dialogue is closed before the next opens,
        // and focus is taken off whatever the closing gave it back to, so each
        // case starts where a page just opened does: no dialogue, and focus on
        // the document's body.
        await openFresh(page);
        for (const [what, open] of cases) {
          await test.step(`${what}, ${at}`, async () => {
            const control = await open(page);
            await tabTo(page, control);

            const ring = await seenOf(control, { ring: true });
            expect(ring.outline).toBe('solid');
            expect(ring.reach).toBeGreaterThan(3);
            expect(ring.cutBy, 'the ring is cut').toEqual([]);

            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await page.evaluate(() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            });
            expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
          });
        }
      }

      // At the foot of the part that scrolls, where a control is brought into
      // view at the nearest edge: as the dialogue brings back the control the
      // reader is on after a refusal, and as an engine that scrolls focus to
      // the nearest edge does. Where Tab alone brings a control into view is
      // the engine's choice, so it is brought to the edge here.
      await test.step("the export dialogue's last switch, brought into view at the foot of the part that scrolls", async () => {
        await page.setViewportSize({ width: 320, height: 256 });
        await openFresh(page);
        const dialog = await exportDialogue(page);
        const control = dialog.getByRole('switch').last();
        await tabTo(page, control);

        const part = dialog.locator('.ag-dialog-scroll');
        await part.evaluate((element) => {
          element.scrollTop = 0;
        });
        await control.evaluate((element) => {
          element.scrollIntoView({ block: 'nearest' });
        });
        expect(
          await part.evaluate((element) => element.scrollTop),
          'the part that scrolls did not scroll to the control',
        ).toBeGreaterThan(0);

        const ring = await seenOf(control, { ring: true });
        expect(ring.cutBy, 'the ring is cut').toEqual([]);
      });
    },
  );

  test('shows a refusal inside an open dialogue, where the status bar is not', async ({ page }) => {
    await startAtTheBrightest(page);
    await openFresh(page);
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    await refuseBrightening(page);

    // Inside the dialogue rather than merely present: the scrim covers the
    // status bar, which is why the notice is not in it, and a notice over the
    // page lay over part of the dialogue wherever it was put.
    await expect(dialog.locator('.ag-dialog-notice')).toContainText(/brightest/);
    await expect(page.locator('.ag-notice')).toHaveCount(0);
  });

  test(
    "names every landmark on the page, the docking engine's included",
    { tag: '@scale' },
    async ({ page }) => {
      await openFresh(page);

      // No exceptions, the docking engine's tab lists included: they can be
      // named from outside the engine, and the adapter names each one after the
      // region it is in.
      const unnamed = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '[role="toolbar"], [role="menubar"], [role="tablist"], [role="menu"]',
          ),
        ]
          .filter(
            (element) =>
              element.getAttribute('aria-label') === null &&
              element.getAttribute('aria-labelledby') === null,
          )
          .map((element) => element.outerHTML.slice(0, 80)),
      );

      expect(unnamed).toEqual([]);
    },
  );

  test('names each tab list after the region it is in', { tag: '@scale' }, async ({ page }) => {
    // Four unnamed tab lists gave a screen reader nothing to tell them apart.
    await openFresh(page);

    await expect(page.getByRole('tablist', { name: 'Left panels' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Main panels' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Right panels' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Bottom panels' })).toBeVisible();
  });

  test('gives the page a language, so text is pronounced correctly', async ({ page }) => {
    await openFresh(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  });
});

test.describe('the reduced-motion preference is respected', () => {
  test.use({ reducedMotion: 'reduce' });

  test('shortens the transitions when the system asks for less motion', async ({ page }) => {
    await openFresh(page);

    // REQ-UX-069: the system preference applies until the user states their
    // own.
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-motion', 'reduced');

    const duration = await page.evaluate(() => {
      const root = document.querySelector('.ag-theme-root');
      if (root === null) return '';
      return window.getComputedStyle(root).getPropertyValue('--ag-motion-moderate').trim();
    });

    // Reduced, not removed: the transition is what tells the user where a panel
    // went, so it is shortened rather than switched off.
    expect(duration).not.toBe('0ms');
    expect(parseInt(duration, 10)).toBeLessThan(240);
  });

  test('lets the user override it and ask for the full experience', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Accessibility' }).click();

    await page.getByRole('combobox', { name: 'Animation' }).click();
    await page.getByRole('option', { name: 'Full' }).click();

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-motion', 'full');
  });
});

/**
 * Why the system preferences are set after the page has loaded.
 *
 * Measured against the served build, on each engine, with `matchMedia` read in
 * the page: a colour scheme or a contrast set as a context option, or with
 * `page.emulateMedia` before the first navigation, reaches the document in
 * Chromium and WebKit and never reaches it in Firefox; the same set with
 * `page.emulateMedia` once the page has loaded reaches it in all three. So
 * Firefox is not skipped for the whole of the emulation, which would misread
 * that: the difference is in when a preference is set, and the reduced-motion
 * tests, set the same way, are the only ones it happens to spare. A preference
 * is set once the shell is running, and the shell is asked to follow it, which
 * is what it does when a user changes their system; the one test of what the
 * shell reads as it starts is the one that needs the context option.
 */
const FIREFOX_READS_NO_EMULATION_AT_START =
  'Firefox applies an emulated colour scheme or contrast only to a page that has already loaded.';

/**
 * Why the contrast tests do not run on Firefox.
 *
 * Measured: with only the contrast emulated, Firefox answers the query `true`
 * and does not tell a list the shell made earlier that it changed; the shell
 * learns it the next time another emulated preference changes and every query
 * is read again. The shell's listener is the one the colour-scheme tests pass
 * through on Firefox, so this is the emulation rather than the application.
 */
const FIREFOX_SENDS_NO_CONTRAST_CHANGE =
  'Firefox does not tell an existing media-query list that an emulated contrast changed.';

test.describe('what the system asks for reaches the page on every engine', () => {
  test('answers the media queries the shell reads from', async ({ page }) => {
    // The measurement above, kept executable: if an engine stops delivering the
    // emulation, this says so rather than every test after it failing for a
    // reason that is not the application's.
    await openFresh(page);
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });

    expect(
      await page.evaluate(() => ({
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        more: window.matchMedia('(prefers-contrast: more)').matches,
      })),
    ).toEqual({ dark: true, more: true });
  });
});

test.describe('the system colour scheme is followed in system mode', () => {
  /**
   * `resolveDarkness` is tested against hand-built values, and jsdom answers
   * `false` to every media query, so without these tests the code that produces
   * those values from the browser would be tested by nothing, and inverting the
   * query would leave the whole suite green. These tests emulate the two
   * answers and read what the shell resolved.
   */
  async function followTheSystem(page: Page): Promise<void> {
    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Follow the system theme' }).click();
  }

  test('resolves the dark theme when the system asks for dark', async ({ page }) => {
    await openFresh(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await followTheSystem(page);
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');

    await page.emulateMedia({ colorScheme: 'dark' });

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'dark');
  });

  test('resolves the light theme when the system asks for light', async ({ page }) => {
    // The shipped default is dark, so this is the answer that can only come
    // from the query: a shell that ignored the system would still be dark.
    await openFresh(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await followTheSystem(page);

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
  });

  test('keeps an explicit choice, because the user has answered the question', async ({ page }) => {
    // Every change of the system's answer the page hears, from before it
    // loads, kept on the page with the query it listens to.
    await page.addInitScript(() => {
      const light = matchMedia('(prefers-color-scheme: light)');
      const heard: boolean[] = [];
      Object.defineProperty(window, 'agSchemeChanges', { value: { light, heard } });
      light.addEventListener('change', () => {
        heard.push(light.matches);
      });
    });
    const system = async (): Promise<{ readonly dark: boolean; readonly heard: boolean[] }> =>
      await page.evaluate(() => {
        const recorded: unknown = Reflect.get(window, 'agSchemeChanges');
        if (
          typeof recorded !== 'object' ||
          recorded === null ||
          !('heard' in recorded) ||
          !Array.isArray(recorded.heard)
        ) {
          throw new Error('The page records no change of the colour scheme.');
        }
        const heard: readonly unknown[] = recorded.heard;
        return {
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          heard: heard.filter((matched): matched is boolean => typeof matched === 'boolean'),
        };
      });

    await openFresh(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await followTheSystem(page);
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the dark theme' }).click();
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'dark');

    // The system changes both ways after the choice, so a listener that wrote
    // the system's answer over it on a change would be caught. Each change is
    // made once the page has heard the one before, so an engine has no two to
    // take as one, and the theme is read two frames after the page heard the
    // last: by then a listener of the page's that heard it has run, and what
    // it did is drawn. The theme was already dark, so an assertion made before
    // a faulty listener ran would pass on the state the test set up.
    const before = await system();
    expect(before.dark, 'the system asks for dark before the test changes it').toBe(false);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(system, { message: 'the page does not hear the system change to dark' })
      .toEqual({ dark: true, heard: [...before.heard, false] });
    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(system, { message: 'the page does not hear the system change back to light' })
      .toEqual({ dark: false, heard: [...before.heard, false, true] });
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    });

    expect(await page.locator('.ag-theme-root').getAttribute('data-ag-theme')).toBe('dark');
  });
});

test.describe('the system contrast preference is respected', () => {
  test.skip(({ browserName }) => browserName === 'firefox', FIREFOX_SENDS_NO_CONTRAST_CHANGE);

  test('raises contrast when the system asks for more', async ({ page }) => {
    // Contrast follows the system until the user chooses, as motion does: a
    // system asking for more raises a user who has not chosen.
    await openFresh(page);
    await page.emulateMedia({ contrast: 'more' });

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-contrast', 'high');
  });

  test('lets the user turn high contrast off even so', async ({ page }) => {
    // Contrast used to move only upwards, so a user whose system asked for more
    // could not turn it off, and the switch that should have done it said it
    // was already off. The setting now says what following the system means.
    await openFresh(page);
    await page.emulateMedia({ contrast: 'more' });
    await openSettings(page);
    await page.getByRole('tab', { name: 'Accessibility' }).click();

    const contrast = page.getByRole('combobox', { name: 'Contrast' });
    await expect(contrast).toContainText('Follow the system (high now)');

    await contrast.click();
    await page.getByRole('option', { name: 'Standard' }).click();

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-contrast', 'standard');
  });

  test(
    'has no automatically detectable violation while the system asks for more',
    { tag: '@scale' },
    async ({ page }) => {
      await openFresh(page);
      await page.emulateMedia({ contrast: 'more' });
      await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-contrast', 'high');

      expect(await audit(page)).toEqual([]);
    },
  );

  test('leaves contrast standard when the system asks for nothing', async ({ page }) => {
    // The control for the tests above. Without it, a wiring that returned
    // `true` unconditionally would pass; the emulation is shown to have
    // arrived, so this cannot pass because nothing reached the page.
    await openFresh(page);
    await page.emulateMedia({ contrast: 'more' });
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-contrast', 'high');

    await page.emulateMedia({ contrast: 'no-preference' });

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-contrast', 'standard');
  });
});

test.describe('the system is read as AudioGubbins starts', () => {
  test.skip(({ browserName }) => browserName === 'firefox', FIREFOX_READS_NO_EMULATION_AT_START);

  test.use({ colorScheme: 'light', contrast: 'more' });

  test('comes back in the system theme and contrast after a reload', async ({ page }) => {
    // Every test above changes the system while the shell runs. This is the
    // other path: the answer the shell reads before anything has changed.
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Follow the system theme' }).click();

    await page.reload();

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-contrast', 'high');
  });
});
