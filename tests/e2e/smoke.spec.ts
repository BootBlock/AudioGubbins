import { readFile } from 'node:fs/promises';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  dock,
  floatingPanel,
  groupShowing,
  groupWithTab,
  splitters,
  tabWithin,
  workspaceSurface,
} from './dock.js';
import { OperatingSystem } from '@audiogubbins/capabilities';
import { KeyboardConvention } from '@audiogubbins/commands';

import { buildPresets, PanelKinds } from '../../packages/workspace/src/presets.js';
import { listedName } from '../../packages/workspace/src/workspace-name.js';
import { seenOf } from './dialogue.js';

import {
  conventionOf,
  openPalette,
  openSettings,
  pressPrefix,
  pressPrimary,
  settleCommandLayer,
  writtenPress,
} from './platform.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * The application starts, and its shell works.
 *
 * The Phase 01 acceptance criteria this covers: the application starts through
 * Vite and the production build succeeds with no backend; the themes, accent,
 * brightness, density and motion settings work; dock layouts save and restore;
 * every meaningful shell action goes through the command registry; and no
 * diagnostic transmission exists.
 *
 * Everything here drives the real application in a real browser. Where a test
 * asserts on a CSS custom property it is reading what the browser resolved, not
 * what a function returned, which is the difference between this suite and the
 * unit tests.
 */

/**
 * The element the theme writes its state onto.
 *
 * Not `.ag-app`: the provider owns its own root, and the application sits
 * inside it and carries none of the theme's state, so an assertion on the
 * application element would fail, as a stylesheet rule selecting it on the
 * state would match nothing.
 */
function themeRoot(page: Page) {
  return page.locator('.ag-theme-root');
}

/**
 * Waits for the page to draw a few frames.
 *
 * The dock reports what it drew a frame after the engine lays it out, and the
 * engine lays out a frame after the page is resized, so an assertion made
 * straight after a resize can pass before the report it is about arrives.
 */
async function afterFrames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let frame = 0; frame < frames; frame += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
  }, count);
}

/** The value the browser resolved for a theme token. */
async function tokenValue(page: Page, property: string): Promise<string> {
  return await page.evaluate((name) => {
    const root = document.querySelector('.ag-theme-root');
    if (root === null) return '';
    return window.getComputedStyle(root).getPropertyValue(name).trim();
  }, property);
}

/**
 * How a button is drawn, beside how an unavailable button is drawn: its text,
 * its border and its surface, each as the browser resolved it and as the
 * disabled look's own tokens resolve.
 */
async function drawnAgainstUnavailable(button: Locator): Promise<{
  readonly colour: readonly [string, string];
  readonly border: readonly [string, string];
  readonly surface: readonly [string, string];
}> {
  return await button.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.color = 'var(--ag-chrome-text-disabled)';
    probe.style.borderColor = 'var(--ag-chrome-border-default)';
    probe.style.backgroundColor = 'var(--ag-chrome-surface-raised)';
    element.parentElement?.append(probe);
    const expected = window.getComputedStyle(probe);
    const answer = {
      colour: [style.color, expected.color] as const,
      border: [style.borderTopColor, expected.borderTopColor] as const,
      surface: [style.backgroundColor, expected.backgroundColor] as const,
    };
    probe.remove();
    return answer;
  });
}

test.describe('starting up', () => {
  test('starts and shows the shell', async ({ page }) => {
    await openFresh(page);

    await expect(page).toHaveTitle('AudioGubbins');
    await expect(page.getByText('AudioGubbins', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  });

  test('needs no backend, so nothing is requested from anywhere else', async ({ page }) => {
    // REQ-ARCH-004.1 and REQ-PRIV-161: the editing is local, and nothing is
    // transmitted. Anything the page asks for must come from its own origin.
    const external: string[] = [];

    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:4173' && url.protocol !== 'data:') {
        external.push(request.url());
      }
    });

    await openFresh(page);
    await page.waitForLoadState('networkidle');

    expect(external).toEqual([]);
  });

  test('reports no error in the console', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await openFresh(page);
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });

  test('reports no error when reloaded while it is still starting', async ({ page }) => {
    // Firefox logged an InvalidStateError, with no stack and no error event in
    // the page, when the shell was reloaded within moments of starting. An
    // earlier bisection ruled out the application's code, the docking engine,
    // the graphics probe and the stylesheet, and claimed to be complete; it had
    // never disabled the service worker. Measured since: with the worker, five
    // reloads in five within 80 milliseconds of starting logged the error, and
    // without it none in ten did. The production build ships no worker.
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await page.reload();
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });

  test('starts in the dark theme, as REQ-UX-070 requires', async ({ page }) => {
    await openFresh(page);
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'dark');
  });

  test('offers the workspace with every panel of the preset', async ({ page }) => {
    await openFresh(page);

    // The Editing preset, which is what a new user starts in. It has four
    // panels and this asserted two of them, so the evidence cited it for the
    // inspector (REQ-EDIT-072) while no test anywhere mentioned the inspector.
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Editor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inspector' })).toBeVisible();

    // The transport is the tab the bottom group opens on.
    await expect(page.getByRole('tab', { name: 'Transport' })).toBeVisible();
  });

  test('says what each panel is for and which phase brings it', async ({ page }) => {
    // REQ-EXEC-136.9 forbids a placeholder that pretends to work, and
    // REQ-UX-060 is evidenced by what these panels say. Were nothing to read
    // the text, emptying it would break no test.
    await openFresh(page);

    // The panel itself, not the dock group around it: the engine gives its
    // group the same role and the same name as the panel it holds.
    const panel = (title: string) =>
      page.locator('section.ag-panel', {
        has: page.getByRole('heading', { name: title, exact: true }),
      });

    await expect(panel('Inspector')).toContainText(
      'The properties of whatever you have selected, editable in place.',
    );
    await expect(panel('Inspector')).toContainText('Arrives with core non-destructive editing.');
    await expect(panel('Assets')).toContainText('Arrives with the project and storage system.');
  });

  test('says what the browser cannot do rather than failing quietly', async ({ page }) => {
    // REQ-EXEC-216: a capability-sensitive assumption carries explicit
    // behaviour. The status bar said "0 capabilities unavailable" on a browser
    // with everything, which matched a regular expression and told the user
    // nothing, so this asserts what a reader is shown in each case: the surface
    // that explains them is always reachable from the Workspace menu.
    //
    // A capability is taken away before the application starts, so there is
    // always one to report and the assertion cannot fall into a branch that
    // checks nothing: without it, this test would assert an absence on any
    // browser that happened to have everything. The wording for none, one and
    // several is held by the status bar's own unit tests, where each case can
    // be set.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'OffscreenCanvas');
    });
    await openFresh(page);

    const item = page.locator('.ag-status-item', { hasText: /capabilit/ });
    await expect(item).toHaveText(/^(One capability is|[0-9]+ capabilities are) unavailable$/);

    await page.getByRole('button', { name: 'Show the Capabilities panel' }).click();
    await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible();
  });

  test('keeps the capability surface reachable from the Workspace menu', async ({ page }) => {
    // REQ-EXEC-216 requires an unsupported capability to be explained rather
    // than silently ignored. The panel that explains it is in no preset, and
    // before a command opened it, on Firefox and Safari the real absences had
    // a stated reason nobody could read.
    await openFresh(page);

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Capabilities', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible();
  });
});

test.describe('the menus, by pointer', () => {
  // What the unit tests cannot settle. Under jsdom only the first click on a
  // menu trigger per file opens anything; in a real browser it works every
  // time, and these tests prove it.

  test('opens a second menu by clicking it, after the first', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await expect(page.getByRole('menuitem', { name: 'Use the light theme' })).toBeVisible();
    await page.keyboard.press('Escape');

    await menuBarMenu(page, 'Help').click();
    await expect(page.getByRole('menuitem', { name: 'Start diagnostic mode' })).toBeVisible();
  });

  test('runs the command the entry names', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();

    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
  });

  test('shows a shortcut beside the entry that has one', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'View').click();

    // The palette sits behind the chord prefix, because Firefox keeps
    // Ctrl+Shift+P for its own private window.
    const prefix = await writtenPress(page, 'KeyK');
    await expect(page.getByRole('menuitem', { name: /Show the command palette/ })).toContainText(
      `${prefix}, ${await writtenPress(page, 'KeyP')}`,
    );
  });

  test('writes a shortcut in what the keyboard types, in the menu and in the palette', async ({
    page,
  }) => {
    // On Dvorak the key at V types K and the key at R types P, which the
    // browser's layout map says. Written at the keys' US names, the palette's
    // own shortcut read V and R.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'keyboard', {
        configurable: true,
        value: {
          getLayoutMap: async () =>
            await Promise.resolve(
              new Map([
                ['KeyK', 't'],
                ['KeyV', 'k'],
                ['KeyR', 'p'],
              ]),
            ),
        },
      });
    });
    await openFresh(page);
    // Apple hardware reads a Command press by one of two layers, and a default
    // whose character sits away from its US key waits until a press says
    // which. This layout puts `k` on the key at V, so it does. Settled to the
    // reading this map describes: a keyboard that types its own characters
    // under Command.
    await settleCommandLayer(page, { code: 'KeyV', types: 'k' });
    const written = `${await writtenPress(page, 'KeyK')}, ${await writtenPress(page, 'KeyP')}`;

    await menuBarMenu(page, 'View').click();
    const entry = page.getByRole('menuitem', { name: /Show the command palette/ });
    await expect(entry).toContainText(written);

    // The palette does not list itself, so another entry behind the prefix.
    await entry.click();
    await expect(page.getByRole('option', { name: /^Close this panel/ })).toContainText(
      `${await writtenPress(page, 'KeyK')}, ${await writtenPress(page, 'KeyX')}`,
    );
    await page.keyboard.press('Escape');

    // And the reading the press settled, which the written form cannot show:
    // both answers write this shortcut the same way and put it on different
    // keys. Pressed through the automation protocol, the settling press
    // carried the US character and the application read a keyboard that
    // switches under Command — the opposite of the map stubbed above — so
    // every assertion here was made against the US reading.
    const stored = async () =>
      await page.evaluate(() => window.localStorage.getItem('audiogubbins.keyboard-layout') ?? '');

    // A trusted key event, injected through the automation protocol into the
    // engine's input pipeline rather than dispatched by the test, and one
    // whose effect can be seen: the key that types `g` is in no map stubbed
    // above, so the layout holding it afterwards is the engine delivering a
    // key event to the listener and the listener writing what it read. A
    // dispatched event shows only that the application listens to a name; an
    // assertion that an already-written value is unchanged shows nothing at
    // all, since it holds just as well if no press ever arrives.
    expect(await stored()).not.toContain('KeyG');
    await page.keyboard.press('KeyG');
    await expect.poll(stored).toContain('"KeyG"');

    // Only where the question exists: away from Apple hardware there is no
    // Command layer, the settling press does nothing, and the reading stays
    // unasked.
    if ((await conventionOf(page)) === KeyboardConvention.Apple) {
      // And a Command press on a key this layout knows nothing of leaves the
      // settled reading where it is, because no reading is taken from a press
      // whose key types a character the layout has not shown. The press is
      // counted as it reaches the page first: a reading left unchanged is the
      // same whether the press was read and set aside or never arrived.
      await page.evaluate(() => {
        const root = document.documentElement;
        root.dataset['commandPresses'] = '0';
        window.addEventListener(
          'keydown',
          (event) => {
            if (event.metaKey && event.code === 'KeyA') {
              root.dataset['commandPresses'] = String(Number(root.dataset['commandPresses']) + 1);
            }
          },
          { capture: true },
        );
      });
      await page.keyboard.press('Meta+KeyA');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset['commandPresses']))
        .toBe('1');
      expect(await stored()).toContain('"commandByPosition":false');
    }
  });

  test('closes on Escape without running anything', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('menuitem', { name: 'Use the light theme' })).toBeHidden();
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'dark');
  });
});

