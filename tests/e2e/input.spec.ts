import { expect, type Page } from '@playwright/test';

import { KeyboardConvention } from '@audiogubbins/commands';

import { openAsset, scopeOf, surfaceOf } from './editor.js';
import { conventionOf, openPalette, openSettings, pressPrimary, writtenPress } from './platform.js';
import { centreOf, menuBarMenu, openFresh, recordPresses } from './shell.js';
import { test } from './test.js';

/**
 * Every input device the shell claims to support, driven for real.
 *
 * A Phase 01 acceptance criterion asks for mouse, keyboard, touch and pen smoke
 * tests, because REQ-UX-005 and REQ-UX-067 make all four first-class rather
 * than making the mouse first-class and the rest a fallback. A unit test cannot
 * cover this: what is being checked is whether a real browser turns a real
 * device event into a working interaction, which is exactly the part jsdom
 * invents.
 *
 * The pen is driven through the browser's own input pipeline rather than
 * through synthesised DOM events. A dispatched `PointerEvent` proves only that
 * the application listens to a name; a device event proves the browser produces
 * that name from the device. It is driven through the Chrome DevTools Protocol,
 * which is why the pen runs on Chromium alone and is recorded as a limitation
 * of this phase's evidence. Touch has a suite of its own, run on two engines.
 */

test.describe('the mouse', () => {
  test('opens a menu and runs the entry that was clicked', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await page.getByRole('menuitem', { name: 'Use the light theme' }).click();

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
  });

  test('shows the hint on a control the pointer rests over', async ({ page }) => {
    await openFresh(page);

    await page.getByRole('button', { name: 'Commands' }).hover();

    // The hint carries the shortcut as well as the description, so a user who
    // reaches for the mouse still learns the keyboard way of doing it.
    const hint = page.getByRole('tooltip');
    await expect(hint).toContainText('Run a command');
    // As the convention the browser reports writes it. Written out, a test that
    // pressed Control everywhere would pass vacuously on WebKit, and this one
    // would fail outright on Apple hardware, where the hint reads ⌘.
    await expect(hint).toContainText(await writtenPress(page, 'KeyK'));
  });

  test('dismisses a menu by clicking away from it', async ({ page }) => {
    await openFresh(page);

    await menuBarMenu(page, 'View').click();
    await expect(page.getByRole('menuitem', { name: 'Use the light theme' })).toBeVisible();

    // A point beside the open menu, measured rather than assumed. A fixed
    // point was inside the menu once its entries grew to the touch target on
    // this touch-capable project, and the click chose an entry instead.
    const menu = await page.getByRole('menu', { name: 'View' }).boundingBox();
    expect(menu).not.toBeNull();
    if (menu === null) return;
    await page.mouse.click(menu.x + menu.width + 120, menu.y + menu.height / 2);

    await expect(page.getByRole('menuitem', { name: 'Use the light theme' })).toBeHidden();
  });
});

