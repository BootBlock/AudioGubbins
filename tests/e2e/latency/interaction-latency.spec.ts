import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { sine, wavFile } from '../../../packages/test-fixtures/src/index.js';
import { openAsset, runCommand, surfaceBoxOf } from '../editor.js';
import { makeProject, panelTitled, said } from '../hearing.js';
import { asKeyboardArgument, shortcutFor } from '../platform.js';
import { menuBarMenu, openFresh } from '../shell.js';
import { test } from '../test.js';
import { armRecorder, samplesOf, settle, type RecorderArming } from './frame-recorder.js';

/**
 * Editing latency: how long a hand on a control waits for the screen.
 *
 * Phase 16 redesigns every surface, and its motion must never delay input
 * (REQ-UX-222), so the four interactions the phase names are measured before
 * the redesign and again after it, and the two runs are compared by
 * `tools/compare-latency.mjs` within its stated statistical tolerance
 * (REQ-REPO-189). Each interaction is measured from the input to the end of the
 * first frame that can show its effect, as `frame-recorder.ts` describes.
 *
 * Each input is sent once the last one's sample is taken, so no sample waits
 * behind another and each measures one input alone. The first inputs of each
 * interaction warm the page's code paths and are thrown away.
 *
 * The run writes its samples to `AG_LATENCY_OUT`, or to `latency.json` in the
 * test's output directory, and attaches them to the report. The test asserts
 * only that every sample was taken: a time is judged by the comparison, which
 * is the measurement's purpose, and not by a fixed number this machine might
 * miss under load.
 */

/** Inputs sent before measuring, to warm the code each interaction runs. */
const WARM_UP = 10;

/** Inputs measured for each pointer interaction. */
const POINTER_SAMPLES = 200;

/** Opens of the command palette measured. */
const KEY_SAMPLES = 40;

/** The sound the fader drag is measured on: long enough to carry a rack. */
const SOUND = sine(440, { amplitude: 0.5, length: 48_000, sampleRate: 48_000 });

/** Moves the held pointer `count` times between `from` and `to`, settling after each. */
async function moveHeld(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  count: number,
): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    // Back and forth, so a long run stays inside the control.
    const phase = (index % 40) / 40;
    const along = index % 80 < 40 ? phase : 1 - phase;
    await page.mouse.move(from.x + (to.x - from.x) * along, from.y + (to.y - from.y) * along);
    await settle(page);
  }
}

/**
 * Measures a drag between `from` and `to`: pressed at `from`, a warm-up, then
 * the samples. Armed after the press, so the move to the start is not one.
 */
async function measureDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<readonly number[]> {
  const arming: RecorderArming = { eventType: 'pointermove' };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await armRecorder(page, arming);
  await moveHeld(page, from, to, WARM_UP);
  await armRecorder(page, arming);
  await moveHeld(page, from, to, POINTER_SAMPLES);
  const samples = await samplesOf(page);
  await page.mouse.up();
  return samples;
}

/** A line across the middle of `editor`'s first lane, where a drag selects. */
async function laneBand(editor: Locator) {
  const box = await surfaceBoxOf(editor);
  // Below the ruler and the marker strip, 42 CSS pixels, as `pointAt` places a lane.
  const y = box.y + 1 + 42 + (box.height - 42) / 4;
  return { from: { x: box.x + box.width * 0.2, y }, to: { x: box.x + box.width * 0.8, y } };
}

async function measureSelectionDrag(page: Page): Promise<readonly number[]> {
  const editor = await openAsset(page, 'Tone bursts');
  const { from, to } = await laneBand(editor);
  return await measureDrag(page, from, to);
}

async function measureZoom(page: Page): Promise<readonly number[]> {
  const editor = await openAsset(page, 'Tone bursts');
  const { from, to } = await laneBand(editor);
  await page.mouse.move((from.x + to.x) / 2, from.y);
  const arming: RecorderArming = { eventType: 'wheel' };
  const turn = async (count: number) => {
    await page.keyboard.down('Control');
    for (let index = 0; index < count; index += 1) {
      // In and out in turn, so the view stays between its limits.
      await page.mouse.wheel(0, index % 2 === 0 ? -60 : 60);
      await settle(page);
    }
    await page.keyboard.up('Control');
  };
  await armRecorder(page, arming);
  await turn(WARM_UP);
  await armRecorder(page, arming);
  await turn(POINTER_SAMPLES);
  return await samplesOf(page);
}