test.describe('the theme actually changes what is drawn', () => {
  test('applies the light colour scheme the stylesheet asks for', async ({ page }) => {
    // The assertion that matters, and the one that caught a real defect: the
    // theme's state attributes were written onto the provider's root while the
    // stylesheet selected the application element, so this rule never matched.
    // Asserting on the attribute alone would have passed throughout.
    await openFresh(page);

    const scheme = async (): Promise<string> =>
      await page.evaluate(
        () => window.getComputedStyle(document.querySelector('.ag-app')!).colorScheme,
      );

    expect(await scheme()).toBe('dark');

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();

    // Polled: the click resolves when it is dispatched, before the theme it
    // runs has been drawn.
    await expect.poll(scheme).toBe('light');
  });

  test('repaints the surfaces when the theme changes', async ({ page }) => {
    await openFresh(page);
    const dark = await tokenValue(page, '--ag-chrome-surface-base');

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');

    const light = await tokenValue(page, '--ag-chrome-surface-base');

    expect(dark).not.toBe('');
    expect(light).not.toBe(dark);
  });

  test('changes the surfaces when the interface is brightened', async ({ page }) => {
    await openFresh(page);
    const before = await tokenValue(page, '--ag-chrome-surface-base');

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Brighten the interface' }).click();

    // Polled: no attribute names the brightness, so the surface itself is
    // waited for, and the click resolves before it is drawn.
    await expect
      .poll(async () => await tokenValue(page, '--ag-chrome-surface-base'))
      .not.toBe(before);
  });

  test('changes the spacing when the density changes', async ({ page }) => {
    await openFresh(page);
    const comfortable = await tokenValue(page, '--ag-space-medium');

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();
    await expect(themeRoot(page)).toHaveAttribute('data-ag-density', 'compact');

    const compact = await tokenValue(page, '--ag-space-medium');

    expect(compact).not.toBe(comfortable);
    expect(parseInt(compact, 10)).toBeLessThan(parseInt(comfortable, 10));
  });

  test('keeps the touch target the same size in both densities', async ({ page }) => {
    // REQ-UX-067: a user who chose a dense workspace on a tablet has not asked
    // for controls they cannot hit.
    await openFresh(page);
    const comfortable = await tokenValue(page, '--ag-control-minimum-touch-target');

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();
    // Read once the density is in force: read before, it holds as well of a
    // target that shrinks.
    await expect(themeRoot(page)).toHaveAttribute('data-ag-density', 'compact');

    expect(await tokenValue(page, '--ag-control-minimum-touch-target')).toBe(comfortable);
  });

  test('remembers the theme across a reload', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');

    await page.reload();

    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
  });
});

test.describe('the command palette', () => {
  test(
    'keeps the highlighted command on screen while the keyboard moves it',
    { tag: '@scale' },
    async ({ page }) => {
      // The list is a fixed scroll box and the highlight is moved with
      // `aria-activedescendant`, which no browser scrolls for. A sighted
      // keyboard user arrowing down the list watched the highlight leave the
      // box and then pressed Enter on a command that was not on screen.
      await openFresh(page);
      await openPalette(page);

      const options = page.getByRole('option');
      const count = await options.count();
      expect(count).toBeGreaterThan(12);

      // Up from the first result wraps to the last, which is as far below the
      // box as the list goes.
      await page.keyboard.press('ArrowUp');

      const last = options.nth(count - 1);
      await expect(last).toHaveAttribute('aria-selected', 'true');

      const inside = await last.evaluate((option) => {
        const list = option.parentElement;
        if (list === null) return false;

        const row = option.getBoundingClientRect();
        const box = list.getBoundingClientRect();
        return row.top >= box.top - 1 && row.bottom <= box.bottom + 1;
      });
      expect(inside, 'the highlighted command is scrolled out of the list').toBe(true);

      await pressPrimary(page, 'Home');
      await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    },
  );

  test('leaves Home and End to the search field, and reaches the ends with the modifier', async ({
    page,
  }) => {
    // Home and End moved the list whatever was typed, so a user mending the
    // start of what they had typed watched the list jump and the caret stay.
    await openFresh(page);
    await openPalette(page);

    const field = page.getByRole('combobox', { name: 'Search commands' });
    await page.keyboard.type('panel');
    await page.keyboard.press('Home');

    expect(await field.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(0);
    const options = page.getByRole('option');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');

    // With Shift the modifier selects to the end of the field, which is the
    // field's: the list jumped and the text stayed unselected.
    await pressPrimary(page, 'Shift+End');
    expect(await field.evaluate((input: HTMLInputElement) => input.selectionEnd)).toBe(5);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');

    await pressPrimary(page, 'End');
    await expect(options.last()).toHaveAttribute('aria-selected', 'true');
  });

  test('says how many commands match, in words that agree with the number', async ({ page }) => {
    await openFresh(page);
    await openPalette(page);
    await page.keyboard.type('Use the light theme');

    await expect(page.getByText('One command matches.')).toBeAttached();
  });

  test('opens from its shortcut', async ({ page }) => {
    await openFresh(page);

    await openPalette(page);

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();
  });

  test('finds a command by typing part of its name', async ({ page }) => {
    await openFresh(page);
    await openPalette(page);

    await page.getByRole('combobox').fill('light');

    await expect(page.getByRole('option', { name: /Use the light theme/ })).toBeVisible();
  });

  test('runs the highlighted command on Enter', async ({ page }) => {
    await openFresh(page);
    await openPalette(page);

    await page.getByRole('combobox').fill('Use the light theme');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeHidden();
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
  });

  test('offers an unavailable command with its reason rather than hiding it', async ({ page }) => {
    await openFresh(page);
    await openPalette(page);

    // Blue is already the accent, so its command cannot run.
    await page.getByRole('combobox').fill('Accent colour: Blue');

    const option = page.getByRole('option').first();
    await expect(option).toContainText('already in use');
    await expect(option).toHaveAttribute('aria-disabled', 'true');
  });

  test('runs the command a pressed row names, and closes with it', async ({ page }) => {
    // The press on a row is refused, so that focus stays in the search field,
    // and the command runs on the click that follows. Whether a click follows a
    // refused press is the engine's decision, and this is the only pointer
    // route to a command that is on no menu.
    await openFresh(page);
    await openPalette(page);

    await page.getByRole('combobox').fill('Use the light theme');
    await page.getByRole('option', { name: /Use the light theme/ }).click();

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeHidden();
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
  });

  test('starts from an empty query each time it opens', async ({ page }) => {
    await openFresh(page);

    await openPalette(page);
    await page.getByRole('combobox').fill('light');
    await page.keyboard.press('Escape');

    await openPalette(page);

    await expect(page.getByRole('combobox')).toHaveValue('');
  });
});

test.describe('the settings dialogue', () => {
  test('opens from its shortcut and shows its sections', async ({ page }) => {
    await openFresh(page);

    await openSettings(page);

    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Accessibility' })).toBeVisible();
  });

  test('changes the theme from its control', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);

    await page.getByRole('combobox', { name: 'Theme' }).click();
    await page.getByRole('option', { name: 'Light' }).click();

    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
  });

  test('turns high contrast on from the accessibility section', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);

    await page.getByRole('tab', { name: 'Accessibility' }).click();
    await page.getByRole('combobox', { name: 'Contrast' }).click();
    await page.getByRole('option', { name: /^High/ }).click();

    await expect(themeRoot(page)).toHaveAttribute('data-ag-contrast', 'high');
  });

  test('paints the document itself in the theme, not only the application', async ({ page }) => {
    // The page's pre-paint colours pinned the document to the dark theme for
    // good, and `color-scheme` never reached the root, so in the light theme
    // the page behind the shell stayed dark and the scrollbars stayed dark.
    await openFresh(page);
    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');

    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'light',
    );
    expect(
      await page.evaluate(
        () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
      ),
    ).not.toBe('#0f1318');

    // Compared at once: neither surface has a transition, and the theme is
    // written onto the document in the commit that wrote the attribute above.
    const surfaces = await page.evaluate(() => {
      const shell = document.querySelector('.ag-workspace');
      if (shell === null) throw new Error('The shell has no workspace.');
      return {
        document: getComputedStyle(document.body).backgroundColor,
        shell: getComputedStyle(shell).backgroundColor,
      };
    });
    expect(surfaces.document).toBe(surfaces.shell);
  });

  test(
    'never draws a control a mouse cannot hit, even in compact density',
    { tag: '@scale' },
    async ({ page }) => {
      // WCAG 2.5.8 sets 24 pixels as the least a target may be. Compact density
      // drew menu entries and the menus along the top at 22.
      await openFresh(page);
      await menuBarMenu(page, 'View').click();
      await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();

      await menuBarMenu(page, 'View').click();
      const heights = await page
        .locator('[role="menubar"] [role="menuitem"], [role="menu"] [role="menuitem"]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().height),
        );

      // To a thousandth of a pixel, which is the error of a float and nothing a
      // layout draws: where a CSS pixel is a fraction of the display's,
      // Chromium reads a box laid out at 24 pixels as 23.99999237. The finest
      // unit an engine lays a box out in is a sixty-fourth of a pixel, so a box
      // a unit short still fails.
      const floatError = 0.001;
      expect(heights.length).toBeGreaterThan(5);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(24 - floatError);
    },
  );

  test('says plainly that nothing is transmitted', async ({ page }) => {
    // REQ-PRIV-161 and REQ-PRIV-162: the user is told, in the place they would
    // look for it.
    await openFresh(page);
    await openSettings(page);

    await page.getByRole('tab', { name: 'Diagnostics' }).click();

    await expect(page.getByText(/nothing is ever sent anywhere/)).toBeVisible();
    await expect(page.getByText(/no usage analytics/)).toBeVisible();
  });
});

test.describe('the brightness slider', () => {
  test('sets the value it is moved to, not one step towards it', async ({ page }) => {
    // The slider ran whichever of the two stepping commands matched the
    // direction, so End moved the value one step and the thumb sprang back.
    await openFresh(page);
    await openSettings(page);

    const slider = page.getByRole('slider', { name: 'Brightness' });
    await slider.focus();
    await page.keyboard.press('End');

    await expect(slider).toHaveAttribute(
      'aria-valuenow',
      (await slider.getAttribute('aria-valuemax')) ?? '',
    );
  });
});

