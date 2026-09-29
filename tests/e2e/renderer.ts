import { expect, type Browser, type Locator, type Page } from '@playwright/test';

import {
  openAsset,
  pointAt,
  runCommand,
  samplesInPixelOf,
  shownOf,
  surfaceOf,
  writeTimesAs,
} from './editor.js';

/**
 * What the renderer suites share: the renderer report of the editor view, as
 * the Capabilities panel lists it, the tone bursts opened beside that panel, a
 * WebGL 2 context taken away and given back, the GPU process crashed, and what
 * the page shows of the view, which is checked against what the view says it
 * shows. Each suite runs in the Chromium its project launches: with WebGPU on a
 * software adapter, without one, or with WebGL switched off.
 */

/** The renderer report of the one editor view, as the Capabilities panel lists it. */
export function rendererReport(page: Page): Locator {
  return page.locator('.ag-capability[data-ag-renderer]');
}

/**
 * Opens the tone bursts, and the Capabilities panel beside the editor. The
 * panel writes positions in samples, which is how its picture is checked
 * against what it says it shows, and the grid, whose lines cross every lane, is
 * hidden, so a silent stretch of a lane is the clear colour across it.
 */
export async function openWithCapabilities(page: Page): Promise<Locator> {
  const panel = await openAsset(page, 'Tone bursts');
  await writeTimesAs(page, panel, 'Samples');
  await runCommand(page, 'Show grid');
  await runCommand(page, 'Show the Capabilities panel');
  await expect(page.getByRole('heading', { name: 'Editor drawing' })).toBeVisible();
  // Opening a panel mounts the dock again, and the view's renderer with it:
  // what follows acts on the renderer once it draws.
  await expect(rendererReport(page)).toContainText('Drawn with', { timeout: 15_000 });
  return panel;
}

/**
 * Takes the geometry canvas's WebGL 2 context away, or gives it back, through
 * its loss extension. The extension is kept on the page the first time: a lost
 * context gives no extension, so the one that took it away gives it back.
 */
export async function webglLoss(page: Page, what: 'loseContext' | 'restoreContext'): Promise<void> {
  await page.evaluate((call) => {
    const isLoss = (value: unknown): value is WEBGL_lose_context =>
      typeof value === 'object' && value !== null && 'restoreContext' in value;
    const kept: unknown = Reflect.get(window, 'agContextLoss');
    const loss = isLoss(kept)
      ? kept
      : document
          .querySelector<HTMLCanvasElement>('.ag-editor-canvas-geometry')
          ?.getContext('webgl2')
          ?.getExtension('WEBGL_lose_context');
    if (loss === undefined || loss === null)
      throw new Error('The view draws with no WebGL 2 context.');
    Reflect.set(window, 'agContextLoss', loss);
    loss[call]();
  }, what);
}

/** A colour as the page shows it, red, green and blue from 0 to 255. */
type Rgb = readonly [number, number, number];

/** What the page shows over a surface, canvases and all, as rows of RGBA. */
interface Shown {
  readonly width: number;
  readonly height: number;
  /** Where the picture's first pixel is on the page, and pixels to a CSS pixel. */
  readonly left: number;
  readonly top: number;
  readonly scale: number;
  readonly data: Uint8Array;
}

/** The pixel at page coordinates `x`, `y` of `shown`. */
function pixelOf(shown: Shown, x: number, y: number): Rgb {
  const column = Math.floor((x - shown.left) * shown.scale);
  const row = Math.floor((y - shown.top) * shown.scale);
  const at = (row * shown.width + column) * 4;
  return [shown.data[at] ?? 0, shown.data[at + 1] ?? 0, shown.data[at + 2] ?? 0];
}

/** Whether two colours are the same to within what compositing rounds. */
function alike(one: Rgb, other: Rgb): boolean {
  return one.every((channel, index) => Math.abs(channel - (other[index] ?? 0)) <= 3);
}

/**
 * Theme colour `property` of the page's root, as a canvas draws it, which is
 * how the editor's canvases are given their colours.
 */
async function themeColour(page: Page, property: string): Promise<Rgb> {
  const [red, green, blue] = await page.evaluate((name) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value === '') throw new Error(`The theme sets no ${name}.`);
    const drawing = new OffscreenCanvas(1, 1).getContext('2d');
    if (drawing === null) throw new Error('The page draws on no canvas.');
    drawing.fillStyle = value;
    drawing.fillRect(0, 0, 1, 1);
    return [...drawing.getImageData(0, 0, 1, 1).data];
  }, property);
  return [red ?? 0, green ?? 0, blue ?? 0];
}

/**
 * What the page shows over `panel`'s surface: a screenshot, which is what a
 * person sees, decoded by the page. Read back from the canvas instead, a GPU
 * backend's picture is gone once the page has shown it, since neither GPU
 * backend keeps its drawing buffer, and keeping it would cost every frame.
 */
