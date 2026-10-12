import { expect, type Locator, type Page } from '@playwright/test';

import type { RendererKind, RendererReport } from '../../packages/renderer/src/index.js';
import { alike, pixelOf, shownOver, type Shown } from './renderer.js';
import { READ_POINTS, expectedAt } from './renderer-harness/field-pattern.js';
import {
  HARNESS_GLOBAL,
  TILE,
  type FieldTextures,
  type RendererHarness,
} from './renderer-harness/harness-api.js';

/**
 * What the renderer suites read of a field batch (ADR-0082), through the
 * renderer harness (`renderer-harness/`): the editor's renderer on the
 * editor's canvases, on a backend a test names, drawing a field whose colours
 * are known at every point read, and a long field of tiles under a budget. The
 * picture is read from the page's pixels, as the editor's is.
 */

/** Where the browser suite serves the renderer harness. */
const HARNESS_URL = 'http://127.0.0.1:4176/';

/** The harness's surface, where the renderer draws. */
function fieldSurface(page: Page): Locator {
  return page.locator('#surface');
}

/** Opens the harness page, once it has put its harness on `window`. */
export async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS_URL);
  await page.waitForFunction((name) => Reflect.has(window, name), HARNESS_GLOBAL);
}

/** The kinds of backend the page's browser draws with, in the renderer's order. */
export async function offeredBackends(page: Page): Promise<readonly RendererKind[]> {
  return await page.evaluate(
    (name) => (Reflect.get(window, name) as RendererHarness).offered(),
    HARNESS_GLOBAL,
  );
}

/**
 * Starts the renderer on `kind`, holding field textures within `budget` bytes
 * where one is given, and checks it draws with that kind.
 */
export async function openOn(page: Page, kind: RendererKind, budget?: number): Promise<void> {
  const report = await page.evaluate(
    ([name, on, within]) =>
      (Reflect.get(window, name) as RendererHarness).open(on, within ?? undefined),
    [HARNESS_GLOBAL, kind, budget ?? null] as const,
  );
  expect(
    report.active,
    `the backend drawing, having tried ${JSON.stringify(report.attempts)}`,
  ).toBe(kind);
  expect(report.state).toBe('drawing');
}

/** What the renderer on the harness says of itself. */
export async function fieldReport(page: Page): Promise<RendererReport> {
  return await page.evaluate(
    (name) => (Reflect.get(window, name) as RendererHarness).report(),
    HARNESS_GLOBAL,
  );
}

/** Draws the known field. */
export async function drawPattern(page: Page): Promise<void> {
  await page.evaluate((name) => {
    (Reflect.get(window, name) as RendererHarness).drawPattern();
  }, HARNESS_GLOBAL);
}

/** The field textures the renderer on the harness holds and has made. */
export async function fieldTextures(page: Page): Promise<FieldTextures> {
  return await page.evaluate(
    (name) => (Reflect.get(window, name) as RendererHarness).fieldTextures(),
    HARNESS_GLOBAL,
  );
}

/**
 * Checks, from what the page shows, that the known field is drawn: at every
 * point read, the colour `field-pattern.ts` says, which holds both ends of the
 * ramp, its half-transparent middle blended over the rectangle under it, the
 * rectangle drawn over it, and the pixels a field paints nothing on. Answers
 * the picture, for a later one to be held to.
 */
export async function expectPatternDrawn(page: Page): Promise<Shown> {
  const surface = fieldSurface(page);
  let picture: Shown | undefined;
  await expect(async () => {
    const shown = await shownOver(page, surface);
    const wrong = READ_POINTS.flatMap(({ x, y }) => {
      const seen = pixelOf(shown, shown.left + x, shown.top + y);
      const expected = expectedAt(x, y);
      return alike(seen, expected)
        ? []
        : [`${String(x)},${String(y)}: ${seen.join(',')} for ${expected.join(',')}`];
    });
    expect(wrong, 'points not the colour the field is drawn in there').toEqual([]);
    picture = shown;
  }).toPass({ timeout: 10_000 });
  if (picture === undefined) throw new Error('The field was never read.');
  return picture;
}