test.describe('keyboard shortcuts and chords', () => {
  test('runs a chord', async ({ page }) => {
    await openFresh(page);

    // The primary modifier with K is the prefix; with B it completes the
    // light-theme chord.
    await pressPrefix(page);
    await pressPrimary(page, 'KeyB');

    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
  });

  test('shows that a chord is waiting', async ({ page }) => {
    await openFresh(page);

    await pressPrefix(page);

    // A user who has pressed the prefix needs to see that something is waiting,
    // or the next key will seem to do nothing (REQ-UX-066).
    await expect(page.getByText(`${await writtenPress(page, 'KeyK')} …`)).toBeVisible();

    // And to hear it: the status bar is not a live region, and the command
    // palette itself is behind the prefix.
    await expect(
      page.locator('.ag-live-regions [role="status"]', {
        hasText: `${await writtenPress(page, 'KeyK')} pressed. Waiting for the next key.`,
      }),
    ).toHaveCount(1);

    // Said and not shown: the status bar shows it, and as a notice it stood
    // over the command palette the chord had just opened.
    await expect(page.locator('.ag-notice')).toHaveCount(0);
  });

  test('abandons a chord on Escape', async ({ page }) => {
    await openFresh(page);

    await pressPrefix(page);
    await page.keyboard.press('Escape');

    // Said, as the prefix was, so a screen-reader user who heard the chord
    // waiting hears it end.
    await expect(
      page.locator('.ag-live-regions [role="status"]', { hasText: 'The shortcut is cancelled.' }),
    ).toHaveCount(1);
    // Said and not shown, as the waiting chord was: the status bar showed that,
    // and a notice stood over the page for its end.
    await expect(page.locator('.ag-notice')).toHaveCount(0);

    await pressPrimary(page, 'KeyB');

    // The second press must not complete the chord the user abandoned.
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'dark');
  });

  test('lets a key through when it is not bound', async ({ page }) => {
    await openFresh(page);
    await openPalette(page);

    // Typed a key at a time, so each press reaches the shortcut handler first.
    // A value filled in sends no key at all, and would pass with every key
    // swallowed.
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('abc');

    await expect(page.getByRole('combobox')).toHaveValue('abc');
  });
});

test.describe('what the shipped defaults are written as', () => {
  /**
   * Four commands' written shortcuts, per convention, on a keyboard nothing is
   * known of.
   *
   * Written out, which is the point: everything else in this suite derives the
   * press it makes from `default-shortcuts.ts`, so the suite and the
   * application cannot disagree in either direction, and a default moved onto
   * a combination a browser eats would be pressed by every test here and pass.
   * A fixed list cannot drift silently — a change to the profile fails this
   * and has to be looked at — and four entries is short enough to read.
   */
  const WRITTEN = {
    [KeyboardConvention.Windows]: {
      'Show the command palette': 'Ctrl+K, Ctrl+P',
      Settings: 'Ctrl+,',
      'Brighten the interface': 'Ctrl+K, Ctrl+Up',
      'Use the dark theme': 'Ctrl+K, Ctrl+D',
    },
    [KeyboardConvention.Linux]: {
      'Show the command palette': 'Ctrl+K, Ctrl+P',
      Settings: 'Ctrl+,',
      'Brighten the interface': 'Ctrl+K, Ctrl+Up',
      'Use the dark theme': 'Ctrl+K, Ctrl+D',
    },
    [KeyboardConvention.Apple]: {
      'Show the command palette': '\u2318K, \u2318P',
      Settings: '\u21e7\u2318,',
      'Brighten the interface': '\u2318K, \u2318Up',
      'Use the dark theme': '\u2318K, \u2318D',
    },
  } as const;

  test('writes each of four defaults the way this table says', async ({ page }) => {
    await openFresh(page);
    const expected = WRITTEN[await conventionOf(page)];

    await openPalette(page);
    for (const [label, written] of Object.entries(expected)) {
      await page.getByRole('combobox').fill(label);
      await expect(page.getByRole('option').first()).toContainText(written);
    }
  });
});

test.describe('what the shipped document says', () => {
  test('carries a no-referrer policy in the shipped document', async ({ page }) => {
    // A static host sends no `Referrer-Policy` header, so the document has to
    // carry the policy itself. Without it, the default tells any origin a link
    // leads to which page of AudioGubbins the reader came from. The one link
    // the application draws is the way out of a hostile frame, which is the
    // worst case to leak from.
    //
    // Named for what it reads. It reads the element out of the built page,
    // which is what the build could drop; it makes no navigation and reads no
    // request header, so what a browser does with the policy is not measured
    // here, and the name claims no more.
    await openFresh(page);

    expect(
      await page.evaluate(
        () => document.querySelector('meta[name="referrer"]')?.getAttribute('content') ?? '',
      ),
    ).toBe('no-referrer');
  });
});

test.describe('the size the text is drawn at', () => {
  test('asks a phone turned on its side to draw the text at the size it is given', async ({
    page,
  }) => {
    // Nothing set it, so Safari on an iPhone turned on its side could enlarge
    // the text past the sizes the density's rules draw a line and a control
    // for. Read with the theme taken off the document, so it holds on the
    // first frame, before the theme is applied.
    await openFresh(page);
    const read = await page.evaluate(() => {
      const root = document.documentElement;
      root.removeAttribute('data-ag-theme');
      const style = getComputedStyle(root);
      return ['text-size-adjust', '-webkit-text-size-adjust']
        .filter((property) => CSS.supports(property, '100%'))
        .map((property) => ({ property, value: style.getPropertyValue(property) }));
    });

    test.skip(
      read.length === 0,
      "This engine takes no percentage for the text's size adjustment: the WebKit here is the desktop build, which enlarges no text, and Firefox takes auto and none alone.",
    );
    for (const { property, value } of read) {
      expect(value, property).toBe('100%');
    }
  });
});