test.describe('the keyboard', () => {
  // A shortcut and a chord are each run from the keys on this engine by the
  // smoke suite, "opens from its shortcut" and "runs a chord", which press
  // what the shipped profile binds as these would.
  test('types into the command palette and runs what it finds', async ({ page }) => {
    await openFresh(page);

    await openPalette(page);
    await page.keyboard.type('light');
    await page.keyboard.press('Enter');

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
  });

  test('leaves a text field its select-all and its word movement', async ({ page }) => {
    // The editor's Ctrl+A and Ctrl+Left took the field's own: "zoom in",
    // select all, "x" read "zoom inx", and the caret did not move by a word.
    await openFresh(page);
    await openPalette(page);
    const field = page.getByRole('combobox', { name: 'Search commands' });

    await field.fill('zoom in');
    await pressPrimary(page, 'KeyA');
    await page.keyboard.type('x');
    await expect(field).toHaveValue('x');

    await field.fill('open another view');
    // A word back is Option with the arrow on Apple hardware, Control elsewhere.
    const apple = (await conventionOf(page)) === KeyboardConvention.Apple;
    await page.keyboard.press(apple ? 'Alt+ArrowLeft' : 'Control+ArrowLeft');
    await page.keyboard.type('Z');
    await expect(field).toHaveValue('open another Zview');
  });

  test('changes nothing behind a modal dialogue', async ({ page }) => {
    // With the settings open on their first tab, M, Z and Ctrl+A added a
    // marker, chose the Zoom tool and selected everything in the editor
    // hidden behind them, and nothing was said until the dialogue closed.
    const panel = await openAsset(page, 'Tone bursts');
    await surfaceOf(panel).focus();
    const scope = await scopeOf(panel).innerText();
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();

    await page.keyboard.press('m');
    await page.keyboard.press('z');
    await pressPrimary(page, 'KeyA');
    await expect(
      page.locator('.ag-live-regions', { hasText: 'Close the dialogue to use that shortcut.' }),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    await expect(panel.getByRole('list', { name: 'Markers' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Zoom', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(scopeOf(panel)).toHaveText(scope);
  });
});

test.describe('a pen', () => {
  /** Presses and releases at a point, as a pen with tilt and pressure. */
  async function penTap(page: Page, at: { x: number; y: number }): Promise<void> {
    const client = await page.context().newCDPSession(page);
    const common = {
      x: at.x,
      y: at.y,
      button: 'left' as const,
      clickCount: 1,
      pointerType: 'pen' as const,
      tiltX: 12,
      tiltY: -8,
    };

    await client.send('Input.dispatchMouseEvent', { ...common, type: 'mousePressed', force: 0.7 });
    await client.send('Input.dispatchMouseEvent', { ...common, type: 'mouseReleased', force: 0 });
    await client.detach();
  }

  test('presses a control, and the browser reports the pressure and the tilt', async ({ page }) => {
    // REQ-UX-068 is about pressure and tilt, and this asserted only that the
    // press was a pen: the force and the angles the test sends were never read
    // back, so a browser that dropped them would have passed.
    await openFresh(page);
    const presses = await recordPresses(page);

    await penTap(page, await centreOf(page.getByRole('button', { name: 'Commands' })));

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeVisible();

    const [press] = await presses();
    expect(press?.kind).toBe('pen');
    expect(press?.pressure).toBeCloseTo(0.7, 1);
    expect(press?.tiltX).toBe(12);
    expect(press?.tiltY).toBe(-8);
  });

  test('opens a menu and chooses from it, and the browser reports a pen pressing', async ({
    page,
  }) => {
    // This test asserted only the outcome, so a pen tap the browser delivered
    // as a mouse press would have passed it; the helper promises a pen with
    // pressure, and now the page is asked what it received.
    await openFresh(page);
    const presses = await recordPresses(page);

    await penTap(page, await centreOf(menuBarMenu(page, 'View')));

    const entry = page.getByRole('menuitem', { name: 'Use the light theme' });
    await expect(entry).toBeVisible();

    await penTap(page, await centreOf(entry));

    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');

    const received = await presses();
    expect(received.map((press) => press.kind)).toEqual(['pen', 'pen']);
    for (const press of received) expect(press.pressure).toBeCloseTo(0.7, 1);
  });

  test('runs the command a palette row names, which is the only pointer route to some', async ({
    page,
  }) => {
    // The palette refuses a press so that focus stays in the search field, and
    // a refused press takes the click an engine synthesises from a tap with
    // it. The refusal named touch alone, so a pencil reached it and the row
    // ran nothing: the palette is the only pointer route to a command that is
    // on no menu. A pencil is delivered through the same pipeline as a finger
    // and reports `pen`, and this is the one engine a pen can be driven on.
    await openFresh(page);
    const presses = await recordPresses(page);

    await openPalette(page);
    await page.getByRole('combobox', { name: 'Search commands' }).fill('Use the light theme');

    const row = page.getByRole('option', { name: /Use the light theme/ });
    await expect(row).toBeVisible();
    await penTap(page, await centreOf(row));

    await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeHidden();
    await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
    expect((await presses()).map((press) => press.kind)).toContain('pen');
  });
});

test.describe('a display with a notch and rounded corners', () => {
  test('keeps every control out of the unsafe edges', async ({ page }) => {
    // The page asks to be drawn to the edges and nothing kept the shell out
    // of them, so the menus sat under a notch and the status bar under a home
    // indicator.
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 30, left: 24, right: 24, bottom: 20 },
    });
    await openFresh(page);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (viewport === null) return;

    const menu = await page.getByRole('menubar').getByRole('menuitem').first().boundingBox();
    const status = await page.locator('.ag-status-item').first().boundingBox();
    const workspace = await page.locator('.ag-workspace > *').first().boundingBox();
    const bar = await page.locator('.ag-menu-bar').boundingBox();

    expect(menu?.y).toBeGreaterThanOrEqual(30);
    expect(menu?.x).toBeGreaterThanOrEqual(24);
    expect((status?.y ?? 0) + (status?.height ?? 0)).toBeLessThanOrEqual(viewport.height - 20);
    expect(workspace?.x).toBeGreaterThanOrEqual(24);
    expect((workspace?.x ?? 0) + (workspace?.width ?? 0)).toBeLessThanOrEqual(viewport.width - 24);

    // The bar itself still reaches the edges, which is why drawing to them is
    // worth asking for.
    expect(bar?.x).toBe(0);
    expect(bar?.y).toBe(0);
  });
});

test.describe('the dock built again by a command', () => {
  /** The contents of the group showing the Transport panel, which scroll. */
  function transportContents(page: Page) {
    return page.getByRole('tabpanel', { name: 'Transport' });
  }

  test('keeps how far a panel was scrolled', async ({ page }) => {
    await openFresh(page);
    const contents = transportContents(page);
    await contents.evaluate((element) => {
      element.scrollTop = 120;
    });
    const scrolled = await contents.evaluate((element) => element.scrollTop);
    expect(scrolled).toBeGreaterThan(0);

    // Opening a panel elsewhere builds the dock again.
    await openPalette(page);
    await page.getByRole('combobox', { name: 'Search commands' }).fill('Show the Picture panel');
    await page.getByRole('option', { name: /^Show the Picture panel/u }).click();
    await expect(page.getByRole('heading', { name: 'Picture', exact: true })).toBeVisible();

    await expect
      .poll(async () => await transportContents(page).evaluate((element) => element.scrollTop))
      .toBe(scrolled);
  });

  test('takes the keyboard with the panel a command moved', async ({ page }) => {
    await openFresh(page);
    await transportContents(page).focus();

    await openPalette(page);
    await page
      .getByRole('combobox', { name: 'Search commands' })
      .fill('Move this panel to the right');
    await page.getByRole('option', { name: /^Move this panel to the right/u }).click();

    await expect(transportContents(page)).toBeFocused();
  });
});
