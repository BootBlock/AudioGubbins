import { expect, type Locator, type Page } from '@playwright/test';

import { openPalette } from './platform.js';
import { openFresh } from './shell.js';

/**
 * What the editor suites share: opening a test asset, the parts of an Editor
 * panel a person reads (the surface, the scope, the readouts and the marker
 * list), and where on the surface a position is.
 *
 * The waveform is drawn on a canvas, so what these suites assert of a view is
 * read from what the panel says beside it, which the stores the canvas is drawn
 * from feed. That the canvas shows what the panel says is checked from the
 * page's pixels by the renderer suites, through `renderer.ts`.
 */

/** Every editor panel on the page, in the order the dock holds them. */
export function editorPanels(page: Page): Locator {
  return page.locator('section.ag-editor');
}

/** The editor panel shown first, or the one given. */
export function editorPanel(page: Page, index = 0): Locator {
  return editorPanels(page).nth(index);
}

/** The waveform surface of `panel`. */
export function surfaceOf(panel: Locator): Locator {
  return panel.getByRole('application');
}

/** What a reading of `panel` says, by the term it is read by. */
export function readingOf(panel: Locator, term: string): Locator {
  return panel.locator(`xpath=.//dt[normalize-space()="${term}"]/following-sibling::dd[1]`);
}

/** The active selection scope `panel` says. */
export function scopeOf(panel: Locator): Locator {
  return panel.locator('.ag-editor-scope-text');
}

/** Opens AudioGubbins afresh with the test asset `name` in the Editor panel. */
export async function openAsset(page: Page, name: string): Promise<Locator> {
  await openFresh(page);
  const panel = editorPanel(page);
  await panel.getByRole('button', { name, exact: true }).click();
  await expect(panel.locator('.ag-editor-asset-name')).toHaveText(name);
  await expect(surfaceOf(panel)).toBeVisible();
  return panel;
}

/** Chooses how `panel` writes positions, as its Time control offers. */
export async function writeTimesAs(page: Page, panel: Locator, format: string): Promise<void> {
  await panel.getByRole('combobox', { name: 'Time' }).click();
  await page.getByRole('option', { name: format, exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Time' })).toContainText(format);
}

/** A whole number as the panel writes one, grouped: `24,000`. */
function wholeOf(text: string): number {
  return Number(text.replaceAll(',', ''));
}

/** The first and last boundary `panel` shows, written in samples. */
export async function shownOf(panel: Locator): Promise<{ start: number; end: number }> {
  const text = await readingOf(panel, 'Showing').innerText();
  const [start, end] = text.split(' to ').map(wholeOf);
  if (start === undefined || end === undefined) throw new Error(`Not a stretch: ${text}`);
  return { start, end };
}

/** The zoom `panel` shows, as samples in a CSS pixel. */
export async function samplesInPixelOf(panel: Locator): Promise<number> {
  const text = await readingOf(panel, 'Zoom').innerText();
  const samples = /^([\d,]+) samples? a pixel$/u.exec(text);
  if (samples?.[1] !== undefined) return wholeOf(samples[1]);
  const pixels = /^([\d,]+) pixels a sample$/u.exec(text);
  if (pixels?.[1] !== undefined) return 1 / wholeOf(pixels[1]);
  throw new Error(`Not a zoom: ${text}`);
}

/**
 * Where `panel`'s surface is on the page, once it is scrolled wholly into the
 * panel's view, as a person scrolls it before they touch it.
 *
 * The dock clips a panel's content to the panel and scrolls it, so on a short
 * page the surface's box can lie partly under the next panel or its sash, and
 * an event sent to a point of the box measured there reaches that instead.
 */
export async function surfaceBoxOf(
  panel: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const surface = surfaceOf(panel);
  await surface.evaluate((element) => {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  const box = await surface.boundingBox();
  if (box === null) throw new Error('The surface is not on screen.');
  return box;
}

/**
 * Where boundary `position` is on `panel`'s surface, in page coordinates, at
 * the height `fraction` of the way down its first lane, or on the ruler.
 */
export async function pointAt(
  panel: Locator,
  position: number,
  fraction: number | 'ruler' = 0.5,
): Promise<{ x: number; y: number }> {
  const box = await surfaceBoxOf(panel);
  const { start } = await shownOf(panel);
  const perPixel = await samplesInPixelOf(panel);
  const x = box.x + 1 + (position - start) / perPixel;
  // The ruler is the top 24 CSS pixels, where a press sets the playhead.
  if (fraction === 'ruler') return { x, y: box.y + 1 + 12 };
  // Below the ruler and the marker strip, 42 CSS pixels, in the first lane.
  const laneTop = box.y + 1 + 42;
  const laneHeight = (box.height - 42) / 2;
  return { x, y: laneTop + laneHeight * fraction };
}

/** Runs the command labelled `label` from the command palette, as a person would. */
export async function runCommand(page: Page, label: string): Promise<void> {
  await openPalette(page);
  const field = page.getByRole('combobox', { name: 'Search commands' });
  await field.fill(label);
  await page
    .getByRole('option', { name: new RegExp(`^${label}`, 'u') })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Run a command' })).toBeHidden();
}