test.describe('the width a docking workspace needs', { tag: '@scale' }, () => {
  // Why, once, in `apps/web/src/shell/too-narrow.tsx`, which is where the
  // number the application draws is declared. Written out here as well, the
  // paragraph could go stale in either place with nothing noticing; the
  // number cannot, because a fast-tier rule holds all three statements of it
  // equal (REQ-UX-057.1).
  const DECLARED = 640;

  /**
   * The page's width as a media query reads it, to a thousandth of a pixel,
   * finer than the sixty-fourth of a pixel WebKit lays a page out in, which
   * reads a page 390 pixels wide at 390.015.
   */
  async function mediaWidth(page: Page): Promise<number> {
    return await page.evaluate(() => {
      let below = 0;
      let above = 10_000;
      while (above - below > 0.001) {
        const middle = (below + above) / 2;
        if (matchMedia(`(width < ${String(middle)}px)`).matches) above = middle;
        else below = middle;
      }
      return below;
    });
  }

  /**
   * Sets the viewport `viewport` pixels wide and says whether the page is then
   * at least `width` wide, as the application's media queries read it.
   */
  async function viewportReaches(page: Page, viewport: number, width: number): Promise<boolean> {
    await page.setViewportSize({ width: viewport, height: 720 });
    return await page.evaluate(
      (asked) => !matchMedia(`(width < ${String(asked)}px)`).matches,
      width,
    );
  }

  /**
   * Sets the narrowest viewport that gives the page at least `width`, as the
   * application's media queries read it, and answers that viewport.
   *
   * A viewport is not a page. Where a CSS pixel is a fraction of the display's,
   * the page's width is a fraction too, which `window.innerWidth` rounds and a
   * media query does not, and the widths the page can take step by more than a
   * pixel: Firefox at a text size of 110 per cent gives 389.58 and then 391.42,
   * and nothing between. So the viewport is stepped a pixel at a time to the
   * narrowest that reads at or above the width asked, as `(width < …)` reads
   * it. Where the page's widths are whole, that is the width asked, exactly.
   */
  async function viewportReaching(page: Page, width: number): Promise<number> {
    const reaches = async (viewport: number): Promise<boolean> =>
      await viewportReaches(page, viewport, width);

    // The first reading gives the engine's ratio of the viewport to the page.
    // After it, a pixel at a time: up to a viewport that reaches the width, and
    // down past every narrower one that reaches it as well.
    let viewport = width;
    if (!(await reaches(viewport))) {
      const measured = await mediaWidth(page);
      viewport += Math.max(1, Math.round((width - measured) * (viewport / measured)));
    }
    for (let step = 0; step < 8 && !(await reaches(viewport)); step += 1) viewport += 1;
    for (let step = 0; step < 8 && (await reaches(viewport - 1)); step += 1) viewport -= 1;
    expect(await reaches(viewport - 1), 'a narrower viewport reaches the width too').toBe(false);
    expect(await reaches(viewport), 'no viewport gives the page the width asked').toBe(true);
    return viewport;
  }

  /**
   * Gives the page the narrowest width it can take at or above `width`, as the
   * application's media queries read it (see `viewportReaching`), and answers
   * the width it took.
   */
  async function atCssWidth(page: Page, width: number): Promise<number> {
    await viewportReaching(page, width);
    return await mediaWidth(page);
  }

  /**
   * Gives the page the widest width it can take below the declared one, and
   * fails where it can take none, or where the viewport a pixel wider than the
   * one chosen leaves the page under the declared width as well.
   *
   * The viewport a pixel narrower than the narrowest that gives the page the
   * declared width, since the page's width grows with the viewport: under the
   * declared width by a pixel where the page's widths are whole, and by no
   * more than one of its steps where they are not, 1.83 pixels in Firefox at
   * a text size of 110 per cent. So the notice is read as close under the
   * declared width as the page can be, and a rule that fires only below some
   * lower width fails wherever the page can take a width between the two.
   */
  async function belowTheWidth(page: Page): Promise<void> {
    const reaching = await viewportReaching(page, DECLARED);
    const chosen = reaching - 1;
    expect(
      await viewportReaches(page, chosen + 1, DECLARED),
      'a viewport wider than the one chosen leaves the page under the declared width too',
    ).toBe(true);
    expect(
      await viewportReaches(page, chosen, DECLARED),
      'the page cannot take a width under the declared one',
    ).toBe(false);
  }

  test('draws the workspace at the width it declares, with nothing off the side', async ({
    page,
  }) => {
    await page.setViewportSize({ width: DECLARED, height: 720 });
    await openFresh(page);
    await atCssWidth(page, DECLARED);

    await expect(workspaceSurface(page)).toBeVisible();
    await expect(page.getByRole('note')).toBeHidden();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test('says how much room it needs below that width, and keeps the menus working', async ({
    page,
  }) => {
    await page.setViewportSize({ width: DECLARED - 1, height: 720 });
    await openFresh(page);
    await belowTheWidth(page);

    const notice = page.getByRole('note');
    await expect(notice).toBeVisible();
    // The message names the width the rule uses, so the two cannot drift, and
    // names it as page width: the rule fires on the width of the page, which a
    // high zoom shrinks while the window stays as it was.
    await expect(notice).toContainText(`${String(DECLARED)} pixels of page width`);

    // The dock is left mounted, and nothing in it is reachable while it cannot
    // be seen: widening the window brings the arrangement back untouched.
    await expect(dock(page)).toBeHidden();

    // Every command is still reachable: the chrome is not what runs out of
    // room.
    await expect(page.getByRole('menubar')).toBeVisible();
    await menuBarMenu(page, 'Workspace').click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Widened again, the workspace comes back.
    await atCssWidth(page, DECLARED);
    await expect(notice).toBeHidden();
    await expect(dock(page)).toBeVisible();
  });

  test('lays the settings out below that width, which the notice says still work', async ({
    page,
  }) => {
    // The notice states as a fact that the settings still work below the
    // declared width, and nothing opened them there. The tab list is a flex
    // row of five triggers, which is wider than the dialogue's content box at
    // a narrow viewport: with no wrap and no scroller it overflowed, and the
    // only thing that could scroll to the tab a reader wanted was the
    // dialogue, in both directions at once.
    await page.setViewportSize({ width: 320, height: 720 });
    await openFresh(page);
    await atCssWidth(page, 320);

    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();

    const tabs = page.getByRole('tab');
    expect(await tabs.count()).toBeGreaterThan(3);

    const room = await dialog.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(room.scrollWidth).toBeLessThanOrEqual(room.clientWidth + 1);

    // And every tab is on screen, rather than off the side of what scrolls.
    const box = await dialog.boundingBox();
    for (const tab of await tabs.all()) {
      const at = await tab.boundingBox();
      expect(at).not.toBeNull();
      expect(at?.x ?? 0).toBeGreaterThanOrEqual((box?.x ?? 0) - 1);
      expect((at?.x ?? 0) + (at?.width ?? 0)).toBeLessThanOrEqual(
        (box?.x ?? 0) + (box?.width ?? 0) + 1,
      );
    }

    // The widest tab panel, not the one the dialogue opens on. The shortcut
    // table carries a command, its keys and a button on one row, with the keys
    // column set not to wrap, and nothing had ever drawn it here.
    await page.getByRole('tab', { name: 'Shortcuts' }).click();
    await expect(page.getByRole('table', { name: 'Keyboard shortcuts' })).toBeVisible();
    // The dialogue's own box, and every control inside it: the profile select
    // is a flex item whose minimum was its content, so a long profile name
    // pushed its right edge past the dialogue at this width with the dialogue
    // itself reporting no overflow at all.
    const withTable = await dialog.evaluate((element) => {
      const edge = element.getBoundingClientRect().left + element.clientWidth;
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        past: [...element.querySelectorAll('*')]
          .filter((one) => one.getBoundingClientRect().right > edge + 1)
          .map((one) => `${one.tagName}.${one.className}`),
      };
    });
    expect(withTable.past).toEqual([]);
    expect(withTable.scrollWidth).toBeLessThanOrEqual(withTable.clientWidth + 1);

    await page.keyboard.press('Escape');
  });

  test('lays the command palette out below that width, which the notice says still works', async ({
    page,
  }) => {
    // The notice names three surfaces as still working below the declared
    // width, and the palette was the one nothing opened there. It is the only
    // pointer route to a command that is on no menu, and its rows carry a
    // label, a written shortcut and a reason side by side.
    await page.setViewportSize({ width: 320, height: 720 });
    await openFresh(page);
    await atCssWidth(page, 320);

    await openPalette(page);
    const dialog = page.getByRole('dialog', { name: 'Run a command' });
    await expect(dialog).toBeVisible();

    await page.getByRole('combobox', { name: 'Search commands' }).fill('light');
    const row = page.getByRole('option', { name: /Use the light theme/ });
    await expect(row).toBeVisible();

    // Inside the page as well as inside itself: a dialogue whose own content
    // fits can still be wider than the page it is drawn on, and a fixed,
    // centred box that is wider has no scroll position that brings its edges
    // back.
    const room = await dialog.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      page: document.documentElement.clientWidth,
    }));
    expect(room.scrollWidth).toBeLessThanOrEqual(room.clientWidth + 1);
    expect(room.left).toBeGreaterThanOrEqual(-1);
    expect(room.right).toBeLessThanOrEqual(room.page + 1);

    // And it runs what it names, which is what "still works" claims.
    await row.click();
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
  });

  test('keeps the whole shell inside the page at a phone width', async ({ page }) => {
    // The shell is one grid column, and an `auto` track cannot be narrower
    // than its items' min-content: the menu bar is a nowrap row of five
    // unbreakable items, so below about four hundred pixels the column grew
    // wider than the page and `overflow: hidden` cut the excess off with no
    // scroll position that brings it back. What was cut is the only thing the
    // application draws at that width — the right of every line of the notice,
    // the sentence that names the width among them, and the Commands button,
    // which is the chrome's one pointer route to the palette.
    //
    // Nothing could see it. The one document-overflow assertion is made at the
    // declared width, where the row fits, and it reads `scrollWidth`, which a
    // clipping ancestor keeps at the client width however much is cut; the
    // notice is measured against its own parent, and both are the overflowing
    // column; and the two tests at 320 read dialogues, which are fixed to the
    // viewport.
    //
    // Each is found by what it is, and one that is not there fails: read by a
    // selector, the Commands button was the last of the menu triggers, which
    // come before it, and an element the selector missed read as zero.
    for (const asked of [320, 360, 390]) {
      await page.setViewportSize({ width: asked, height: 720 });
      await openFresh(page);
      const width = await atCssWidth(page, asked);

      const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
      for (const [what, element] of [
        ['banner', page.getByRole('banner')],
        ['Commands button', page.getByRole('button', { name: 'Commands', exact: true })],
        ['notice', page.locator('.ag-too-narrow')],
        ['status bar', page.locator('.ag-status-bar')],
      ] as const) {
        // Visible first, so one that is not there fails by name and at once:
        // a box waits for its element until the test's own time runs out.
        await expect(element, `There is no ${what} at ${String(width)} px.`).toBeVisible();
        const box = await element.boundingBox();
        if (box === null) throw new Error(`There is no ${what} at ${String(width)} px.`);
        expect(Math.round(box.x + box.width), `${what} at ${String(width)} px`).toBeLessThanOrEqual(
          pageWidth,
        );
      }
    }
  });

  test('keeps the notice inside the workspace at a short viewport', async ({ page }) => {
    // `block-size: 100%` on a content-box element with padding makes its border
    // box taller than the area it sits in, and the shell is `overflow: hidden`,
    // so the foot of the notice was cut off. `justify-content: center` then put
    // the heading out of reach once the content was taller than the box: a
    // centred flex container overflows at the start edge, where no scroll
    // position brings it back.
    await page.setViewportSize({ width: 360, height: 720 });
    await openFresh(page);
    await atCssWidth(page, 360);
    // The height last: `atCssWidth` sets it to 720 as it settles the width, so
    // a height set before it is thrown away and the workspace is tall enough
    // for the notice to fit, which is the case this test is not about.
    await page.setViewportSize({ width: page.viewportSize()?.width ?? 360, height: 240 });

    const notice = page.getByRole('note');
    await expect(notice).toBeVisible();

    const fits = await notice.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const workspace = element.parentElement?.getBoundingClientRect();
      const heading = element.querySelector('.ag-too-narrow-heading')?.getBoundingClientRect();
      return {
        below: Math.round(box.bottom - (workspace?.bottom ?? 0)),
        headingAbove: Math.round((heading?.top ?? 0) - box.top),
        overflows: element.scrollHeight > element.clientHeight,
      };
    });

    // The notice really is taller than the room it has here. Without that the
    // two ways of centring behave alike and the assertion below reads nothing.
    expect(fits.overflows).toBe(true);
    expect(fits.below).toBeLessThanOrEqual(0);
    expect(fits.headingAbove).toBeGreaterThanOrEqual(0);
  });

  test('moves focus and says so when the window crosses the width', async ({ page }) => {
    // Every child of the workspace leaves the box tree at once, so the browser
    // drops focus to the document body. Nothing moved it and nothing said what
    // had happened, so a reader using the keyboard resumed from the top of the
    // document and a reader using a screen reader was told nothing at all.
    await openFresh(page);
    await atCssWidth(page, DECLARED);

    await page.getByRole('tab', { name: 'Assets', exact: true }).focus();

    await belowTheWidth(page);
    await expect(page.locator('.ag-too-narrow-heading')).toBeFocused();
    // Found by what it says, in the shell's own regions. The shell writes each
    // announcement into the one of two regions its sequence number picks, so
    // the last region holds it only while that number is odd: read by
    // position, this passed on the crossing being the first announcement of
    // the run and would have failed on any announcement made before it.
    await expect(
      page.locator('.ag-live-regions [aria-live="polite"]', { hasText: 'too narrow' }),
    ).toHaveCount(1);

    await atCssWidth(page, DECLARED);
    await expect(page.locator('.ag-workspace')).toBeFocused();
  });

  test('leaves focus in an open dialogue when the window crosses the width', async ({ page }) => {
    // Zooming the page is how a reader with low vision reads a dialogue, and
    // zooming a 1280-pixel window to 200 per cent crosses this width. Focus
    // was moved to the notice behind the dialogue, which the dialogue has told
    // assistive technology is not there, so the reader lost their place and
    // the focus scope pulled them back to the dialogue's own container.
    await openFresh(page);
    await atCssWidth(page, DECLARED);
    await openSettings(page);

    const tab = page.getByRole('tab', { name: 'Appearance' });
    await tab.focus();

    await belowTheWidth(page);

    // Still said, because the workspace behind the dialogue really has gone.
    await expect(
      page.locator('.ag-live-regions [aria-live="polite"]', { hasText: 'too narrow' }),
    ).toHaveCount(1);
    await expect(tab).toBeFocused();
  });

  test('has one heading above the panels, and above the notice below the width', async ({
    page,
  }) => {
    // The only `h1` was the one the failure boundary draws when everything has
    // stopped. Every panel titles itself with an `h2`, so a reader navigating
    // by heading started at the second level with nothing above it, and below
    // the declared width the document's whole structure was a single `h2`.
    await openFresh(page);

    const headings = page.getByRole('heading', { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText('AudioGubbins');

    // Inside the banner, which is the name it already showed. Written as a
    // heading of its own between the banner and the main region it belonged to
    // no landmark, so a reader moving by landmark passed from one to the other
    // without meeting it.
    await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveCount(1);

    await belowTheWidth(page);
    await expect(page.locator('.ag-too-narrow'), 'the notice is on screen').toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
});

test.describe('the workspace', () => {
  test('names the layout in the status bar', async ({ page }) => {
    await openFresh(page);
    await expect(page.locator('.ag-status-bar')).toContainText('Editing');
  });

  test('saves the arrangement as a new workspace', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Save this workspace as a new one' }).click();

    await expect(page.locator('.ag-status-bar')).toContainText('My workspace');
  });

  test(
    'offers no reset on a workspace as it ships, after the window is resized',
    { tag: '@scale' },
    async ({ page }) => {
      // Drawn again at another size, a workspace nobody has changed still
      // offers no reset that would change nothing anyone could see. The dock
      // does not report a change of window size; a choice of tab it does report
      // is held by the test after this one.
      await openFresh(page);
      await page.setViewportSize({ width: 1100, height: 700 });
      await afterFrames(page, 4);

      await menuBarMenu(page, 'Workspace').click();
      await expect(page.getByRole('menuitem', { name: /^Reset this workspace/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );

      // And again after a second resize, with the menu closed while it is
      // drawn.
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1300, height: 800 });
      await afterFrames(page, 4);

      await menuBarMenu(page, 'Workspace').click();
      await expect(page.getByRole('menuitem', { name: /^Reset this workspace/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    },
  );

  test(
    'offers no reset after a tab is chosen and the first chosen again',
    { tag: '@scale' },
    async ({ page }) => {
      // Each choice is reported. The second report is the workspace as it
      // ships, but read in pixels, with every tab's title and in the dock's own
      // order, it was taken for a change, and Reset was offered that changed
      // nothing.
      await openFresh(page);
      await page.getByRole('tab', { name: 'Assets' }).click();
      await afterFrames(page, 4);

      // The first choice is a change, so Reset is offered: the report arrived
      // and was stored. Reset is unavailable on a fresh start before any
      // report, so without this the test passed with tab choices never reported
      // at all.
      await menuBarMenu(page, 'Workspace').click();
      await expect(
        page.getByRole('menuitem', { name: /^Reset this workspace/ }),
      ).not.toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: 'Editor' }).click();
      await afterFrames(page, 4);

      await menuBarMenu(page, 'Workspace').click();
      await expect(page.getByRole('menuitem', { name: /^Reset this workspace/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    },
  );

  test(
    'offers no reset after the window is resized and a tab is chosen',
    { tag: '@scale' },
    async ({ page }) => {
      // The two halves of the read-back, together. A resize sends no report, so
      // the dock's idea of where it drew each group was taken at the mount and
      // never moved on; the next report, a tab chosen, then found every group
      // somewhere else and recorded a change nobody made.
      await openFresh(page);
      await page.setViewportSize({ width: 1100, height: 700 });
      await afterFrames(page, 4);

      await page.getByRole('tab', { name: 'Assets' }).click();
      await afterFrames(page, 4);
      await menuBarMenu(page, 'Workspace').click();
      await expect(
        page.getByRole('menuitem', { name: /^Reset this workspace/ }),
      ).not.toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: 'Editor' }).click();
      await afterFrames(page, 4);

      await menuBarMenu(page, 'Workspace').click();
      await expect(page.getByRole('menuitem', { name: /^Reset this workspace/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    },
  );

  test('restores the saved workspace after a reload', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Save this workspace as a new one' }).click();
    await expect(page.locator('.ag-status-bar')).toContainText('My workspace');

    await page.reload();

    await expect(page.locator('.ag-status-bar')).toContainText('My workspace');
  });

  test(
    'keeps every panel in its own region across a reload',
    { tag: '@scale' },
    async ({ page }) => {
      // What this covers is the mounting half of the round trip: a stored
      // layout with four regions comes back with its panels in those four
      // regions. The reading half, turning the engine's geometry back into
      // regions, is covered in `geometry.test.ts`, and end to end by the
      // rearranging tests below, which drive the engine's own splitters and
      // drags.
      await openFresh(page);

      const regionOf = async (name: string) => {
        const box = await page.getByRole('heading', { name, exact: true }).boundingBox();
        if (box === null) throw new Error(`${name} is not on screen.`);
        return box;
      };

      // A page opened fresh has stored nothing, and a reload of it would mount
      // the preset again and read nothing back. A layout is stored once the
      // dock reports one, which a tab chosen is, so the reload is waited for
      // until the stored layout holds a group in each region.
      const stored = async (): Promise<readonly string[]> =>
        await page.evaluate(() => {
          const text = localStorage.getItem('audiogubbins.workspace');
          if (text === null) return [];
          const layout: unknown = JSON.parse(text);
          const groups: unknown =
            typeof layout === 'object' && layout !== null ? Reflect.get(layout, 'groups') : [];
          return Array.isArray(groups)
            ? groups.map((group: unknown) =>
                typeof group === 'object' && group !== null
                  ? String(Reflect.get(group, 'region'))
                  : '',
              )
            : [];
        });
      expect(await stored()).toEqual([]);
      await page.getByRole('tab', { name: 'Assets', exact: true }).click();
      await expect
        .poll(async () => [...(await stored())].sort())
        .toEqual(['bottom', 'centre', 'left', 'right']);

      await page.reload();
      await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

      const assets = await regionOf('Assets');
      const editor = await regionOf('Editor');
      const inspector = await regionOf('Inspector');
      const transport = await regionOf('Transport');

      expect(assets.x, 'the asset browser is no longer left of the editor').toBeLessThan(editor.x);
      expect(inspector.x, 'the inspector is no longer right of the editor').toBeGreaterThan(
        editor.x,
      );
      expect(transport.y, 'the transport is no longer below the editor').toBeGreaterThan(editor.y);
    },
  );

  test('recovers from a damaged stored workspace without losing anything else', async ({
    page,
  }) => {
    // REQ-UX-059: the user loses their arrangement and keeps their work, and is
    // told rather than silently handed a different workspace.
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();

    await page.evaluate(() => {
      window.localStorage.setItem('audiogubbins.workspace', '{"schemaVersion":999}');
    });
    await page.reload();

    // The workspace fell back and said why.
    await expect(page.locator('.ag-status-bar')).toContainText('999');

    // The preference, which lives in its own partition, survived.
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
  });

  test('lets the user put the recovery notice away', async ({ page }) => {
    // The notice had no way to be dismissed, so it stayed in the status bar for
    // the rest of the session.
    await page.addInitScript(() => {
      window.localStorage.setItem('audiogubbins.workspace', '{"groups": [');
    });
    await openFresh(page);

    const statusBar = page.locator('.ag-status-bar');
    await expect(statusBar).toContainText('The stored workspace could not be read.');

    await statusBar
      .getByRole('button', { name: 'Dismiss the notice about the workspace on screen' })
      .click();

    await expect(statusBar).not.toContainText('The stored workspace could not be read.');
  });

  test(
    'keeps the status bar to a third of the screen, however many notices it holds',
    { tag: '@scale' },
    async ({ page }) => {
      // Wrapped notices grew the bar until the workspace above it had no height
      // at all, at a narrow width or a large zoom.
      await page.setViewportSize({ width: 320, height: 360 });
      await page.addInitScript(() => {
        window.localStorage.setItem('audiogubbins.workspace', '{"groups": [');
        window.localStorage.setItem('audiogubbins.workspaces', '{"layouts": [');
        Storage.prototype.setItem = () => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        };
      });
      await openFresh(page);

      const statusBar = page.locator('.ag-status-bar');
      await expect(statusBar).toContainText('The stored workspace could not be read.');
      await expect(statusBar).toContainText('The workspaces you saved could not be read, so');

      const measured = await statusBar.evaluate((bar) => ({
        height: bar.getBoundingClientRect().height,
        content: bar.scrollHeight,
        screen: window.innerHeight,
      }));

      // The notices need more than a third, so the cap is what holds the bar.
      expect(measured.content).toBeGreaterThan(measured.height);
      expect(measured.height).toBeLessThanOrEqual(measured.screen / 3 + 1);
    },
  );

  test(
    'draws the whole focus ring of a button in the status bar, which scrolls',
    { tag: '@scale' },
    async ({ page }) => {
      // A container that scrolls clips what reaches past its padding. The bar's
      // buttons filled its height, and the ring lost its top and bottom edges.
      await openFresh(page);
      const button = page.locator('.ag-status-bar button').first();
      await button.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();

      const ring = await seenOf(button, { ring: true });
      expect(ring.outline).toBe('solid');
      expect(ring.reach).toBeGreaterThan(3);
      expect(ring.cutBy, 'the ring is cut').toEqual([]);
    },
  );

  test('says so when the browser will not keep a change', async ({ page }) => {
    // Private browsing and a full quota make every write throw. Each store
    // logged that and said nothing, so the user found everything gone on their
    // next visit.
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      };
    });
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();

    // The change still took effect, and the user is told it will not last.
    await expect(themeRoot(page)).toHaveAttribute('data-ag-theme', 'light');
    await expect(page.locator('.ag-status-bar')).toContainText(
      'Not being saved: appearance settings',
    );
    // With why, and what makes room, since the quota was met (F-209).
    await expect(page.locator('.ag-notice')).toHaveText(
      "Your appearance settings could not be saved, so your changes will not survive a reload. The browser's storage for this site is full. Deleting workspaces or shortcut profiles you no longer need makes room, as does exporting and then discarding any text that could not be read, in the Workspaces and Shortcuts settings. AudioGubbins tries again with your next change.",
    );
  });
});

test.describe('the page enforces its own promises', () => {
  test('refuses a connection to any other origin, and says why', async ({ page }) => {
    // The local-first promise had no run-time enforcement: the architecture
    // rules read the source, and nothing stopped code the source does not
    // contain, such as a compromised dependency, from reaching anywhere at all.
    await openFresh(page);

    const refused = await page.evaluate(async () => {
      const violation = new Promise<string>((resolve) => {
        document.addEventListener(
          'securitypolicyviolation',
          (event) => {
            resolve(event.effectiveDirective);
          },
          { once: true },
        );
      });
      await fetch('https://audiogubbins.test/collect').catch(() => undefined);
      return await violation;
    });

    expect(refused).toBe('connect-src');
  });

  test('refuses nothing the application itself does', async ({ page }) => {
    // The policy is only worth having if it can stay switched on. The
    // dialogue's scroll lock inserts a style element, a menu positions itself
    // with inline styles, and the docking engine draws with data addresses;
    // each would be refused by a policy written without looking.
    await page.addInitScript(() => {
      const refused: string[] = [];
      Reflect.set(window, '__refused', refused);
      document.addEventListener('securitypolicyviolation', (event) => {
        refused.push(`${event.effectiveDirective} ${event.blockedURI}`);
      });
    });
    await openFresh(page);

    await openSettings(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await openPalette(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await menuBarMenu(page, 'View').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');

    expect(await page.evaluate(() => Reflect.get(window, '__refused') as unknown)).toEqual([]);
  });

  test('ships no service worker in the production build', async ({ page }) => {
    // A precaching worker shipped while its configuration called it
    // development-time, with an update mode nothing consumed, so a new release
    // would have waited behind an old one. Offline caching, and the update
    // prompt and stale-cache recovery it needs, belong to a later phase.
    const workerScripts: string[] = [];
    page.on('request', (request) => {
      if (/(sw|registerSW|workbox-[\w-]+)\.js$/.test(request.url())) {
        workerScripts.push(request.url());
      }
    });

    await openFresh(page);
    await page.waitForLoadState('networkidle');

    const registrations = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    );
    expect(registrations).toBe(0);
    expect(workerScripts).toEqual([]);
  });
});

test.describe('diagnostics stay on this machine', () => {
  test('records nothing to anywhere but memory while diagnostic mode runs', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4173')) external.push(request.url());
    });

    await openFresh(page);

    await menuBarMenu(page, 'Help').click();
    await page.getByRole('menuitem', { name: 'Start diagnostic mode' }).click();

    await expect(page.locator('.ag-status-bar')).toContainText('Diagnostic mode');
    await page.waitForLoadState('networkidle');

    expect(external).toEqual([]);
  });

  test('tells the user it stays local, on both channels', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'Help').click();
    await page.getByRole('menuitem', { name: 'Start diagnostic mode' }).click();

    // Said to a screen reader and shown to everyone else. The sentence used to
    // reach only the live region, so a sighted user turning diagnostic mode on
    // was told nothing about where the detail goes.
    await expect(
      page.locator('.ag-live-regions [role="status"]', { hasText: /this machine only/ }),
    ).toHaveCount(1);
    await expect(page.locator('.ag-notice')).toContainText(/this machine only/);
  });
});

