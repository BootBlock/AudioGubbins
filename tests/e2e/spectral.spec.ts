import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';

import { sine, wavFile, type SignalFixture } from '../../packages/test-fixtures/src/index.js';
import { buildPresets, PanelKinds } from '../../packages/workspace/src/presets.js';
import { listedName } from '../../packages/workspace/src/workspace-name.js';
import {
  editorPanel,
  pointAt,
  runCommand,
  samplesInPixelOf,
  surfaceBoxOf,
  surfaceOf,
  writeTimesAs,
} from './editor.js';
import { banner, makeProject, panelTitled, said } from './hearing.js';
import { alike, pixelOf, rendererReport, shownOver, type Rgb, type Shown } from './renderer.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * Spectral editing, driven in a real browser as a person drives it (the
 * packet's `test:e2e:spectral`, REQ-AUDIO-016, ADR-0080, ADR-0081, ADR-0082):
 * a sound holding a steady tone and a burst is imported into a project and
 * opened in the Spectral Repair workspace; an area is selected with the
 * spectral marquee and another from the keyboard, each read back from its
 * description in words; the first is attenuated and the second healed, the
 * Spectral panel and the Inspector listing both; the latest is compared with
 * the state before it; both are undone and redone, and found again with their
 * history after a reload. The spectrogram is drawn by Canvas 2D, since the
 * project's browser has WebGL switched off, and is read from the page's
 * pixels, the attenuated area darker once its tiles are analysed again. The
 * lasso and the brush, the brush at a fixed strength, draw the same mask from
 * the same stroke, whatever the pen's pressure.
 *
 * Playwright cannot answer the File System Access pickers Chromium offers, so
 * the page is given a browser without them, and the file is chosen through the
 * file input the application falls back to.
 */

const RATE = 48_000;
const LENGTH = 4 * RATE;

/** The steady tone, heard throughout, and the burst over it. */
const TONE_HZ = 440;
const BURST_HZ = 3_000;
const BURST = { start: 1.5 * RATE, end: 2.5 * RATE } as const;

/** The name the sound is imported under. */
const NAME = 'Harbour hum';

/**
 * Four seconds of mono: a steady 440 Hz tone, with a 3 kHz burst over it from
 * 1.5 to 2.5 seconds. One channel, so the view draws one lane.
 */
const HUM: SignalFixture = {
  ...sine(TONE_HZ, { sampleRate: RATE, length: LENGTH }),
  name: 'harbour-hum',
  channels: [
    Float32Array.from(
      { length: LENGTH },
      (_, frame) =>
        0.3 * Math.sin((2 * Math.PI * TONE_HZ * frame) / RATE) +
        (frame >= BURST.start && frame < BURST.end
          ? 0.3 * Math.sin((2 * Math.PI * BURST_HZ * frame) / RATE)
          : 0),
    ),
  ],
};

/** The area the marquee draws over the burst, in samples and hertz. */
const MARQUEE = { start: 1.6 * RATE, end: 2.4 * RATE, low: 2_000, high: 4_500 } as const;

/** The decibels the marqueed area is attenuated by: far enough to see. */
const ATTENUATION = -48;

/** The Workspace menu's entry for the Spectral Repair preset, as the menu writes it. */
const SPECTRAL_REPAIR = (() => {
  const preset = buildPresets(new Set(Object.values(PanelKinds))).find(
    (one) => one.displayName === 'Spectral Repair',
  );
  if (preset === undefined) throw new Error('No preset is called Spectral Repair.');
  return listedName(preset);
})();

/**
 * Opens AudioGubbins afresh, makes a project, opens the Spectral Repair
 * workspace, imports {@link HUM} into the project and shows it as a
 * spectrogram, its positions written in samples.
 */
