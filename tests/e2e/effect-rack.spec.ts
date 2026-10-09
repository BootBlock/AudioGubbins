import { expect, type Locator } from '@playwright/test';

import { sine, wavFile, type SignalFixture } from '../../packages/test-fixtures/src/index.js';
import { editorPanel, runCommand, writeTimesAs } from './editor.js';
import {
  TAP_PROCESSOR,
  banner,
  hear,
  largestDifference,
  makeProject,
  openFromAssets,
  panelTitled,
  said,
  selectRange,
  tapTheOutput,
} from './hearing.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * The effect rack, driven in a real browser (the packet's acceptance: "A
 * browser test applies a chain to a selection, gives a region a rack, reloads,
 * and hears the same project"; ADR-0060).
 *
 * A short sound is imported into a project; a chain holding a gain is applied
 * over a selected range of it from the Effects rack panel, and its gain set; a
 * region is made of another range and given a rack holding a gain, and that
 * gain set too. What is heard is then captured: the sound played processed,
 * played as the original, and the region played; the page is reloaded; and the
 * sound and the region are played again. The two hearings of the project are
 * the same samples, and what is heard processed differs from the original by
 * each gain over its own range, and is the original everywhere else, so a rack
 * dropped on the way, or kept but not heard, fails.
 *
 * What is heard is taken from the samples the page plays to its output
 * (`hearing.ts`).
 *
 * Every step is taken as a person takes it, through the banner, the menus, the
 * palette, the Effects rack panel and the editor; the file is chosen through
 * the file input the application falls back to, as in the core-editing spec.
 */

const RATE = 48_000;
const LENGTH = 2 * RATE;

/**
 * Two seconds of mono: a cosine, so the first sample, and the first of each
 * range below, is far from silence, with a second partial over it.
 */
const QUAY: SignalFixture = {
  ...sine(440, { sampleRate: RATE, length: LENGTH }),
  channels: [
    Float32Array.from(
      { length: LENGTH },
      (_, frame) =>
        0.25 * Math.cos((2 * Math.PI * 440 * frame) / RATE) +
        0.1 * Math.sin((2 * Math.PI * 1_210 * frame) / RATE),
    ),
  ],
};

/** The range the chain processes, and the region's, in frames. */
const PROCESSED = { start: 12_000, end: 36_000 } as const;
const REGION = { start: 48_000, end: 72_000 } as const;

/** The gains set, in decibels: the selection's chain's and the region's rack's. */
const SELECTION_GAIN = -6;
const REGION_GAIN = 6;

/** The root mean square of `samples` from `start` to `end`, in decibels. */
function levelOf(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let frame = start; frame < end; frame += 1) sum += (samples[frame] ?? 0) ** 2;
  return 10 * Math.log10(sum / (end - start));
}

/**
 * The largest difference between `heard` and `expected`, frame for frame, in
 * units of float32 rounding at each expected sample: a sample heard is the
 * expected value rounded to float32, so no frame differs by more than one.
 */
function largestRoundingError(heard: Float32Array, expected: Float32Array): number {
  let most = 0;
  for (const [frame, wanted] of expected.entries()) {
    const unit = Math.max(Math.abs(wanted) * 2 ** -23, 2 ** -149);
    most = Math.max(most, Math.abs((heard[frame] ?? 0) - wanted) / unit);
  }
  return most;
}

/** A whole number as the editor writes one, grouped: `24,000`. */
function whole(value: number): string {
  return value.toLocaleString('en-GB');
}

/**
 * Selects the gain the rack panel shows, which opens its controls, and sets
 * it to `decibels`, typed as a person types it.
 */
async function setGain(rack: Locator, decibels: number): Promise<void> {
  await rack.getByRole('button', { name: 'Gain', exact: true }).click();
  await expect(rack.getByRole('button', { name: 'Gain, selected', exact: true })).toBeVisible();
  const field = rack.getByRole('textbox', { name: 'Gain in dB, typed' });
  await field.fill(String(decibels));
  await field.press('Enter');
  await expect(field).toHaveValue(String(decibels));
}

/** A box on the page, as Playwright measures one. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function overlaps(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  );
}

/** The smallest width a slider's track may have and still be set by a pointer. */
const SETTABLE_TRACK = 64;

/**
 * Every slider in the panel keeps its label, its track and its value apart and
 * inside the panel, however narrow the panel is docked, with a track wide
 * enough to set: the rack's controls are long ("Mix of" and the processor's
 * name), and a field that cannot shrink them must move the track under them.
 */
async function keepsItsSlidersApart(panel: Locator): Promise<void> {
  const within = await panel.boundingBox();
  if (within === null) throw new Error('The panel is not on screen.');
  const fields = panel.locator('.ag-slider-field');
  const count = await fields.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const field = fields.nth(index);
    const parts: Box[] = [];
    for (const part of ['.ag-slider-label', '.ag-slider', '.ag-slider-value']) {
      const box = await field.locator(part).boundingBox();
      if (box === null) continue;
      expect(
        box.x,
        `${part} of field ${String(index)} starts inside the panel`,
      ).toBeGreaterThanOrEqual(within.x);
      expect(
        box.x + box.width,
        `${part} of field ${String(index)} ends inside the panel`,
      ).toBeLessThanOrEqual(within.x + within.width);
      if (part === '.ag-slider') expect(box.width).toBeGreaterThanOrEqual(SETTABLE_TRACK);
      for (const other of parts)
        expect(overlaps(box, other), `${part} of field ${String(index)}`).toBe(false);
      parts.push(box);
    }
  }
}