test.describe('every workspace preset can be reached', () => {
  /**
   * REQ-UX-058 names six presets and states with `shall` that users can switch
   * rapidly between layouts, so the Workspace menu offers every one. With only
   * save-as and reset, five of the six could never be loaded, and after one
   * save-as the reset command would refuse and advise deleting a workspace no
   * command could delete.
   */

  /** The presets as the application builds them, which has every panel kind. */
  const PRESETS = buildPresets(new Set(Object.values(PanelKinds)));

  /**
   * A preset as the Workspace menu names it: marked as built in, by the rule
   * the menu and the settings list a workspace by, so the suite follows the
   * application's wording rather than keeping a copy of it.
   */
  function listedPreset(displayName: string): string {
    const preset = PRESETS.find((one) => one.displayName === displayName);
    if (preset === undefined) throw new Error(`No preset is called ${displayName}.`);
    return listedName(preset);
  }

  /** An accessible name that starts with `text`, read as it is written. */
  function startingWith(text: string): RegExp {
    return new RegExp(`^${text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')}`);
  }

  test('lists every workspace in the Workspace menu, each preset marked as built in', async ({
    page,
  }) => {
    await openFresh(page);
    await menuBarMenu(page, 'Workspace').click();

    // Matched by prefix rather than exactly, because an entry that cannot be
    // chosen carries its reason as part of its accessible name: the workspace
    // already in use reads its name followed by why. No entry is the bare name,
    // which is what a workspace the user saved under it would read.
    for (const name of [
      'Editing',
      'Spectral Repair',
      'Recording',
      'Game Audio',
      'Batch Processing',
      'Multitrack',
    ]) {
      await expect(
        page.getByRole('menuitem', { name: startingWith(listedPreset(name)) }),
      ).toBeVisible();
      await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
    }
  });

  test('switches to a preset the menu names', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: listedPreset('Recording'), exact: true }).click();

    await expect(page.locator('.ag-status-bar')).toContainText('Recording');
  });

  test('says why the workspace already in use cannot be chosen', async ({ page }) => {
    await openFresh(page);
    await menuBarMenu(page, 'Workspace').click();

    await expect(
      page.getByRole('menuitem', { name: startingWith(listedPreset('Editing')) }),
    ).toContainText('already in use');
  });

  test('gets back to a preset after the user has saved one of their own', async ({ page }) => {
    // The trap: Reset refused because the layout was no longer built-in, and
    // there was no way to delete it or to load any other preset.
    await openFresh(page);

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Save this workspace as a new one' }).click();
    await expect(page.locator('.ag-status-bar')).toContainText('My workspace');

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: listedPreset('Game Audio'), exact: true }).click();

    await expect(page.locator('.ag-status-bar')).toContainText('Game Audio');
  });
});

