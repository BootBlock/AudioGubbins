import { expect, type Locator, type Page } from '@playwright/test';

import { dockTabs, groupShowing } from './dock.js';
import {
  fieldTextSizes,
  HALF_A_PIXEL,
  lengthenRefusal,
  roomForAControl,
  scrollUntilInSight,
} from './dialogue.js';
import { openPalette, openSettings, refuseBrightening, startAtTheBrightest } from './platform.js';
import { menuBarMenu, openFresh, recordPointerKinds } from './shell.js';
import { test } from './test.js';

/**
 * Touch, on every engine the matrix covers.
 *
 * A suite of their own rather than a part of the pointer suite, which one
 * project runs on Chromium: there, touch would be verified on one engine while
 * the tablet project ran a suite with no touch in it at all. A touch screen is
 * the device where WebKit differs most: it decides what a tap produces, how a
 * hit area is resolved and whether a control responds to a finger at all.
 *
 * REQ-UX-005 and REQ-UX-067 make touch first-class, and a Phase 01 acceptance
 * criterion asks for touch smoke tests on representative inputs. Two engines is
 * what makes them representative.
 */

test.describe('touch', () => {
  test('opens a menu with a tap and runs the entry that was tapped', async ({ page }) => {
    await openFresh(page);
    const kinds = await recordPointerKinds(page);

    // `locator.tap()` rather than a coordinate: it waits for the control to be
    // stable and hit-testable first, where a coordinate taken earlier can land
    // beside a control that has since moved.
    await menuBarMenu(page, 'View').tap();

    const entry = page.getByRole('menuitem', { name: 'Use the light theme' });
    await expect(entry).toBeVisible();

    await entry.tap();

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
    expect(await kinds()).toContain('touch');
  });

  test('arranges the workspace with a finger, which no drag on a touch screen can', async ({
    page,
  }) => {
    // The docking engine moves a panel with the browser's drag-and-drop, which
    // a touch screen does not produce: on a tablet the workspace could be
    // looked at and not arranged. Every move is a command, so a finger reaches
    // it through the menu like everything else.
    await openFresh(page);

    const assets = groupShowing(page, 'Assets');
    const before = await assets.boundingBox();
    if (before === null) throw new Error('The asset browser is not on screen.');

    await page.getByRole('tab', { name: 'Assets', exact: true }).tap();
    await menuBarMenu(page, 'Workspace').tap();
    await page.getByRole('menuitem', { name: 'Move this panel to the bottom' }).tap();

    // Polled: the move builds the dock again, and the tap resolves before the
    // dock is drawn in its new arrangement.
    await expect
      .poll(async () => {
        const after = await assets.boundingBox();
        return after !== null && after.y > before.y && after.width > before.width;
      })
      .toBe(true);
  });

  test('reaches the settings without a keyboard or a hover', async ({ page }) => {
    // A touch user has no hover and no shortcut, so anything only reachable
    // through either is unreachable to them.
    await openFresh(page);
    const kinds = await recordPointerKinds(page);

    await menuBarMenu(page, 'Help').tap();

    const settings = page.getByRole('menuitem', { name: 'Settings' });
    await expect(settings).toBeVisible();

    await settings.tap();

    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    // Both presses were a finger. A tap the browser delivered as a mouse press
    // would have opened the dialogue just the same.
    expect(await kinds()).toEqual(['touch', 'touch']);
  });

  test('runs the command a tapped palette row names', async ({ page }) => {
    // A finger on a palette row is the only pointer route to a command that is
    // on no menu. The press is refused so that focus stays in the search field,
    // and on a touch pointer a refused press also suppresses the mouse events
    // an engine synthesises from a tap, which is where engines differ.
    await openFresh(page);
    const kinds = await recordPointerKinds(page);

    await openPalette(page);
    await page.getByRole('combobox', { name: 'Search commands' }).fill('Use the light theme');

    await page.getByRole('option', { name: /Use the light theme/ }).tap();

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeHidden();
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
    expect(await kinds()).toContain('touch');
  });

  test('answers a tap that lands beside a small control, not only one on it', async ({ page }) => {
    // REQ-UX-071: the touch target does not shrink with the control, because a
    // control that is legible and unhittable is not usable. The target is drawn
    // around the control rather than on it, so its size cannot be read from the
    // control's own box. What can be read is what the browser hits, which is
    // the thing the requirement is actually about.
    await openFresh(page);
    await openSettings(page);

    // The diagnostic-mode switch, which is drawn as small as any control.
    // Contrast has three settings, so it is a list rather than a switch.
    await page.getByRole('tab', { name: 'Diagnostics' }).tap();

    const control = page.getByRole('switch', { name: 'Diagnostic mode' });
    await expect(control).toHaveAttribute('data-state', 'unchecked');

    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    // Below the switch by more than its own height, and still within the target.
    const beside = { x: box.x + box.width / 2, y: box.y + box.height + 8 };

    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('role') ?? '',
      beside,
    );
    expect(hit).toBe('switch');

    await page.touchscreen.tap(beside.x, beside.y);
    await expect(control).toHaveAttribute('data-state', 'checked');
  });
});

