import { expect, type Locator, type Page } from '@playwright/test';

import {
  editorPanel,
  editorPanels,
  openAsset,
  pointAt,
  readingOf,
  runCommand,
  samplesInPixelOf,
  scopeOf,
  shownOf,
  surfaceOf,
  writeTimesAs,
} from './editor.js';
import { menuBarMenu } from './shell.js';
import { test } from './test.js';

/**
 * The editor's timeline, driven as a person drives it (the packet's
 * `test:e2e:timeline`): zooming to single samples and selecting one, snapping
 * to a marker, and two views of one asset keeping their own zoom while
 * sharing a marker added in either (REQ-EDIT-012, REQ-EDIT-013,
 * REQ-EDIT-061).
 */

/** Presses a key in `panel`'s surface until `done` holds, at most `most` times. */
async function pressUntil(
  surface: Locator,
  key: string,
  done: () => Promise<boolean>,
  most = 60,
): Promise<void> {
  for (let press = 0; press < most && !(await done()); press += 1) await surface.press(key);
  expect(await done()).toBe(true);
}

/** Drags on the page from `from` to `to` with the mouse, in steps. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test.describe('the editor timeline', () => {
  test('zooms to single samples and selects exactly one', async ({ page }) => {
    const panel = await openAsset(page, 'Tone bursts');
    await writeTimesAs(page, panel, 'Samples');
    const surface = surfaceOf(panel);

    await test.step('The playhead goes where it is clicked, and the view zooms in on it', async () => {
      const at = await pointAt(panel, 120_000);
      await page.mouse.click(at.x, at.y);
      await expect(readingOf(panel, 'Playhead')).toHaveText(/^1[12]\d,\d{3}$/u);
      await pressUntil(surface, 'ArrowUp', async () => (await samplesInPixelOf(panel)) === 1 / 256);
      await expect(readingOf(panel, 'Zoom')).toHaveText('256 pixels a sample');
    });

    await test.step('A drag across one sample selects that sample and no other', async () => {
      await surface.press('s');
      await expect(panel.getByRole('button', { name: 'Snap' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      const { start } = await shownOf(panel);
      const first = start + 1;
      const from = await pointAt(panel, first);
      const to = await pointAt(panel, first + 1);
      await drag(page, { x: from.x + 1, y: from.y }, { x: to.x + 1, y: to.y });
      await expect(scopeOf(panel)).toHaveText(
        `${first.toLocaleString('en-GB')} to ${(first + 1).toLocaleString('en-GB')} on channel Left`,
      );
    });

    await test.step('Zooming back out keeps the selection', async () => {
      const selected = await scopeOf(panel).innerText();
      await pressUntil(surface, 'ArrowDown', async () => (await samplesInPixelOf(panel)) >= 256);
      await expect(scopeOf(panel)).toHaveText(selected);
    });
  });

  test('snaps the start of a selection to a marker near the pointer', async ({ page }) => {
    const panel = await openAsset(page, 'Loop with markers');
    await writeTimesAs(page, panel, 'Samples');
    // A zero crossing nearer the pointer than the marker would win by the
    // snapping rule; the tone crosses zero every 64 samples, so it is off.
    await runCommand(page, 'Snap to zero crossings');
    const surface = surfaceOf(panel);
    await surface.focus();
    await pressUntil(surface, 'ArrowUp', async () => (await samplesInPixelOf(panel)) <= 64);
    // The Sustain marker at 4,800 in sight, a hundred pixels in.
    await page.getByRole('button', { name: 'Sustain at 4,800' }).click();
    await surface.press('Home');
    const sustain = await pointAt(panel, 4_800);
    const later = await pointAt(panel, 4_800 + 60 * (await samplesInPixelOf(panel)));

    await drag(page, { x: sustain.x + 3, y: sustain.y }, later);

    await expect(scopeOf(panel)).toHaveText(/^4,800 to [\d,]+ on channel Left$/u);
  });

  test('selects time and moves a marker from the keyboard alone', async ({ page }) => {
    // The keyboard grew a selection a sample a press and could not move a
    // marker at all.
    const panel = await openAsset(page, 'Loop with markers');
    await writeTimesAs(page, panel, 'Samples');
    const surface = surfaceOf(panel);
    await surface.focus();
    // Onto a rung, a whole number of samples a pixel, which the readout writes
    // exactly: fitted to the width, the zoom is between two.
    await surface.press('ArrowUp');
    const perPixel = await samplesInPixelOf(panel);

    const whole = (value: number) => value.toLocaleString('en-GB');
    const selected = async (start: number, end: number) => {
      await expect(scopeOf(panel)).toHaveText(`${whole(start)} to ${whole(end)} on every channel`);
    };

    await surface.press('Home');
    await surface.press('ArrowRight');
    for (let press = 0; press < 3; press += 1) await surface.press('Shift+ArrowRight');
    await selected(perPixel, 4 * perPixel);

    // Out at the playhead two pixels on, then in at the start.
    await surface.press('ArrowRight');
    await surface.press('ArrowRight');
    await surface.press('o');
    await selected(perPixel, 6 * perPixel);
    await surface.press('Home');
    await surface.press('i');
    await selected(0, 6 * perPixel);

    await page.getByRole('button', { name: 'Sustain at 4,800' }).click();
    await surface.focus();
    await surface.press('Alt+ArrowRight');
    await expect(
      page.getByRole('button', { name: `Sustain at ${whole(4_800 + perPixel)}` }),
    ).toBeVisible();
  });

  test('keeps two views of one asset apart in zoom, and one in their markers', async ({ page }) => {
    await openAsset(page, 'Tone bursts');
    await menuBarMenu(page, 'Editor').click();
    await page.getByRole('menuitem', { name: 'Open another view of this asset' }).click();
    await expect(editorPanels(page)).toHaveCount(2);

    const second = editorPanels(page)
      .filter({ has: page.locator('.ag-editor-asset-name') })
      .last();
    await expect(second.locator('.ag-editor-asset-name')).toHaveText('Tone bursts');
    const firstZoom = await readingOf(editorPanel(page), 'Zoom').innerText();

    await second.getByRole('button', { name: 'Zoom in' }).click();
    await second.getByRole('button', { name: 'Zoom in' }).click();
    await expect(readingOf(second, 'Zoom')).not.toHaveText(firstZoom);

    await surfaceOf(second).focus();
    await surfaceOf(second).press('m');

    await page.getByRole('tab', { name: 'Editor', exact: true }).first().click();
    const first = editorPanel(page);
    await expect(readingOf(first, 'Zoom')).toHaveText(firstZoom);
    await expect(first.getByRole('list', { name: 'Markers' })).toContainText('Marker 1 at');

    await test.step('The split main area comes back split, each view as it was', async () => {
      const secondZoom = await readingOf(second, 'Zoom').innerText();
      await page.reload();
      await expect(editorPanels(page)).toHaveCount(2);
      await expect(readingOf(editorPanel(page, 0), 'Zoom')).toHaveText(firstZoom);
      await expect(readingOf(editorPanel(page, 1), 'Zoom')).toHaveText(secondZoom);
    });
  });
});