test.describe('a panel the user closed can be opened again', () => {
  test('opens the diagnostic log, which one unreachable preset contained', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Diagnostics', exact: true })).toBeVisible();
  });

  test('brings back a panel that was closed', async ({ page }) => {
    await openFresh(page);
    await expect(page.getByRole('heading', { name: 'Inspector', exact: true })).toBeVisible();

    // Close the Inspector: make it the active panel first, because the command
    // closes the panel the user is working in.
    await page.getByRole('heading', { name: 'Inspector', exact: true }).click();
    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Close this panel' }).click();
    await expect(page.getByRole('heading', { name: 'Inspector', exact: true })).toBeHidden();

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Inspector', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Inspector', exact: true })).toBeVisible();
  });
});

test.describe('the Workspace settings section', () => {
  test('renames a workspace the user made', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Save this workspace as a new one' }).click();

    await openSettings(page);
    await page.getByRole('tab', { name: 'Workspaces' }).click();

    await page.getByLabel('New name').fill('Mastering');
    await page.getByRole('button', { name: 'Rename' }).click();

    await expect(page.locator('.ag-status-bar')).toContainText('Mastering');
  });

  test('says a built-in workspace keeps its name, rather than failing silently', async ({
    page,
  }) => {
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Workspaces' }).click();

    // Beside the button it applies to, and read with it.
    const rename = page.getByRole('button', { name: 'Rename' });
    await expect(rename).toHaveAccessibleDescription(/^A built-in workspace keeps its name/);
    await expect(rename).toBeDisabled();
  });

  test('draws an unavailable Delete as any unavailable button is drawn', async ({ page }) => {
    // Its tone came later at the same weight, so a Delete that could not be
    // used stayed red.
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Workspaces' }).click();
    const remove = page.getByRole('button', { name: 'Delete' });
    await expect(remove).toHaveAttribute('aria-disabled', 'true');

    const drawn = await drawnAgainstUnavailable(remove);
    expect(drawn.colour[0]).toBe(drawn.colour[1]);
    expect(drawn.border[0]).toBe(drawn.border[1]);
    expect(drawn.surface[0]).toBe(drawn.surface[1]);
  });

  test('draws Save in the recorder as unavailable while there is nothing to save', async ({
    page,
  }) => {
    // The primary tone kept its accent over the unavailable look, a rule of the
    // same weight coming later: the Save every user meets while recording
    // looked ready to press.
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Shortcuts' }).click();
    await page
      .getByRole('button', { name: 'Change the shortcut for Show the command palette' })
      .click();
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();

    const drawn = await drawnAgainstUnavailable(save);
    expect(drawn.colour[0]).toBe(drawn.colour[1]);
    expect(drawn.border[0]).toBe(drawn.border[1]);
    expect(drawn.surface[0]).toBe(drawn.surface[1]);
  });

  test('duplicates a built-in workspace, which is how one becomes editable', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Workspaces' }).click();

    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.locator('.ag-status-bar')).toContainText('Editing copy');

    // Renaming is offered on the copy, which it is not on the built-in one.
    // The button waits for a name that differs, so that pressing it when
    // nothing has been typed cannot look like a failed rename.
    await expect(page.getByRole('button', { name: 'Rename' })).toBeDisabled();
    await page.getByLabel('New name').fill('Mastering');
    await expect(page.getByRole('button', { name: 'Rename' })).toBeEnabled();
  });

  test('deletes a workspace the user made and leaves them somewhere real', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Workspaces' }).click();

    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.locator('.ag-status-bar')).toContainText('Editing copy');

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.locator('.ag-status-bar')).toContainText('Editing');
    await expect(page.locator('.ag-status-bar')).not.toContainText('copy');
  });
});

test.describe('one rule for when two names are one, in every engine', () => {
  /**
   * A name refused or numbered in one browser is refused or numbered in the
   * next, since a name travels between machines, and each engine brings its
   * own collation. So each is asked, through the menu and the settings, the
   * pairs whose verdict turns on the rule's options: case, how a letter is
   * written, accent, punctuation, and digits as they are written.
   */

  /** The name of the workspace on screen, as the status bar shows it. */
  function nameOnScreen(page: Page): Locator {
    return page.getByRole('contentinfo', { name: 'Status' }).locator('.ag-status-item').first();
  }

  /** Saves the workspace on screen as a new one, from the Workspace menu. */
  async function saveAsNew(page: Page): Promise<void> {
    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Save this workspace as a new one' }).click();
  }

  /** Opens the Workspaces section of the settings, and gives the dialogue. */
  async function workspaceSettings(page: Page): Promise<Locator> {
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('tab', { name: 'Workspaces' }).click();
    return dialog;
  }

  /**
   * Types `name` in the settings and presses `button`, and expects the
   * dialogue to say `said` of it.
   */
  async function give(
    dialog: Locator,
    button: 'Rename' | 'Duplicate',
    name: string,
    said: string,
  ): Promise<void> {
    await dialog.getByLabel('New name').fill(name);
    await dialog.getByRole('button', { name: button, exact: true }).click();
    await expect(dialog.locator('.ag-dialog-notice')).toHaveText(said);
  }

  /** What the settings say of a copy made under `name`. */
  function copied(name: string): string {
    return `Copied it as "${name}".`;
  }

  /** What the settings say where the workspace called `holder` has the name given. */
  function held(holder: string): string {
    return `There is already a workspace called "${holder}". Choose another name.`;
  }

  test('holds two names to be one where they differ in case or in how a letter is written, and two where they differ in accent, punctuation or digits', async ({
    page,
  }) => {
    await openFresh(page);
    await saveAsNew(page);
    await expect(nameOnScreen(page)).toHaveText('My workspace');

    // Case, through Save as, which numbers the name it gives past one in
    // capitals.
    let dialog = await workspaceSettings(page);
    await give(dialog, 'Rename', 'MY WORKSPACE', '"My workspace" is now called "MY WORKSPACE".');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await saveAsNew(page);
    await expect(nameOnScreen(page)).toHaveText('My workspace 2');

    // Case, through Duplicate and Rename.
    dialog = await workspaceSettings(page);
    await give(dialog, 'Rename', 'Mixing', '"My workspace 2" is now called "Mixing".');
    await give(dialog, 'Duplicate', 'MIXING', held('Mixing'));

    // Punctuation, which Thai collation would ignore.
    await give(dialog, 'Duplicate', 'Mixing desk', copied('Mixing desk'));
    await give(dialog, 'Duplicate', 'Mixing-desk', copied('Mixing-desk'));
    await give(dialog, 'Rename', 'MIXING DESK', held('Mixing desk'));

    // Accent, and a letter written as a letter and a combining mark, which is
    // one with the letter written as one code point.
    await give(dialog, 'Duplicate', 'Cafe', copied('Cafe'));
    await give(dialog, 'Duplicate', 'Café', copied('Café'));
    await give(dialog, 'Duplicate', 'Cafe\u0301', held('Café'));

    // An accent Danish collation would read as the two letters it replaces.
    await give(dialog, 'Duplicate', 'Gaard', copied('Gaard'));
    await give(dialog, 'Duplicate', 'Gård', copied('Gård'));

    // Digits as they are written, not as the numbers they are.
    await give(dialog, 'Duplicate', 'Mix 1', copied('Mix 1'));
    await give(dialog, 'Duplicate', 'Mix 01', copied('Mix 01'));
  });

  test('numbers a copy past the names held beside it, in the order this engine sorts them', async ({
    page,
  }) => {
    // The names held are sorted by the collation and searched in that order,
    // so a name is found held only where the engine sorts names that are one
    // together. Among the copy's own series sit names that are one with a
    // name of it, written in capitals or with a combining accent, and names
    // that differ from one of it in an accent, a mark of punctuation or a
    // digit as written, which sort beside it.
    await openFresh(page);
    await saveAsNew(page);
    await expect(nameOnScreen(page)).toHaveText('My workspace');
    const dialog = await workspaceSettings(page);
    await give(dialog, 'Rename', 'Café', '"My workspace" is now called "Café".');

    for (const name of [
      'Café copy',
      'CAFÉ COPY 2',
      'Cafe\u0301 copy 3',
      'Cafe copy 4',
      'Café-copy 4',
      'Café copy 04',
      'Café copy 1',
      'Café copy 10',
      'Café copy 11',
    ]) {
      await give(dialog, 'Duplicate', name, copied(name));
    }

    await dialog.getByRole('combobox', { name: 'Current workspace' }).click();
    await page.getByRole('option', { name: 'Café', exact: true }).click();
    await expect(dialog.locator('.ag-dialog-notice')).toHaveText('Switched to "Café".');
    await expect(dialog.getByLabel('New name')).toHaveValue('');

    await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(dialog.locator('.ag-dialog-notice')).toHaveText(copied('Café copy 4'));
  });
});