async function measureFaderDrag(page: Page): Promise<readonly number[]> {
  // The import is driven through the file input, which the file system's own
  // pickers would replace, as the effect rack suite drives it.
  await page.addInitScript(() => {
    for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
      Reflect.deleteProperty(window, picker);
    }
  });
  await openFresh(page);
  await makeProject(page, 'Latency');
  const choosing = page.waitForEvent('filechooser');
  await menuBarMenu(page, 'File').click();
  await page.getByRole('menuitem', { name: 'Import audio…' }).click();
  await (
    await choosing
  ).setFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavFile(SOUND)) });
  await expect(page.getByText('“Tone” is imported and open.').first()).toBeVisible();
  await runCommand(page, 'Show the Effects rack panel');
  const rack = panelTitled(page, 'Effects rack');
  await rack.getByRole('button', { name: 'Add a processor' }).click();
  await page.getByRole('menuitem', { name: 'Gain', exact: true }).click();
  await said(page, 'Gave “Tone” a rack, with “Gain” in it.');
  await rack.getByRole('button', { name: 'Gain', exact: true }).click();
  // The baseline dragged the slot's Mix slider, the first slider the rack drew
  // then, so the comparison holds only while this drags the same control:
  // found by its name, since the rack draws other sliders before it now. The
  // drag runs along its track, which holds the thumb the name is on.
  const mix = rack.getByRole('slider', { name: 'Mix of “Gain”', exact: true });
  const track = rack.locator('.ag-slider').filter({ has: mix });
  await expect(track).toBeVisible();
  const box = await track.boundingBox();
  if (box === null) throw new Error('The Mix slider has no box on the page.');
  const y = box.y + box.height / 2;
  return await measureDrag(
    page,
    { x: box.x + box.width * 0.1, y },
    { x: box.x + box.width * 0.9, y },
  );
}

async function measurePaletteKey(page: Page): Promise<readonly number[]> {
  await openFresh(page);
  const binding = await shortcutFor(page, 'view.command-palette');
  const last = binding.presses.at(-1);
  if (last === undefined) throw new Error('The palette shortcut has no presses.');
  const palette = page.getByRole('dialog', { name: 'Run a command' });
  const open = async (count: number) => {
    for (let index = 0; index < count; index += 1) {
      for (const one of binding.presses) await page.keyboard.press(asKeyboardArgument(one));
      await settle(page);
      await expect(palette).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(palette).toBeHidden();
    }
  };
  const arming: RecorderArming = { eventType: 'keydown', key: last.key, until: '.ag-palette' };
  await armRecorder(page, arming);
  await open(WARM_UP / 2);
  await armRecorder(page, arming);
  await open(KEY_SAMPLES);
  return await samplesOf(page);
}

/** Writes `samples` of `interaction` where the comparison reads them, and to the report. */
async function keep(
  page: Page,
  browserName: string,
  testInfo: TestInfo,
  interaction: string,
  samples: readonly number[],
): Promise<void> {
  const record = {
    interaction,
    browser: `${browserName} ${page.context().browser()?.version() ?? 'unknown'}`,
    viewport: page.viewportSize(),
    samples,
  };
  const directory = process.env['AG_LATENCY_OUT'] ?? testInfo.outputDir;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${interaction}.json`), `${JSON.stringify(record, null, 2)}\n`);
  await testInfo.attach(`${interaction}.json`, {
    body: JSON.stringify(record),
    contentType: 'application/json',
  });
}

test.describe('editing latency', () => {
  // A project's import is driven, and the sound is short, but the browser's
  // first decode on a cold machine can take a while.
  test.setTimeout(300_000);

  test('measures selection-drag', async ({ page, browserName }, testInfo) => {
    const samples = await measureSelectionDrag(page);
    expect(samples).toHaveLength(POINTER_SAMPLES);
    await keep(page, browserName, testInfo, 'selection-drag', samples);
  });

  test('measures zoom', async ({ page, browserName }, testInfo) => {
    const samples = await measureZoom(page);
    expect(samples).toHaveLength(POINTER_SAMPLES);
    await keep(page, browserName, testInfo, 'zoom', samples);
  });

  test('measures fader-drag', async ({ page, browserName }, testInfo) => {
    const samples = await measureFaderDrag(page);
    expect(samples).toHaveLength(POINTER_SAMPLES);
    await keep(page, browserName, testInfo, 'fader-drag', samples);
  });

  test('measures palette-key', async ({ page, browserName }, testInfo) => {
    const samples = await measurePaletteKey(page);
    expect(samples).toHaveLength(KEY_SAMPLES);
    await keep(page, browserName, testInfo, 'palette-key', samples);
  });
});