async function openRepairing(page: Page): Promise<Locator> {
  await page.addInitScript(() => {
    for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
      Reflect.deleteProperty(window, picker);
    }
  });
  await openFresh(page);
  await makeProject(page, 'Spectral repair');
  // A preset is a layout of fresh panels, its editor showing nothing, so the
  // workspace is chosen first and the sound imported into its editor.
  await useSpectralRepair(page);
  const choosing = page.waitForEvent('filechooser');
  await menuBarMenu(page, 'File').click();
  await page.getByRole('menuitem', { name: 'Import audio…' }).click();
  await (
    await choosing
  ).setFiles({ name: `${NAME}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(wavFile(HUM)) });
  await expect(page.getByText(`“${NAME}” is imported and open.`).first()).toBeVisible();
  const panel = editorPanel(page);
  await expect(panel.locator('.ag-editor-asset-name')).toHaveText(NAME);
  await writeTimesAs(page, panel, 'Samples');
  await runCommand(page, 'Show as spectrogram');
  return panel;
}

/** Chooses the Spectral Repair workspace from the Workspace menu. */
async function useSpectralRepair(page: Page): Promise<void> {
  await menuBarMenu(page, 'Workspace').click();
  await page.getByRole('menuitem', { name: SPECTRAL_REPAIR, exact: true }).click();
  await expect(page.locator('.ag-status-bar')).toContainText('Spectral Repair');
  await expect(spectralPanel(page)).toBeVisible();
}

/** The polite live region saying what matches `text`, as `said` waits for a sentence. */
function liveStatus(page: Page, text: RegExp): Locator {
  return page.locator('.ag-live-regions [role="status"]').filter({ hasText: text });
}

/** The Spectral panel. */
function spectralPanel(page: Page): Locator {
  return panelTitled(page, 'Spectral');
}

/** Brings the tab titled `title` of the right-hand group to the front. */
async function showTab(page: Page, title: string): Promise<void> {
  await page.getByRole('tab', { name: title, exact: true }).click();
  await expect(panelTitled(page, title)).toBeVisible();
}

/** The Spectral panel's description of the spectral selection. */
function descriptionOf(page: Page): Locator {
  return spectralPanel(page).locator('.ag-spectral-description');
}

/** The spectral edits the Spectral panel lists, each in the Inspector's words. */
function spectralEditsListed(page: Page): Locator {
  return spectralPanel(page)
    .getByRole('heading', { name: 'Spectral edits' })
    .locator('xpath=following-sibling::ol[1]/li/span[1]');
}

/** The asset's edits the Inspector lists. */
function inspectorEditsListed(page: Page): Locator {
  return panelTitled(page, 'Inspector')
    .getByRole('heading', { name: 'Its edits' })
    .locator('xpath=following-sibling::*[1]')
    .getByRole('listitem');
}

/** The one lane of `panel`'s mono view, on the page: its top and its height. */
async function laneOf(panel: Locator): Promise<{ top: number; height: number }> {
  const box = await surfaceBoxOf(panel);
  // Inside the surface's border, below the ruler and the marker strip.
  return { top: box.y + 1 + 42, height: box.height - 2 - 42 };
}

/** The height `frequency` is drawn at in `lane`, on the view's default axis of octaves. */
function heightOf(lane: { top: number; height: number }, frequency: number): number {
  return lane.top + lane.height * (1 - Math.log(frequency / 20) / Math.log(20_000 / 20));
}

/** Where position `position` at `frequency` is drawn on `panel`'s spectrogram. */
async function spotOf(
  panel: Locator,
  position: number,
  frequency: number,
): Promise<{ x: number; y: number }> {
  const { x } = await pointAt(panel, position);
  return { x, y: heightOf(await laneOf(panel), frequency) };
}

/** Drags with the mouse through `points`, in steps between each. */
async function dragThrough(page: Page, points: readonly { x: number; y: number }[]): Promise<void> {
  const [first, ...rest] = points;
  if (first === undefined) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(point.x, point.y, { steps: 8 });
  await page.mouse.up();
}

/** Runs one of the Spectral panel's buttons. */
async function press(page: Page, label: string): Promise<void> {
  await spectralPanel(page).getByRole('button', { name: label, exact: true }).click();
}

/** A whole number as the panel writes one, grouped: `24,000`. */
function wholeOf(text: string): number {
  return Number(text.replaceAll(',', ''));
}

/** A frequency as the panel writes one, `440 Hz` or `4.5 kHz`, in hertz. */
function hertzOf(text: string): number {
  const [value = '', unit] = text.split(' ');
  return wholeOf(value) * (unit === 'kHz' ? 1000 : 1);
}

/** The area a description of a spectral selection, or a spectral edit's words, states. */
interface Area {
  readonly start: number;
  readonly end: number;
  readonly low: number;
  readonly high: number;
}

const FREQUENCY = String.raw`[\d,.]+ k?Hz`;

/** The area `text` states, as `76,800 to 115,200, 2 kHz to 4.5 kHz`. */
function areaOf(text: string): Area {
  const found = new RegExp(
    String.raw`([\d,]+) to ([\d,]+), (${FREQUENCY}) to (${FREQUENCY})`,
    'u',
  ).exec(text);
  if (found === null) throw new Error(`No area is stated in: ${text}`);
  const [, start = '', end = '', low = '', high = ''] = found;
  return { start: wholeOf(start), end: wholeOf(end), low: hertzOf(low), high: hertzOf(high) };
}

/**
 * Checks `area` is `expected` to within `slack` samples in time, which is a
 * pixel or two of the pointer, and three per cent in frequency, which is a
 * rounded figure and half a pixel of the axis.
 */
function expectAreaNear(area: Area, expected: Area, slack: number): void {
  expect(Math.abs(area.start - expected.start), `${String(area.start)} starts`).toBeLessThanOrEqual(
    slack,
  );
  expect(Math.abs(area.end - expected.end), `${String(area.end)} ends`).toBeLessThanOrEqual(slack);
  expect(area.low / expected.low).toBeGreaterThan(0.97);
  expect(area.low / expected.low).toBeLessThan(1.03);
  expect(area.high / expected.high).toBeGreaterThan(0.97);
  expect(area.high / expected.high).toBeLessThan(1.03);
}

/** The description of a selection of one shape `kind` over every channel, with hard edges. */
function describedAs(kind: string): RegExp {
  return new RegExp(
    String.raw`^An area from [\d,]+ to [\d,]+, ${FREQUENCY} to ${FREQUENCY}, on every channel\. ` +
      String.raw`It is made of a ${kind}\. Its rectangles and lasso shapes have hard edges\. ` +
      String.raw`It is what an edit acts on now\.$`,
    'u',
  );
}

/** Selects the area {@link MARQUEE} names with the spectral marquee, and gives what it says. */
async function marqueeOverBurst(page: Page, panel: Locator): Promise<string> {
  await press(page, 'Spectral marquee');
  await expect(spectralPanel(page)).toContainText('The spectral marquee is in use.');
  const from = await spotOf(panel, MARQUEE.start, MARQUEE.high);
  const to = await spotOf(panel, MARQUEE.end, MARQUEE.low);
  await dragThrough(page, [from, to]);
  await expect(descriptionOf(page)).toHaveText(describedAs('rectangle'));
  const description = await descriptionOf(page).innerText();
  expectAreaNear(areaOf(description), MARQUEE, 2 * (await samplesInPixelOf(panel)));
  return description;
}

/** Attenuates the spectral selection by {@link ATTENUATION} from the Spectral panel. */
async function attenuate(page: Page): Promise<void> {
  await spectralPanel(page)
    .getByRole('textbox', { name: 'Attenuate by, in decibels' })
    .fill(String(ATTENUATION));
  await press(page, 'Attenuate');
  await said(page, `Attenuated an area of ${NAME} by −${String(-ATTENUATION)} dB.`);
}

/** How bright a colour is: the sum of its channels. */
function brightness(colour: Rgb): number {
  return colour[0] + colour[1] + colour[2];
}

/** The colours the page shows at `spots`, read from one picture of `panel`'s surface. */
async function coloursAt(
  page: Page,
  panel: Locator,
  spots: readonly { x: number; y: number }[],
): Promise<readonly Rgb[]> {
  const shown = await shownOver(page, surfaceOf(panel));
  return spots.map(({ x, y }) => pixelOf(shown, x, y));
}

/** A box on the page, in CSS pixels. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The pixels of `shown` inside `box`, row by row. */
function pixelsWithin(shown: Shown, box: Box): readonly Rgb[] {
  const pixels: Rgb[] = [];
  const step = 1 / shown.scale;
  for (let y = box.top; y < box.bottom; y += step) {
    for (let x = box.left; x < box.right; x += step) pixels.push(pixelOf(shown, x, y));
  }
  return pixels;
}

/** How many of two pictures' pixels differ by more than compositing rounds. */
function differing(one: readonly Rgb[], other: readonly Rgb[]): number {
  return one.filter((pixel, index) => !alike(pixel, other[index] ?? [0, 0, 0])).length;
}

/** The box around `points`, `margin` CSS pixels wider each way. */
function boxAround(points: readonly { x: number; y: number }[], margin: number): Box {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  return {
    left: Math.min(...xs) - margin,
    top: Math.min(...ys) - margin,
    right: Math.max(...xs) + margin,
    bottom: Math.max(...ys) + margin,
  };
}

/**
 * Waits until `panel` draws the spectrogram of {@link HUM} under the burst:
 * the burst's 3 kHz brighter than 8 kHz, which holds nothing, at its middle.
 * Until then the lane is pending, or its tiles are on their way.
 */
async function expectBurstDrawn(page: Page, panel: Locator): Promise<void> {
  const middle = (BURST.start + BURST.end) / 2;
  await expect(async () => {
    const [burst, above] = await coloursAt(page, panel, [
      await spotOf(panel, middle, BURST_HZ),
      await spotOf(panel, middle, 8_000),
    ]);
    expect(brightness(burst ?? [0, 0, 0])).toBeGreaterThan(brightness(above ?? [0, 0, 0]) + 150);
  }).toPass({ timeout: 30_000 });
}

/**
 * A pen stroke through `points` at `force`, sent as the browser's own pen
 * events through the DevTools protocol, as a pen tablet sends them.
 */
async function penStroke(
  page: Page,
  points: readonly { x: number; y: number }[],
  force: number,
): Promise<void> {
  const session: CDPSession = await page.context().newCDPSession(page);
  const pen = { button: 'left' as const, clickCount: 1, pointerType: 'pen' as const };
  const [first, ...rest] = points;
  if (first === undefined) return;
  await session.send('Input.dispatchMouseEvent', { ...pen, ...first, type: 'mousePressed', force });
  for (const point of rest) {
    await session.send('Input.dispatchMouseEvent', { ...pen, ...point, type: 'mouseMoved', force });
  }
  const last = rest.at(-1) ?? first;
  await session.send('Input.dispatchMouseEvent', {
    ...pen,
    ...last,
    type: 'mouseReleased',
    force: 0,
  });
  await session.detach();
}

/** The points of a straight stroke from `from` to `to`, a point every four CSS pixels. */
function strokeBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
): readonly { x: number; y: number }[] {
  const count = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4);
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: from.x + ((to.x - from.x) * index) / count,
    y: from.y + ((to.y - from.y) * index) / count,
  }));
}

test.describe('spectral editing', () => {
  test('selects areas by marquee and keyboard, attenuates and heals, compares, undoes and finds it all after a reload', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const panel = await openRepairing(page);
    await expect(descriptionOf(page)).toHaveText('No area of time and frequency is selected.');

    const marqueed =
      await test.step('The marquee selects the area it is dragged over', async () => {
        const description = await marqueeOverBurst(page, panel);
        // The description a screen reader is told is the one the panel shows.
        await runCommand(page, 'Describe the spectral selection');
        await said(page, description);
        return areaOf(description);
      });

    const attenuated =
      await test.step('The area is attenuated, and listed in its words', async () => {
        await attenuate(page);
        await expect(spectralEditsListed(page)).toHaveCount(1);
        const words = await spectralEditsListed(page).first().innerText();
        expect(words).toMatch(
          new RegExp(
            String.raw`^Attenuated an area by −${String(-ATTENUATION)} dB, .+, a rectangle, in frames of 2,048 samples, from [\d,]+ to [\d,]+$`,
            'u',
          ),
        );
        // The edit acts on the area selected, its mask stated from its own range.
        expect(areaOf(words)).toEqual(marqueed);
        await showTab(page, 'Inspector');
        await expect(inspectorEditsListed(page)).toHaveText([words]);
        await showTab(page, 'Spectral');
        return words;
      });

    const healed = await test.step('An area selected from the keyboard is healed', async () => {
      const surface = surfaceOf(panel);
      await surface.focus();
      // A stretch of the steady tone after the burst, chosen with the playhead.
      await surface.press('End');
      for (let step = 0; step < 80; step += 1) await surface.press('ArrowLeft');
      for (let step = 0; step < 30; step += 1) await surface.press('Shift+ArrowLeft');
      // Where the keys left the playhead is said once they stop.
      await expect(liveStatus(page, /^Playhead at [\d,]+\.$/u)).toHaveCount(1);
      await runCommand(page, 'Select a band of frequencies over the time selection');
      await expect(descriptionOf(page)).toHaveText(describedAs('rectangle'));
      const band = areaOf(await descriptionOf(page).innerText());
      expect(band.start).toBeGreaterThan(BURST.end);
      expect([band.low, band.high]).toEqual([20, 20_000]);

      // Narrowed in frequency a step at a time, about the band's middle.
      await runCommand(page, 'Narrow the spectral selection in frequency');
      await runCommand(page, 'Narrow the spectral selection in frequency');
      const narrowed = areaOf(await descriptionOf(page).innerText());
      expect(narrowed.low).toBeGreaterThan(band.low);
      expect(narrowed.high).toBeLessThan(band.high);
      expect([narrowed.start, narrowed.end]).toEqual([band.start, band.end]);
      await runCommand(page, 'Widen the spectral selection in time');
      const widened = areaOf(await descriptionOf(page).innerText());
      expect(widened.start).toBeLessThan(band.start);
      expect(widened.end).toBeGreaterThan(band.end);

      await runCommand(page, 'Heal the spectral selection');
      await said(page, `Healed an area of ${NAME}.`);
      await expect(spectralEditsListed(page)).toHaveCount(2);
      const words = await spectralEditsListed(page).nth(1).innerText();
      expect(words).toMatch(
        /^Healed an area, .+, a rectangle, in frames of 2,048 samples, from [\d,]+ to [\d,]+$/u,
      );
      expect(areaOf(words)).toEqual(widened);
      await showTab(page, 'Inspector');
      await expect(inspectorEditsListed(page)).toHaveText([attenuated, words]);
      await showTab(page, 'Spectral');
      return words;
    });

    await test.step('The heal is compared with before it, side by side', async () => {
      await press(page, 'Compare with before the latest spectral edit');
      // The change is named as the history names it.
      await said(
        page,
        `Comparing the project as it is, side A, with before “Heal an area of “${NAME}””, side B. Side A is heard.`,
      );
      await runCommand(page, 'Show the History panel');
      const comparison = page.getByRole('group', { name: 'Comparison' });
      await expect(comparison).toContainText('Comparing two states');
      await expect(comparison).toContainText(/Side A, .+, is the one heard\./u);
      await comparison.getByRole('button', { name: 'Hear B', exact: true }).click();
      await expect(comparison).toContainText(/Side B, .+, is the one heard\./u);
      await expect(comparison.getByRole('button', { name: 'Hear B' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // Switching sides changes neither: the project still holds both edits.
      await showTab(page, 'Spectral');
      await expect(spectralEditsListed(page)).toHaveText([attenuated, healed]);
      // The same edit compared again from its own row is said to be compared already.
      await spectralPanel(page)
        .getByRole('listitem')
        .filter({ hasText: healed })
        .getByRole('button', { name: 'Compare with before it' })
        .click();
      await said(page, 'The project is being compared with before that spectral edit already.');
      await showTab(page, 'History');
      await comparison.getByRole('button', { name: 'Stop comparing', exact: true }).click();
      await expect(comparison).toBeHidden();
      await showTab(page, 'Spectral');
    });

    await test.step('Each edit is undone and redone', async () => {
      await runCommand(page, 'Undo');
      await expect(spectralEditsListed(page)).toHaveText([attenuated]);
      await runCommand(page, 'Undo');
      await expect(spectralPanel(page).getByText('None yet.')).toBeVisible();
      await runCommand(page, 'Redo');
      await expect(spectralEditsListed(page)).toHaveText([attenuated]);
      await runCommand(page, 'Redo');
      await expect(spectralEditsListed(page)).toHaveText([attenuated, healed]);
    });

    await test.step('After a reload, the edits and their history are as they were', async () => {
      await expect(
        page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
      ).toBeVisible();
      await page.reload();
      await expect(banner(page).getByText('“Spectral repair”', { exact: true })).toBeVisible();
      // The workspace comes back with its editor showing the sound as it did.
      await expect(page.locator('.ag-status-bar')).toContainText('Spectral Repair');
      await expect(editorPanel(page).locator('.ag-editor-asset-name')).toHaveText(NAME);
      await expect(editorPanel(page).getByRole('combobox', { name: 'Time' })).toContainText(
        'Samples',
      );
      // The panel in use was the Spectral panel, and the page keeps no record
      // of the editor in use beside it, so the person takes up the editor
      // again before the panels beside it follow it.
      await page.getByRole('tab', { name: 'Editor', exact: true }).click();
      await showTab(page, 'Spectral');
      await expect(spectralEditsListed(page)).toHaveText([attenuated, healed]);
      await showTab(page, 'Inspector');
      await expect(inspectorEditsListed(page)).toHaveText([attenuated, healed]);
      await showTab(page, 'Spectral');
      await runCommand(page, 'Undo');
      await expect(spectralEditsListed(page)).toHaveText([attenuated]);
      await runCommand(page, 'Redo');
      await expect(spectralEditsListed(page)).toHaveText([attenuated, healed]);
    });
  });

  test('draws the spectrogram with Canvas 2D, the attenuated area darker once analysed again', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const panel = await openRepairing(page);
    await runCommand(page, 'Show the Capabilities panel');
    await expect(rendererReport(page)).toContainText('Drawn with Canvas 2D.', { timeout: 15_000 });
    await expect(rendererReport(page)).toContainText('WebGL 2: not available');
    await showTab(page, 'Spectral');

    await expectBurstDrawn(page, panel);
    const middle = (BURST.start + BURST.end) / 2;
    const spots = async () => [
      await spotOf(panel, middle, BURST_HZ),
      // The steady tone under the area, which the edit does not reach.
      await spotOf(panel, middle, TONE_HZ),
      // The burst before the area begins, more than a window from where the
      // edit's frames reach, which is drawn from samples the edit leaves be.
      await spotOf(panel, BURST.start + 1_440, BURST_HZ),
    ];
    const before = await coloursAt(page, panel, await spots());

    await marqueeOverBurst(page, panel);
    await attenuate(page);
    // The selection's overlay is drawn over the area: cleared, the area is
    // seen as the spectrogram draws it.
    await press(page, 'Clear');
    await expect(descriptionOf(page)).toHaveText('No area of time and frequency is selected.');

    // Tiles of the sound before the edit are drawn until the worker has
    // analysed the edited sound, so the area darkens once they are replaced:
    // by 48 dB, two fifths of the ramp's range, and nowhere else.
    await expect(async () => {
      const [burst, tone, outside] = await coloursAt(page, panel, await spots());
      const [burstBefore, toneBefore, outsideBefore] = before;
      const darker = brightness(burstBefore ?? [0, 0, 0]) - brightness(burst ?? [0, 0, 0]);
      expect(
        darker,
        `the burst drawn ${String(burst)}, before ${String(burstBefore)}`,
      ).toBeGreaterThan(100);
      expect(
        alike(tone ?? [0, 0, 0], toneBefore ?? [0, 0, 0]),
        `the tone drawn ${String(tone)}`,
      ).toBe(true);
      expect(
        alike(outside ?? [0, 0, 0], outsideBefore ?? [0, 0, 0]),
        `the burst before the area drawn ${String(outside)}, before ${String(outsideBefore)}`,
      ).toBe(true);
    }).toPass({ timeout: 30_000 });
  });

  test('draws the same lasso shape from the same drag', async ({ page }) => {
    test.setTimeout(120_000);
    const panel = await openRepairing(page);
    await expectBurstDrawn(page, panel);
    await press(page, 'Spectral lasso');
    await expect(spectralPanel(page)).toContainText('The spectral lasso is in use.');
    const path = [
      await spotOf(panel, 0.4 * RATE, 600),
      await spotOf(panel, 1.1 * RATE, 900),
      await spotOf(panel, 0.9 * RATE, 6_000),
      await spotOf(panel, 0.5 * RATE, 4_000),
      await spotOf(panel, 0.4 * RATE, 620),
    ];
    const box = boxAround(path, 6);

    await dragThrough(page, path);
    await expect(descriptionOf(page)).toHaveText(describedAs('lasso shape'));
    const first = await descriptionOf(page).innerText();
    const firstDrawn = pixelsWithin(await shownOver(page, surfaceOf(panel)), box);
    const area = areaOf(first);
    expect(area.low).toBeGreaterThan(550);
    expect(area.high).toBeLessThan(6_500);

    await press(page, 'Clear');
    await expect(descriptionOf(page)).toHaveText('No area of time and frequency is selected.');
    const cleared = pixelsWithin(await shownOver(page, surfaceOf(panel)), box);
    // The overlay is seen: without it the picture differs.
    expect(differing(firstDrawn, cleared)).toBeGreaterThan(50);

    await dragThrough(page, path);
    await expect(descriptionOf(page)).toHaveText(first);
    const again = pixelsWithin(await shownOver(page, surfaceOf(panel)), box);
    expect(differing(again, firstDrawn), 'pixels drawn differently the second time').toBe(0);
  });

  test('draws the same brush stroke at a fixed strength, whatever the pen’s pressure', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const panel = await openRepairing(page);
    await expectBurstDrawn(page, panel);
    await press(page, 'Spectral brush');
    await expect(spectralPanel(page)).toContainText('The spectral brush is in use.');
    const stroke = strokeBetween(
      await spotOf(panel, 0.4 * RATE, 1_000),
      await spotOf(panel, 1.2 * RATE, 1_200),
    );
    const box = boxAround(stroke, 20);
    const pressure = spectralPanel(page).getByRole('switch', {
      name: 'Let pen pressure set the strength',
    });

    /** Draws the stroke at `force`, and gives what it is described as and drawn as. */
    const drawn = async (force: number): Promise<{ words: string; pixels: readonly Rgb[] }> => {
      await press(page, 'Clear');
      await expect(descriptionOf(page)).toHaveText('No area of time and frequency is selected.');
      await penStroke(page, stroke, force);
      await expect(descriptionOf(page)).toHaveText(describedAs('brush stroke'));
      return {
        words: await descriptionOf(page).innerText(),
        pixels: pixelsWithin(await shownOver(page, surfaceOf(panel)), box),
      };
    };

    await test.step('With pressure, a lighter pen draws a lighter stroke', async () => {
      await expect(pressure).toHaveAttribute('aria-checked', 'true');
      const light = await drawn(0.2);
      const firm = await drawn(0.9);
      expect(firm.words).toBe(light.words);
      expect(differing(firm.pixels, light.pixels)).toBeGreaterThan(50);
    });

    await test.step('At the fixed strength, the same stroke is the same mask', async () => {
      await pressure.click();
      await expect(pressure).toHaveAttribute('aria-checked', 'false');
      const light = await drawn(0.2);
      const firm = await drawn(0.9);
      expect(firm.words).toBe(light.words);
      expect(differing(firm.pixels, light.pixels), 'pixels drawn differently').toBe(0);
    });
  });
});