test.describe('remapping a shortcut', () => {
  /**
   * REQ-UX-066: "Users must be able to fully remap shortcuts." The Shortcuts
   * section records the combination a user presses for a command, and these
   * tests drive it as a user does, from the recorder to the shortcut working
   * after a reload.
   */

  /** Opens the Shortcuts section and starts recording for a command. */
  async function recordFor(page: Page, command: string): Promise<void> {
    await openSettings(page);
    await page.getByRole('tab', { name: 'Shortcuts' }).click();
    await page.getByRole('button', { name: `Change the shortcut for ${command}` }).click();
    await expect(page.getByRole('textbox', { name: `Shortcut for ${command}` })).toBeFocused();
  }

  test('binds a command to the combination the user presses, and it works', async ({ page }) => {
    await openFresh(page);
    await recordFor(page, 'Show the command palette');

    await page.keyboard.press('Control+Alt+KeyB');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden();

    await page.keyboard.press('Control+Alt+KeyB');

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();
  });

  test('keeps the new binding across a reload', async ({ page }) => {
    await openFresh(page);
    await recordFor(page, 'Show the command palette');
    await page.keyboard.press('Control+Alt+KeyB');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await page.reload();
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await page.keyboard.press('Control+Alt+KeyB');

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();
  });

  test('stops recording on Escape rather than cancelling, so Enter can be bound', async ({
    page,
  }) => {
    await openFresh(page);
    await recordFor(page, 'Show the command palette');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    await expect(
      page.getByRole('textbox', { name: 'Shortcut for Show the command palette' }),
    ).toHaveText('Enter');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  });

  test('says a reserved combination cannot be used, before the user saves it, and draws the refusal in the colour of a state', async ({
    page,
  }) => {
    await openFresh(page);
    await recordFor(page, 'Show the command palette');

    await pressPrimary(page, 'KeyT');
    await page.keyboard.press('Escape');

    // The reason names what takes the press, seen and said alike.
    const reason = `${await writtenPress(page, 'KeyT')} cannot be used: The browser opens a tab`;
    const note = page
      .locator('.ag-settings-note[data-ag-status="unavailable"]')
      .filter({ hasText: 'cannot be used' });
    await expect(note).toContainText(reason);

    // And drawn as the state it declares. The colour rules for the attribute
    // were scoped to the status bar and the Capabilities panel, so on a
    // settings note it drew nothing at all in any ordinary theme while the
    // forced-colours layer painted it as a link.
    expect(await note.evaluate((element) => getComputedStyle(element).color)).toBe(
      await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--ag-chrome-status-error)';
        document.querySelector('.ag-theme-root')?.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }),
    );
    await expect(page.locator('#ag-shortcut-recorder-said')).toContainText(reason);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('refuses a chord whose second press the browser takes', async ({ page }) => {
    // The browser does not know a chord has started. Ctrl+K then Ctrl+W is an
    // ordinary Ctrl+W to it, and it closes the tab; the shipped profile bound
    // two chords that ended that way.
    await openFresh(page);
    await recordFor(page, 'Show the command palette');

    await pressPrefix(page);
    await pressPrimary(page, 'KeyW');
    await page.keyboard.press('Escape');

    await expect(page.locator('#ag-shortcut-recorder-said')).toContainText(
      `${await writtenPress(page, 'KeyW')} cannot be used: The browser closes the tab`,
    );
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('says what it recorded, and says nothing is recorded until it stops', async ({ page }) => {
    await openFresh(page);
    await recordFor(page, 'Show the command palette');

    const field = page.getByRole('textbox', { name: 'Shortcut for Show the command palette' });
    const said = page.locator('#ag-shortcut-recorder-said');
    // Described by the instruction, and not by the live text as well. A live
    // region is announced when it changes, so naming it in the description had
    // the refusal read again on every return of focus, and a third time by
    // Save, which carries the platform's reason itself. What the field holds is
    // its own text, which a read-only text box reads out as its value.
    await expect(field).toHaveAttribute('aria-describedby', 'ag-shortcut-recorder-help');
    await expect(field).toHaveAttribute('aria-readonly', 'true');
    await expect(said).toHaveAttribute('aria-live', 'polite');
    // And whole. Read as the part that changed, one refusal replacing another
    // differs in a word or two and a reader would hear that word alone; this is
    // the only place a refusal is spoken, so what was left out would be said
    // nowhere.
    await expect(said).toHaveAttribute('aria-atomic', 'true');

    await pressPrefix(page);
    await expect(said).toHaveText(`${await writtenPress(page, 'KeyK')} so far.`);

    await pressPrimary(page, 'KeyY');
    await page.keyboard.press('Escape');
    await expect(said).toHaveText(
      `${await writtenPress(page, 'KeyK')}, ${await writtenPress(page, 'KeyY')} recorded. Save it, or record again.`,
    );
  });

  test('shows a conflict the user created', async ({ page }) => {
    await openFresh(page);
    await recordFor(page, 'Settings');

    await openPalette(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('group', { name: 'Conflicts' })).toContainText('Settings');
  });

  test('offers a key only to a command a key can run', async ({ page }) => {
    // Recording where panels were dragged needs the arrangement the drag
    // produced, which no key press supplies, so a key bound to it could only
    // ever refuse.
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Shortcuts' }).click();

    await expect(
      page.getByRole('button', { name: 'Change the shortcut for Show the command palette' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Change the shortcut for Rearrange the panels' }),
    ).toHaveCount(0);
  });

  test('exports the shortcuts as a file', async ({ page }) => {
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Shortcuts' }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();

    expect((await download).suggestedFilename()).toMatch(/\.json$/);
  });

  test('returns to the defaults', async ({ page }) => {
    await openFresh(page);
    await recordFor(page, 'Show the command palette');
    await page.keyboard.press('Control+Alt+KeyB');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await page.getByRole('button', { name: 'Reset to the defaults', exact: true }).click();
    await page.keyboard.press('Escape');
    await openPalette(page);

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();
  });
});

test.describe('exporting a diagnostic report', () => {
  /**
   * REQ-PRIV-161: "The diagnostic-bundle UI must show the user what will be
   * included before submission or export." The export command opens a consent
   * dialogue whose preview shows what the report will contain before anything
   * is saved.
   */

  async function openExport(page: Page): Promise<void> {
    await menuBarMenu(page, 'Help').click();
    await page.getByRole('menuitem', { name: 'Export a diagnostic report' }).click();
    await expect(page.getByRole('dialog', { name: 'Export a diagnostic report' })).toBeVisible();
  }

  test('shows what the report will contain before anything is saved', async ({ page }) => {
    await openFresh(page);
    await openExport(page);

    const preview = page.getByRole('region', { name: 'What the report will contain' });
    await expect(preview).toContainText('Recent diagnostic messages');
    await expect(preview).toContainText('Your browser and operating system');
  });

  test('takes a category out of the preview when the user switches it off', async ({ page }) => {
    await openFresh(page);
    await openExport(page);

    await page.getByRole('switch', { name: /Recent diagnostic messages/ }).click();

    await expect(
      page.getByRole('region', { name: 'What the report will contain' }),
    ).not.toContainText('Recent diagnostic messages');
  });

  test('says how much of the note goes, and shows the note itself apart from what it says', async ({
    page,
  }) => {
    // The preview was the field's description and a polite, atomic region at
    // once, and it held the reader's whole note: up to four thousand
    // characters, read out at every pause in typing and again at every return
    // of focus, with no way to stop it. What is said is a sentence; what is
    // shown is the note.
    await openFresh(page);
    await openExport(page);

    const field = page.getByRole('textbox', { name: 'What were you doing when it happened?' });
    await field.fill('It broke while I saved demo-project.aup3 again');

    // The description a reader hears on focus: the field's own sentence and
    // the one about the redaction, and not the note. Read against the whole
    // of what is said rather than for a word the note holds: the element the
    // description names only ever carries the redacted form, so looking there
    // for the file name found nothing whatever the note was appended to.
    const description = async (): Promise<string> =>
      await field.evaluate((element) =>
        (element.getAttribute('aria-describedby') ?? '')
          .split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent.trim() ?? '')
          .filter((text) => text !== '')
          .join(' '),
      );

    // Polled: the preview settles a moment after the last keystroke, so read
    // at once the description is the field's own sentence and nothing else.
    await expect.poll(description).toMatch(/removed\. What it will read as is shown below it\.$/u);
    expect(await description()).not.toContain('saved');

    // The note itself, shown and not said.
    const shown = page.getByText('Your note will be carried as:');
    await expect(shown).toContainText('<file>');
    await expect(shown).not.toContainText('demo-project');
  });

  test('names iPadOS as the system in the report a tablet saves', async ({ page }, testInfo) => {
    // iPadOS Safari sends the Mac's agent by default, and the application
    // tells an iPad from a Mac by its touch points alone, so an iPad user's
    // report would name a Mac were that reading lost. The tablet alone stands
    // for an iPad. Playwright's WebKit reports no touch points, so the tablet
    // gives the page the iPad's through the suite's `touchPoints` option.
    test.skip(testInfo.project.name !== 'tablet', 'The tablet alone stands for an iPad.');
    await openFresh(page);
    const signals = await page.evaluate(() => ({
      agent: navigator.userAgent,
      touchPoints: navigator.maxTouchPoints,
    }));
    expect(signals.agent, "the tablet sends an agent other than the Mac's").toMatch(
      /\(Macintosh;/u,
    );
    expect(
      signals.touchPoints,
      "the page reports the touch points of no iPad: the tablet's `touchPoints` option, which the suite's `test` gives every page, did not reach it",
    ).toBeGreaterThan(1);

    await openExport(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save the report', exact: true }).click();
    const saved: unknown = JSON.parse(await readFile(await (await download).path(), 'utf8'));

    expect(saved).toMatchObject({ environment: { operatingSystem: OperatingSystem.IpadOs } });
  });

  test('saves the report as a file, and says it went nowhere else', async ({ page }) => {
    await openFresh(page);
    await openExport(page);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save the report', exact: true }).click();

    expect((await download).suggestedFilename()).toMatch(/^audiogubbins-diagnostics-.*\.json$/);
    await expect(page.locator('.ag-notice')).toContainText('has not been sent anywhere');
  });
});

test.describe('choosing what the log records', () => {
  test('records more when the user asks for everything', async ({ page }) => {
    // REQ-PRIV-165: user-configurable verbosity. It was fixed at Warning.
    await openFresh(page);
    await openSettings(page);
    await page.getByRole('tab', { name: 'Diagnostics' }).click();

    await page.getByRole('combobox', { name: 'What the log records', exact: true }).click();
    await page.getByRole('option', { name: 'Everything' }).click();
    await expect(
      page.getByRole('combobox', { name: 'What the log records', exact: true }),
    ).toContainText('Everything');

    await page.reload();
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
    await openSettings(page);
    await page.getByRole('tab', { name: 'Diagnostics' }).click();

    await expect(
      page.getByRole('combobox', { name: 'What the log records', exact: true }),
    ).toContainText('Everything');
  });
});

test.describe('rearranging the workspace', () => {
  /** The rectangle a panel's group occupies. */
  async function boxOf(page: Page, title: string) {
    const box = await groupShowing(page, title).boundingBox();
    if (box === null) throw new Error(`${title} is not on screen.`);
    return box;
  }

  /**
   * Drags the engine's splitter on the right of a panel's group sideways by
   * `by` pixels: the upright one whose middle is nearest the group's right
   * edge.
   */
  async function dragSplitterBeside(page: Page, title: string, by: number): Promise<void> {
    const box = await boxOf(page, title);
    const splitter = await splitters(page).evaluateAll(
      (sashes, edge) =>
        sashes
          .map((sash) => sash.getBoundingClientRect())
          .filter((one) => one.height > one.width && one.height > 0)
          .map((one) => ({ x: one.x + one.width / 2, y: one.y + one.height / 2 }))
          .sort((left, right) => Math.abs(left.x - edge) - Math.abs(right.x - edge))[0],
      box.x + box.width,
    );
    if (splitter === undefined) throw new Error(`There is no splitter beside ${title}.`);

    await page.mouse.move(splitter.x, splitter.y);
    await page.mouse.down();
    await page.mouse.move(splitter.x + by, splitter.y, { steps: 10 });
    await page.mouse.up();
  }

  /**
   * Drags the engine's splitter above a panel's group down by `by` pixels:
   * the flat one whose middle is nearest the group's top edge. A negative
   * `by` drags it up, which makes the group taller.
   *
   * Beside the drag of the upright one: with no drag of the flat one, the
   * declared minimum height could be dropped, misspelled or swapped with the
   * width and every suite would stay green.
   */
  async function dragSplitterAbove(page: Page, title: string, by: number): Promise<void> {
    const box = await boxOf(page, title);
    const splitter = await splitters(page).evaluateAll(
      (sashes, edge) =>
        sashes
          .map((sash) => sash.getBoundingClientRect())
          .filter((one) => one.width > one.height && one.width > 0)
          .map((one) => ({ x: one.x + one.width / 2, y: one.y + one.height / 2 }))
          .sort((left, right) => Math.abs(left.y - edge) - Math.abs(right.y - edge))[0],
      box.y,
    );
    if (splitter === undefined) throw new Error(`There is no splitter above ${title}.`);

    await page.mouse.move(splitter.x, splitter.y);
    await page.mouse.down();
    await page.mouse.move(splitter.x, splitter.y + by, { steps: 10 });
    await page.mouse.up();
  }

  /** The names of the tabs in the group a tab is in. */
  function tabsBeside(page: Page, tab: string): Locator {
    return groupWithTab(page, tab).getByRole('tab');
  }

  test(
    'keeps a panel the user widened at its width across a reload',
    { tag: '@scale' },
    async ({ page }) => {
      // Each group's size was measured and stored and then never applied when
      // the workspace mounted, so a panel the user widened came back at its
      // preset width. No test resized anything.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      const before = await boxOf(page, 'Assets');

      await dragSplitterBeside(page, 'Assets', 150);

      const widened = await boxOf(page, 'Assets');
      expect(widened.width).toBeGreaterThan(before.width + 100);

      await page.reload();
      await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

      const after = await boxOf(page, 'Assets');
      expect(Math.abs(after.width - widened.width)).toBeLessThan(12);
    },
  );

  test(
    'keeps a side panel dragged across most of the window on its side across a reload',
    { tag: '@scale' },
    async ({ page }) => {
      // Read back by its rectangle alone, the asset browser dragged past six
      // tenths of the dock came back as a second main area, and after a reload
      // it was a tab beside the editor, its width gone.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      await dragSplitterBeside(page, 'Assets', 700);
      const surface = await dock(page).first().boundingBox();
      if (surface === null) throw new Error('The dock is not on screen.');
      const widened = await boxOf(page, 'Assets');
      expect(widened.width / surface.width).toBeGreaterThan(0.6);
      await afterFrames(page, 4);

      await page.reload();
      await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

      await expect(tabsBeside(page, 'Assets')).toHaveText(['Assets']);
      const after = await boxOf(page, 'Assets');
      expect(after.x - surface.x).toBeLessThan(4);
      expect(Math.abs(after.width - widened.width)).toBeLessThan(12);
    },
  );

  test(
    'keeps a panel no narrower than its minimum when its splitter is dragged',
    { tag: '@scale' },
    async ({ page }) => {
      // Each panel declares a smallest useful size, and nothing gave it to the
      // engine, which kept a group no narrower than its own hundred pixels.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      const before = await boxOf(page, 'Assets');
      expect(before.width).toBeGreaterThan(200 + 1);

      await dragSplitterBeside(page, 'Assets', -400);

      // At the minimum, to a pixel either way: narrower than it started, so the
      // drag was made, and no narrower than it may be, so the drag was held.
      const after = (await boxOf(page, 'Assets')).width;
      expect(after, 'the drag did not narrow the panel to its minimum').toBeLessThanOrEqual(
        200 + 1,
      );
      expect(after).toBeGreaterThanOrEqual(200 - 1);
    },
  );

  test(
    'keeps a panel no shorter than its minimum when the splitter above it is dragged',
    { tag: '@scale' },
    async ({ page }) => {
      // The same declared size, on the other axis. The adapter passes both
      // numbers to the engine and only the width was ever read back, here or in
      // a unit test.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      // Made taller first, so there is a way to shorten it: on a tablet it
      // starts at its minimum. Then dragged down past the minimum, with the
      // pointer kept inside the window: taken past its foot, Firefox moves the
      // splitter up the dock instead, and the panel grows.
      await dragSplitterAbove(page, 'Transport', -150);
      const before = await boxOf(page, 'Transport');
      expect(before.height).toBeGreaterThan(120 + 100);

      await dragSplitterAbove(page, 'Transport', 250);

      // At the minimum, to a pixel either way, as the width is above.
      const after = (await boxOf(page, 'Transport')).height;
      expect(after, 'the drag did not shorten the panel to its minimum').toBeLessThanOrEqual(
        120 + 1,
      );
      expect(after).toBeGreaterThanOrEqual(120 - 1);
    },
  );

  test(
    'lets a splitter drag make a panel taller, so the limit above is a limit',
    { tag: '@scale' },
    async ({ page }) => {
      // Without this the test above would pass against a dock that never moved
      // a flat splitter at all.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      const before = await boxOf(page, 'Transport');

      await dragSplitterAbove(page, 'Transport', -150);

      expect((await boxOf(page, 'Transport')).height).toBeGreaterThan(before.height + 100);
    },
  );

  test(
    'keeps a panel the user widened across a new window size and a tab chosen',
    { tag: '@scale' },
    async ({ page }) => {
      // The pairing the dock reads a report against was taken again after a
      // resize, from the arrangement last reported. Taken from the one it was
      // mounted with instead, the tab chosen after the resize read the widened
      // asset browser back at its shipped share, and the reload lost the width.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      await dragSplitterBeside(page, 'Assets', 150);
      await afterFrames(page, 4);
      await page.setViewportSize({ width: 1000, height: 860 });
      await afterFrames(page, 4);
      await page.getByRole('tab', { name: 'Assets', exact: true }).click();
      await afterFrames(page, 4);
      const resized = await boxOf(page, 'Assets');

      await page.reload();
      await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

      expect(Math.abs((await boxOf(page, 'Assets')).width - resized.width)).toBeLessThan(12);
    },
  );

  test(
    'keeps storing arrangements after the workspace is renamed',
    { tag: '@scale' },
    async ({ page }) => {
      // The dock is mounted once and never hears about a rename, so it went on
      // reporting the name it was mounted with. That name travelled with every
      // arrangement, so after a rename each drag was refused as another
      // workspace's and nothing the user did to the layout was stored again.
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      await menuBarMenu(page, 'Workspace').click();
      await page.getByRole('menuitem', { name: 'Save this workspace as a new one' }).click();

      await openSettings(page);
      await page.getByRole('tab', { name: 'Workspaces' }).click();
      await page.getByLabel('New name').fill('Mastering');
      await page.getByRole('button', { name: 'Rename' }).click();
      await expect(page.locator('.ag-status-bar')).toContainText('Mastering');
      await page.keyboard.press('Escape');

      const before = await boxOf(page, 'Assets');
      await dragSplitterBeside(page, 'Assets', 150);

      const widened = await boxOf(page, 'Assets');
      expect(widened.width).toBeGreaterThan(before.width + 100);

      await page.reload();
      await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

      await expect(page.locator('.ag-status-bar')).toContainText('Mastering');
      const after = await boxOf(page, 'Assets');
      expect(Math.abs(after.width - widened.width)).toBeLessThan(12);
    },
  );

  test('keeps the log filter the reader chose when the dock is built again', async ({ page }) => {
    // Moving a panel by command builds the dock again, and every panel in it.
    // Kept in the panel, a log filtered to its errors showed everything again.
    // Preferences that cannot be read put a warning in the log, so the panel
    // has something to filter.
    await page.addInitScript(() => {
      localStorage.setItem('audiogubbins.preferences', 'not JSON');
    });
    await openFresh(page);
    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Diagnostics', exact: true })).toBeVisible();

    await page.getByRole('combobox', { name: 'Show', exact: true }).click();
    await page.getByRole('option', { name: 'error and above', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toContainText(
      'error and above',
    );

    await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Move this panel to the left' }).click();

    await expect(page.getByRole('heading', { name: 'Diagnostics', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Show', exact: true })).toContainText(
      'error and above',
    );
  });

  test('keeps the tab the user brought to the front across a reload', async ({ page }) => {
    await openFresh(page);

    // The Diagnostics panel opens as a second tab beside the Transport.
    await menuBarMenu(page, 'Workspace').click();
    await page.getByRole('menuitem', { name: 'Diagnostics', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Diagnostics', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Transport', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Transport', exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Transport', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Diagnostics', exact: true })).toBeHidden();
  });

  test(
    'keeps a panel the user dragged into another group there across a reload',
    { tag: '@scale' },
    async ({ page }) => {
      await page.setViewportSize({ width: 1200, height: 860 });
      await openFresh(page);

      // Dropped on the Transport's tab strip, beside its tab, which is where a
      // user drops a tab to join a group.
      const strip = groupWithTab(page, 'Transport').getByRole('tablist');
      const box = await strip.boundingBox();
      if (box === null) throw new Error('The tab strip is not on screen.');

      // The engine drags a tab through the browser's native drag and drop
      // where the primary pointer is fine, and through pointer events of its
      // own where it is coarse, which starts a drag only once the pointer has
      // moved past a threshold. The test takes whichever path the engine does,
      // asking the same question it asks.
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      await page.getByRole('tab', { name: 'Inspector', exact: true }).dragTo(strip, {
        targetPosition: { x: box.width - 40, y: box.height / 2 },
        ...(coarse ? { steps: 20 } : {}),
      });

      const inspectorGroup = groupWithTab(page, 'Inspector');
      await expect(tabWithin(inspectorGroup, 'Transport')).toHaveCount(1);

      await page.reload();
      await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

      await expect(tabWithin(inspectorGroup, 'Transport')).toHaveCount(1);
    },
  );

  test('floats a panel that was stored floating, and keeps it floating', async ({ page }) => {
    // The floating region was accepted and then mounted as another tab in the
    // centre, so a floating panel came back docked.
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded') !== null) return;
      sessionStorage.setItem('seeded', 'yes');
      localStorage.setItem(
        'audiogubbins.workspace',
        JSON.stringify({
          schemaVersion: 1,
          id: 'floating',
          displayName: 'Floating',
          builtIn: false,
          groups: [
            {
              region: 'centre',
              proportion: 1,
              panels: [{ id: 'floating:editor', kind: 'editor' }],
              activePanelId: 'floating:editor',
            },
            {
              region: 'floating',
              proportion: 1,
              panels: [{ id: 'floating:inspector', kind: 'inspector' }],
              activePanelId: 'floating:inspector',
              placement: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
            },
          ],
          activePanelId: 'floating:editor',
        }),
      );
    });
    await openFresh(page);

    const floatingInspector = floatingPanel(page, 'Inspector');
    await expect(floatingInspector).toHaveCount(1);
    await expect(page.locator('.ag-status-bar')).not.toContainText('could not');

    await page.reload();
    await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();

    await expect(floatingInspector).toHaveCount(1);
  });

  test('refuses to close the last docked panel beside a floating one', async ({ page }) => {
    // Closing it was allowed, and left the floating panel over an empty
    // workspace, the state moving a panel to float already refused.
    await page.setViewportSize({ width: 1200, height: 860 });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded') !== null) return;
      sessionStorage.setItem('seeded', 'yes');
      localStorage.setItem(
        'audiogubbins.workspace',
        JSON.stringify({
          schemaVersion: 1,
          id: 'one-docked',
          displayName: 'One docked',
          builtIn: false,
          groups: [
            {
              region: 'centre',
              proportion: 1,
              panels: [{ id: 'docked:editor', kind: 'editor' }],
              activePanelId: 'docked:editor',
            },
            {
              region: 'floating',
              proportion: 1,
              panels: [{ id: 'docked:inspector', kind: 'inspector' }],
              activePanelId: 'docked:inspector',
              placement: { x: 0.3, y: 0.2, width: 0.4, height: 0.5 },
            },
          ],
          activePanelId: 'docked:editor',
        }),
      );
    });
    await openFresh(page);
    await menuBarMenu(page, 'Workspace').click();

    const close = page.getByRole('menuitem', { name: /Close this panel/ });
    await expect(close).toHaveAttribute('aria-disabled', 'true');
    await expect(close).toContainText('nothing for the floating panels to float over');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Editor', exact: true })).toBeVisible();
  });
});
