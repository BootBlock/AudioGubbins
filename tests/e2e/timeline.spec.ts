import { expect, type Locator, type Page } from '@playwright/test';

import { sine, stereo, wavFile } from '../../packages/test-fixtures/src/index.js';
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
import { makeProject } from './hearing.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * The editor's timeline, driven as a person drives it (the packet's
 * `test:e2e:timeline`): zooming to single samples and selecting one, snapping
 * to a marker, and two views of one asset keeping their own zoom while
 * sharing a marker added in either (REQ-EDIT-012, REQ-EDIT-013,
 * REQ-EDIT-061).
 *
 * Markers are a project's (ADR-0047), so the tests that place or read one do
 * it on a sound imported into a project, and the test sounds the Editor panel
 * offers, which take none, serve the tests that need no marker.
 */

/** The sample rate of the sound the marker tests import. */
const RATE = 48_000;

/**
 * Six seconds of stereo tone, 375 Hz on the left and 750 Hz on the right, as a
 * WAV file's bytes. At 48 kHz the left channel crosses zero every 64 samples.
 */
const TONE_WAV = wavFile(
  stereo(
    sine(375, { sampleRate: RATE, length: 6 * RATE, amplitude: 0.5 }),
    sine(750, { sampleRate: RATE, length: 6 * RATE, amplitude: 0.4 }),
  ),
);

/** Where the marker the snapping and keyboard tests act on is placed. */
const SUSTAIN = 4_800;

/** The name the editor gives the second marker placed, the one at {@link SUSTAIN}. */
const SUSTAIN_NAME = 'Marker 2';

/**
 * Opens AudioGubbins afresh, makes a project and imports {@link TONE_WAV} into
 * it as `name`, which opens it in the Editor panel.
 *
 * Playwright cannot answer the File System Access pickers Chromium offers, so
 * the page is given a browser without them, and the file is chosen through the
 * file input the application falls back to.
 */
async function openImported(page: Page, name: string): Promise<Locator> {
  await page.addInitScript(() => {
    for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
      Reflect.deleteProperty(window, picker);
    }
  });
  await openFresh(page);
  await makeProject(page, 'Timeline');
  const choosing = page.waitForEvent('filechooser');
  await menuBarMenu(page, 'File').click();
  await page.getByRole('menuitem', { name: 'Import audio…' }).click();
  await (
    await choosing
  ).setFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(TONE_WAV) });
  await expect(page.getByText(`“${name}” is imported and open.`).first()).toBeVisible();
  const panel = editorPanel(page);
  await expect(panel.locator('.ag-editor-asset-name')).toHaveText(name);
  await expect(surfaceOf(panel)).toBeVisible();
  return panel;
}

/**
 * Places a marker at sample `at` of `panel`'s asset from the keyboard, as a
 * person places one exactly: onto a zoom whose pixel `at` is a whole number
 * of, the playhead stepped there a pixel a press, and `m`. The view is then
 * fitted to the asset again and the playhead put back at its start, as the
 * asset opened.
 */
async function markAt(panel: Locator, at: number): Promise<void> {
  const surface = surfaceOf(panel);
  await surface.focus();
  // Onto a rung first: fitted to the width, the zoom is between two.
  await surface.press('ArrowUp');
  await pressUntil(surface, 'ArrowUp', async () =>
    Number.isInteger(at / (await samplesInPixelOf(panel))),
  );
  const steps = at / (await samplesInPixelOf(panel));
  await surface.press('Home');
  for (let press = 0; press < steps; press += 1) await surface.press('ArrowRight');
  await expect(readingOf(panel, 'Playhead')).toHaveText(at.toLocaleString('en-GB'));
  await surface.press('m');
  await expect(panel.getByRole('list', { name: 'Markers' })).toContainText(
    ` at ${at.toLocaleString('en-GB')}`,
  );
  await surface.press('f');
  await surface.press('Home');
}