test.describe('the effect rack', () => {
  // The recorder is a module made from a blob, which the page's policy
  // refuses a worklet; the policy is set aside for this test's pages alone,
  // and the smoke suite holds the page to it.
  test.use({ viewport: { width: 1280, height: 1400 }, bypassCSP: true });

  test('applies a chain to a selection, gives a region a rack, reloads, and hears the same project', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
        Reflect.deleteProperty(window, picker);
      }
    });
    await page.addInitScript(tapTheOutput, TAP_PROCESSOR);
    await openFresh(page);
    await makeProject(page, 'Quayside');

    const choosing = page.waitForEvent('filechooser');
    await menuBarMenu(page, 'File').click();
    await page.getByRole('menuitem', { name: 'Import audio…' }).click();
    await (
      await choosing
    ).setFiles({ name: 'Quay.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavFile(QUAY)) });
    await expect(page.getByText('“Quay” is imported and open.').first()).toBeVisible();
    const editor = editorPanel(page);
    await writeTimesAs(page, editor, 'Samples');
    await runCommand(page, 'Show the Effects rack panel');
    const rack = panelTitled(page, 'Effects rack');

    const processed =
      await test.step('A chain holding a gain is applied over the selection, and its gain set', async () => {
        const selected = await selectRange(page, editor, PROCESSED);
        await rack.getByRole('button', { name: 'Add over the selection' }).click();
        await page.getByRole('menuitem', { name: 'Gain', exact: true }).click();
        await said(page, 'Added “Gain” over the selection of Quay, in a chain of its own.');
        await rack
          .getByRole('button', {
            name: `From ${whole(selected.start)} to ${whole(selected.end)}: Gain`,
          })
          .click();
        await setGain(rack, SELECTION_GAIN);
        await keepsItsSlidersApart(rack);
        return selected;
      });

    const region =
      await test.step('A region is made, opened, and given a rack holding a gain, its gain set', async () => {
        const selected = await selectRange(page, editor, REGION);
        await runCommand(page, 'Make a region of the selection');
        await said(page, 'Region 1 made of Quay.');
        await runCommand(page, 'Select the next region');
        await runCommand(page, 'Open the region in this view');
        await said(page, 'Region 1 is open.');
        await rack.getByRole('button', { name: 'Add a processor' }).click();
        await page.getByRole('menuitem', { name: 'Gain', exact: true }).click();
        await said(page, 'Gave “Region 1” a rack, with “Gain” in it.');
        await setGain(rack, REGION_GAIN);
        await expect(
          page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
        ).toBeVisible();
        return selected;
      });

    const before =
      await test.step('The project is heard: the region, the sound processed, and the original', async () => {
        const regionHeard = await hear(page);
        await openFromAssets(page, 'Quay');
        const processedHeard = await hear(page);
        await runCommand(page, 'Hear the original');
        const originalHeard = await hear(page);
        await runCommand(page, 'Hear it processed');
        return { region: regionHeard, processed: processedHeard, original: originalHeard };
      });

    await test.step('What is heard processed differs from the original over each range alone', () => {
      const heard = before;
      expect(heard.processed.left.length).toBe(LENGTH);
      expect(heard.original.left.length).toBe(LENGTH);
      // Inside the processed range, a millisecond in from each end, the
      // chain's gain; everywhere outside it, the original to the sample.
      const inside = [processed.start + 48, processed.end - 48] as const;
      expect(
        levelOf(heard.processed.left, ...inside) - levelOf(heard.original.left, ...inside),
      ).toBeCloseTo(SELECTION_GAIN, 1);
      expect(largestDifference(heard.processed.left, heard.original.left, 0, processed.start)).toBe(
        0,
      );
      expect(
        largestDifference(heard.processed.left, heard.original.left, processed.end, LENGTH),
      ).toBe(0);
      // The region heard is its span of the sound, through its rack's gain,
      // sample for sample: a level alone would not tell another span.
      const span = region.end - region.start;
      const factor = 10 ** (REGION_GAIN / 20);
      for (const channel of ['left', 'right'] as const) {
        expect(heard.region[channel].length).toBe(span);
        const scaled = heard.original[channel]
          .slice(region.start, region.end)
          .map((sample) => sample * factor);
        expect(largestRoundingError(heard.region[channel], scaled)).toBeLessThanOrEqual(1);
      }
    });

    await page.reload();
    await expect(banner(page).getByText('“Quayside”', { exact: true })).toBeVisible();

    await test.step('After the reload the project is heard again, the same samples', async () => {
      await openFromAssets(page, 'Quay');
      const processedAgain = await hear(page);
      await openFromAssets(page, 'Region 1');
      const regionAgain = await hear(page);
      for (const [again, first] of [
        [processedAgain, before.processed],
        [regionAgain, before.region],
      ] as const) {
        expect(again.left.length).toBe(first.left.length);
        expect(largestDifference(again.left, first.left, 0, first.left.length)).toBe(0);
        expect(largestDifference(again.right, first.right, 0, first.right.length)).toBe(0);
      }
    });
  });
});