async function shownOver(page: Page, panel: Locator): Promise<Shown> {
  const surface = surfaceOf(panel);
  const box = await surface.boundingBox();
  if (box === null) throw new Error('The surface is not on screen.');
  const png = await surface.screenshot({ animations: 'disabled', caret: 'hide' });
  const decoded = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const drawing = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    if (drawing === null) throw new Error('The page draws on no canvas.');
    drawing.drawImage(bitmap, 0, 0);
    const data = drawing.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let binary = '';
    for (let at = 0; at < data.length; at += 0x8000) {
      binary += String.fromCharCode(...data.subarray(at, at + 0x8000));
    }
    return { width: bitmap.width, height: bitmap.height, data: btoa(binary) };
  }, png.toString('base64'));
  return {
    width: decoded.width,
    height: decoded.height,
    left: box.x,
    top: box.y,
    scale: decoded.width / box.width,
    data: new Uint8Array(Buffer.from(decoded.data, 'base64')),
  };
}

/**
 * The left channel of the tone bursts, one repeat of it in samples: a loud tone
 * at 0.8 of full scale, then a quieter one at 0.5 between silences, then an
 * impulse at full scale, and silence to the end of the repeat.
 */
const BURSTS = {
  repeat: 96_000,
  loud: [[0, 24_000]],
  silent: [
    [24_000, 36_000],
    [48_000, 60_000],
    [72_000, 96_000],
  ],
} as const;

/**
 * How far below the centre line the first lane is read: beyond the quieter
 * tone, within the loud one, and clear of the channel's name, which is written
 * at the lane's top.
 */
const READ_AT = 0.7;

/** Whether samples `from` to `to` lie inside one of `spans` of a repeat, `margin` clear of its ends. */
function within(
  spans: readonly (readonly [number, number])[],
  from: number,
  to: number,
  margin: number,
): boolean {
  const repeat = Math.floor(from / BURSTS.repeat);
  if (Math.floor(to / BURSTS.repeat) !== repeat) return false;
  const start = from - repeat * BURSTS.repeat;
  const end = to - repeat * BURSTS.repeat;
  return spans.some(([first, last]) => start >= first + margin && end <= last - margin);
}

/**
 * Checks, from what the page shows, that the first lane of `panel` is drawn as
 * the view now is: across the lane, at 0.7 of full scale below its centre, the
 * waveform's peak colour wherever the loud tone is and the clear colour
 * wherever the channel is silent, each at the column the panel's Showing and
 * Zoom readings put it. A blank canvas, or one still showing the view before a
 * change, has columns of the wrong colour. Columns within two of a tone's edge
 * are not judged, and nor is the quieter tone or the impulse.
 */
export async function expectDrawnAsShown(page: Page, panel: Locator): Promise<void> {
  const peak = await themeColour(page, '--ag-waveform-peak');
  const clear = await themeColour(page, '--ag-waveform-background');
  await expect(async () => {
    const shown = await shownOver(page, panel);
    const { start } = await shownOf(panel);
    const perPixel = await samplesInPixelOf(panel);
    const origin = await pointAt(panel, start, 0.5 + READ_AT / 2);
    const wrong: string[] = [];
    let loud = 0;
    let silent = 0;
    const right = shown.left + shown.width / shown.scale - 2;
    for (let x = Math.ceil(origin.x) + 1; x < right; x += 1) {
      const from = start + (x - origin.x) * perPixel;
      const to = from + perPixel;
      const expected = within(BURSTS.loud, from, to, 2 * perPixel)
        ? peak
        : within(BURSTS.silent, from, to, 2 * perPixel)
          ? clear
          : undefined;
      if (expected === undefined) continue;
      if (expected === peak) loud += 1;
      else silent += 1;
      const seen = pixelOf(shown, x, origin.y);
      if (!alike(seen, expected)) wrong.push(`${String(x)}: ${seen.join(',')}`);
    }
    expect(loud, 'columns of the loud tone judged').toBeGreaterThan(10);
    expect(silent, 'silent columns judged').toBeGreaterThan(10);
    expect(wrong, `columns not ${peak.join(',')} or ${clear.join(',')} as expected`).toEqual([]);
  }).toPass({ timeout: 10_000 });
}

/**
 * Checks, from what the page shows, that the overlay above the geometry is
 * painted: the first lane's channel name, written at its top left in the colour
 * of a lane's labels, where the geometry alone draws none of that colour.
 */
export async function expectLabelled(page: Page, panel: Locator): Promise<void> {
  const label = await themeColour(page, '--ag-chrome-text-secondary');
  await expect(async () => {
    const shown = await shownOver(page, panel);
    const { start } = await shownOf(panel);
    const corner = await pointAt(panel, start, 0);
    let written = 0;
    for (let y = corner.y; y < corner.y + 16; y += 1) {
      for (let x = corner.x + 4; x < corner.x + 36; x += 1) {
        if (alike(pixelOf(shown, x, y), label)) written += 1;
      }
    }
    expect(written, `pixels of the channel's name, in ${label.join(',')}`).toBeGreaterThan(3);
  }).toPass({ timeout: 10_000 });
}

/**
 * Crashes the browser's GPU process, which takes every canvas's context away at
 * once, the overlay's with the geometry's, and gives them back in an order the
 * browser chooses.
 */
export async function crashGpuProcess(browser: Browser): Promise<void> {
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.crashGpuProcess');
  await session.detach();
}