/** Opens the tone in a project, marked at its start and at {@link SUSTAIN}, read in samples. */
async function openMarked(page: Page): Promise<Locator> {
  const panel = await openImported(page, 'Sustained tone');
  await writeTimesAs(page, panel, 'Samples');
  await markAt(panel, 0);
  await markAt(panel, SUSTAIN);
  await expect(
    page.getByRole('button', { name: `${SUSTAIN_NAME} at ${SUSTAIN.toLocaleString('en-GB')}` }),
  ).toBeVisible();
  return panel;
}

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
    const panel = await openMarked(page);
    // A zero crossing nearer the pointer than the marker would win by the
    // snapping rule; the tone crosses zero every 64 samples, so it is off.
    await runCommand(page, 'Snap to zero crossings');
    const surface = surfaceOf(panel);
    await surface.focus();
    await pressUntil(surface, 'ArrowUp', async () => (await samplesInPixelOf(panel)) <= 64);
    // The marker at 4,800 in sight, a hundred pixels in.
    await page.getByRole('button', { name: `${SUSTAIN_NAME} at 4,800` }).click();
    await surface.press('Home');
    const sustain = await pointAt(panel, SUSTAIN);
    const later = await pointAt(panel, SUSTAIN + 60 * (await samplesInPixelOf(panel)));

    await drag(page, { x: sustain.x + 3, y: sustain.y }, later);

    await expect(scopeOf(panel)).toHaveText(/^4,800 to [\d,]+ on channel Left$/u);
  });

  test('selects time and moves a marker from the keyboard alone', async ({ page }) => {
    // The keyboard grew a selection a sample a press and could not move a
    // marker at all.
    const panel = await openMarked(page);
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

    await page.getByRole('button', { name: `${SUSTAIN_NAME} at 4,800` }).click();
    await surface.focus();
    await surface.press('Alt+ArrowRight');
    await expect(
      page.getByRole('button', { name: `${SUSTAIN_NAME} at ${whole(SUSTAIN + perPixel)}` }),
    ).toBeVisible();
  });

  test('keeps two views of one asset apart in zoom, and one in their markers', async ({ page }) => {
    await openImported(page, 'Sustained tone');
    await menuBarMenu(page, 'Editor').click();
    await page.getByRole('menuitem', { name: 'Open another view of this asset' }).click();
    await expect(editorPanels(page)).toHaveCount(2);

    const second = editorPanels(page)
      .filter({ has: page.locator('.ag-editor-asset-name') })
      .last();
    await expect(second.locator('.ag-editor-asset-name')).toHaveText('Sustained tone');
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

test.describe('the editor timeline on a wide display', () => {
  // A view wide enough that at 256 samples a pixel, which a zoom step reaches,
  // it shows more than the widest window a view reading samples could once
  // have, so a view that asked again for a window it cannot get would never
  // rest.
  test.use({ viewport: { width: 7600, height: 900 }, deviceScaleFactor: 2 });

  test('zooms and scrolls a three-hour session through every level, and rests when still', async ({
    page,
  }) => {
    // Every level of a three-hour session, each waited on until it rests.
    test.setTimeout(300_000);
    await page.addInitScript(() => {
      const counted = window.requestAnimationFrame.bind(window);
      Object.assign(window, { framesAsked: 0 });
      window.requestAnimationFrame = (callback) => {
        Object.assign(window, { framesAsked: Number(Reflect.get(window, 'framesAsked')) + 1 });
        return counted(callback);
      };
    });
    const panel = await openAsset(page, 'Three-hour session');
    const surface = surfaceOf(panel);
    const width = (await surface.boundingBox())?.width ?? 0;
    expect(width * 256).toBeGreaterThan(1_048_576);
    /**
     * Whether the page comes to rest: asks for no more than a frame or two in
     * a second, within half a minute, as the peaks of what it shows arrive.
     */
    const rests = async (): Promise<boolean> => {
      const asked = () => page.evaluate(() => Number(Reflect.get(window, 'framesAsked')));
      for (const started = Date.now(); Date.now() - started < 30_000;) {
        const before = await asked();
        await page.waitForTimeout(1000);
        if ((await asked()) - before <= 2) return true;
      }
      return false;
    };

    await surface.focus();
    for (let step = 0; (await samplesInPixelOf(panel)) > 1 / 16; step += 1) {
      expect(step).toBeLessThan(80);
      await surface.press('ArrowUp');
      const zoom = await samplesInPixelOf(panel);
      if (zoom < 2 ** 11) {
        await surface.press('PageDown');
        expect(await rests(), `at ${String(zoom)} samples a pixel`).toBe(true);
      }
    }
  });
});