test.describe('a finger in compact density', () => {
  /** The heights of every element a locator finds, in pixels. */
  async function heightsOf(locator: Locator): Promise<number[]> {
    return await locator.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  }

  /** Switches to compact density, where every drawn control is smallest. */
  async function compact(page: Page): Promise<void> {
    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use compact spacing' }).click();
    await expect(page.locator('[data-ag-density="compact"]').first()).toBeAttached();
  }

  test('can hit every menu entry, list option and palette row', async ({ page }) => {
    // In compact density the menu entries, select options and palette rows drew
    // at 22 pixels on a touch screen, with nothing widening them. A row cannot
    // widen its hit area past the row beside it, so on a device with a touch
    // screen each row is drawn at the touch target instead.
    await openFresh(page);
    await compact(page);

    // Each surface is measured once it is on screen, which a click or a key
    // resolving does not wait for.
    await menuBarMenu(page, 'View').click();
    await expect(page.getByRole('menu')).toBeVisible();
    const entries = await heightsOf(page.getByRole('menu').getByRole('menuitem'));
    expect(entries.length).toBeGreaterThan(3);
    for (const height of entries) expect(height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');

    await openPalette(page);
    await expect(page.getByRole('option').first()).toBeVisible();
    const rows = await heightsOf(page.getByRole('option'));
    expect(rows.length).toBeGreaterThan(3);
    for (const height of rows) expect(height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeHidden();

    await openSettings(page);
    await page.getByRole('combobox', { name: 'Density' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    const options = await heightsOf(page.getByRole('option'));
    expect(options.length).toBe(2);
    for (const height of options) expect(height).toBeGreaterThanOrEqual(44);
  });

  test('can hit every menu along the top and every list in the settings', async ({ page }) => {
    // The menus along the top and the settings' lists are compact controls in a
    // bar or a form, which nothing widened. Widening them would lay their hit
    // areas over the workspace below and the row beside, so they are drawn at
    // the touch target instead.
    await openFresh(page);
    await compact(page);

    const menus = await heightsOf(page.getByRole('menubar').getByRole('menuitem'));
    expect(menus.length).toBeGreaterThan(2);
    for (const height of menus) expect(height).toBeGreaterThanOrEqual(44);

    await openSettings(page);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    const lists = await heightsOf(page.getByRole('combobox'));
    expect(lists.length).toBeGreaterThan(0);
    for (const height of lists) expect(height).toBeGreaterThanOrEqual(44);
  });

  test('can hit every field it has to type into, and every dock tab', async ({ page }) => {
    // A text field wore the class that widens a hit area with a pseudo-element,
    // which a browser does not render on a replaced control, so it had no
    // widened area and drew at about twenty pixels. A dock tab, which is how a
    // finger changes panel, was widened and never heightened.
    await openFresh(page);
    await compact(page);

    const tabs = await heightsOf(dockTabs(page));
    expect(tabs.length).toBeGreaterThan(1);
    for (const height of tabs) expect(height).toBeGreaterThanOrEqual(44);

    await openPalette(page);
    const search = page.getByRole('combobox', { name: 'Search commands' });
    await expect(search).toBeVisible();
    const [field] = await heightsOf(search);
    expect(field).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(search).toBeHidden();

    await openSettings(page);
    await page.getByRole('tab', { name: 'Workspaces' }).tap();
    await expect(page.getByRole('tab', { name: 'Workspaces' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('textbox').first()).toBeVisible();
    const fields = await heightsOf(page.getByRole('textbox'));
    expect(fields.length).toBeGreaterThan(0);
    for (const height of fields) expect(height).toBeGreaterThanOrEqual(44);
  });

  test('draws every field a finger types into at 16 pixels at least, so a phone does not zoom into it', async ({
    page,
  }) => {
    // Safari on an iPhone zooms the page into a field drawn under 16 pixels as
    // it takes focus, and leaves it zoomed, so the dialogue that holds the
    // field is left partly off the screen. The page keeps zoom for the reader,
    // so where a finger is among the inputs a field is drawn at 16 pixels at
    // least, and at its own size where that is larger. It is read in compact
    // density, where every field is smallest, so no field reaches 16 by its own
    // size. Playwright's WebKit does not zoom, so what is read here is the size
    // the zoom is decided by.
    await openFresh(page);
    expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
    await compact(page);

    for (const { field, drawn, density } of await fieldTextSizes(page)) {
      expect(density, `the density's size for ${field} is not under 16`).toBeLessThan(16);
      expect(drawn, `${field} is drawn under 16 pixels`).toBe(Math.max(16, density));
    }
  });

  /**
   * Opens the export dialogue with taps and raises a refusal in it, made to run
   * to many lines, as no refusal this shell raises does. Gives the dialogue and
   * the refusal.
   */
  async function longRefusalInTheExportDialogue(
    page: Page,
  ): Promise<{ readonly dialog: Locator; readonly notice: Locator }> {
    await menuBarMenu(page, 'Help').tap();
    await page.getByRole('menuitem', { name: 'Export a diagnostic report' }).tap();
    const dialog = page.getByRole('dialog', { name: 'Export a diagnostic report' });
    await expect(dialog).toBeVisible();

    await refuseBrightening(page);
    await expect(dialog.locator('.ag-dialog-notice')).toBeVisible();
    return { dialog, notice: await lengthenRefusal(dialog) };
  }

  test('keeps room in a dialogue for a control drawn for a finger, whatever its footer holds', async ({
    page,
  }) => {
    // A finger among the inputs draws the dialogue's field at the touch
    // target, taller than either density's control, so the least room the
    // part that scrolls keeps is set from the touch target there.
    await startAtTheBrightest(page);
    await openFresh(page);
    await compact(page);
    const { dialog } = await longRefusalInTheExportDialogue(page);

    const [field] = await heightsOf(dialog.getByRole('textbox'));
    expect(field, 'the field is not drawn for a finger').toBeGreaterThanOrEqual(44);
    const { room, needed } = await dialog.locator('.ag-dialog-scroll').evaluate(roomForAControl);
    expect(
      room,
      'the refusal left no room for a control a finger uses and its ring',
    ).toBeGreaterThanOrEqual(needed - HALF_A_PIXEL);
  });

  test('scrolls a dialogue taller than the page to the end of a long refusal with a finger', async ({
    page,
    browserName,
  }) => {
    // Where the dialogue is taller than the page it scrolls as a whole, and a
    // finger that starts on its footer, which does not scroll of its own, has
    // to scroll it while the page behind it is locked.
    test.skip(
      browserName !== 'chromium',
      'A test drives the scroll of a finger through the Chromium protocol alone.',
    );
    await page.setViewportSize({ width: 320, height: 256 });
    await startAtTheBrightest(page);
    await openFresh(page);
    // From the top of the dialogue, with the refusal long enough that its end
    // lies past the dialogue's edge there, so the finger is what brings it
    // into view.
    const { dialog, notice } = await longRefusalInTheExportDialogue(page);

    const box = await dialog.boundingBox();
    if (box === null) throw new Error('The dialogue has no box.');
    const start = { x: box.x + box.width / 2, y: box.y + box.height - 8 };
    // Answered in the page as a boolean: a point with no element at it is not
    // on the footer.
    expect(
      await page.evaluate(({ x, y }) => {
        const at = document.elementFromPoint(x, y);
        return at !== null && at.closest('.ag-dialog-footer') !== null;
      }, start),
      'the finger does not start on the footer',
    ).toBe(true);

    const session = await page.context().newCDPSession(page);
    await scrollUntilInSight(notice, 'end', 'finger', 'stops', async () => {
      // A finger drawn up the screen, as the protocol delivers one.
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [start],
      });
      for (let step = 1; step <= 8; step += 1) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: start.x, y: start.y - step * 10 }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    });
  });
});