/** The pixels of `after` that differ from `before`'s, by position, at most a few. */
function differences(before: Shown, after: Shown): readonly string[] {
  const found: string[] = [];
  if (before.width !== after.width || before.height !== after.height) {
    return [
      `${String(after.width)}x${String(after.height)} for ${String(before.width)}x${String(before.height)}`,
    ];
  }
  for (let at = 0; at < before.data.length && found.length < 8; at += 4) {
    const one = before.data.subarray(at, at + 4).join(',');
    const other = after.data.subarray(at, at + 4).join(',');
    if (one !== other) {
      const pixel = at / 4;
      found.push(
        `${String(pixel % before.width)},${String(Math.floor(pixel / before.width))}: ${other} for ${one}`,
      );
    }
  }
  return found;
}

/**
 * Checks the known field is drawn again, after a loss, exactly as `before`:
 * the same colour at every point read, and the same at every pixel.
 */
export async function expectRedrawnAsBefore(page: Page, before: Shown): Promise<void> {
  const after = await expectPatternDrawn(page);
  expect(differences(before, after), 'pixels drawn otherwise than before the loss').toEqual([]);
}

/** Waits for the renderer on the harness to have recovered `times` times, and to be drawing. */
export async function expectRecovered(page: Page, times: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const { state, losses, recoveries } = await fieldReport(page);
        return { state, losses, recoveries };
      },
      { timeout: 15_000 },
    )
    .toEqual({ state: 'drawing', losses: times, recoveries: times });
}

/** The tiles drawn on each frame of the long field, side by side across the surface. */
const IN_VIEW = 3;

/** Bytes of one tile's texture. */
const TILE_BYTES = TILE.width * TILE.height;

/** The budget a GPU backend is held to: the tiles in view and one more. */
export const TILE_BUDGET = (IN_VIEW + 1) * TILE_BYTES;

/** How far along the long field the view is moved, a tile at a time. */
const LENGTH = 40;

async function drawTiles(page: Page, first: number): Promise<FieldTextures> {
  return await page.evaluate(
    ([name, from, count]) => (Reflect.get(window, name) as RendererHarness).drawTiles(from, count),
    [HARNESS_GLOBAL, first, IN_VIEW] as const,
  );
}

/**
 * Checks a GPU backend opened with {@link TILE_BUDGET} holds no texture for a
 * tile it does not draw beyond its budget's cache, under a long field: moved
 * along it a tile at a time, each frame uploads the one tile that came into
 * view and no other, and afterwards holds no more than its budget, however
 * many tiles it has drawn; moved back a tile, it draws from what it held and
 * uploads nothing.
 */
export async function expectTilesWithinBudget(page: Page): Promise<void> {
  const before = await fieldTextures(page);
  expect(before.heldBytes, 'bytes held before the first tile').toBe(0);
  const start = await drawTiles(page, 0);
  expect(start.made - before.made, 'textures made for the first view').toBe(IN_VIEW);
  expect(start.heldBytes).toBe(IN_VIEW * TILE_BYTES);
  let previous = start;
  for (let first = 1; first <= LENGTH; first += 1) {
    const now = await drawTiles(page, first);
    expect(now.made - previous.made, `textures made moving to tile ${String(first)}`).toBe(1);
    expect(now.madeBytes - previous.madeBytes).toBe(TILE_BYTES);
    expect(now.heldBytes, `bytes held at tile ${String(first)}`).toBeLessThanOrEqual(TILE_BUDGET);
    expect(now.heldBytes).toBeGreaterThanOrEqual(IN_VIEW * TILE_BYTES);
    previous = now;
  }
  const back = await drawTiles(page, LENGTH - 1);
  expect(back.made - previous.made, 'textures made moving back a tile').toBe(0);
  expect(back.heldBytes).toBeLessThanOrEqual(TILE_BUDGET);
  expect(previous.made - before.made, 'every tile drawn was uploaded once').toBe(LENGTH + IN_VIEW);
}

/**
 * Checks the Canvas 2D backend holds nothing per tile under the same long
 * field: no texture is made, and every tile is composed on the one canvas it
 * asked for.
 */
export async function expectCanvasHoldsNoTiles(page: Page): Promise<void> {
  for (let first = 0; first <= LENGTH; first += 1) await drawTiles(page, first);
  const textures = await fieldTextures(page);
  expect(textures.made, 'field textures made').toBe(0);
  const canvases = await page.evaluate(
    (name) => (Reflect.get(window, name) as RendererHarness).composingCanvases(),
    HARNESS_GLOBAL,
  );
  expect(canvases, 'canvases composed on').toBe(1);
}
