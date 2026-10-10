import { expect } from '@playwright/test';

import { readingOf, surfaceOf } from './editor.js';
import {
  expectDrawnAsShown,
  expectLabelled,
  openWithCapabilities,
  rendererReport,
  webglLoss,
} from './renderer.js';
import {
  TILE_BUDGET,
  drawPattern,
  expectPatternDrawn,
  expectRecovered,
  expectRedrawnAsBefore,
  expectTilesWithinBudget,
  fieldReport,
  fieldTextures,
  offeredBackends,
  openHarness,
  openOn,
} from './renderer-field.js';
import { test } from './test.js';

/**
 * The editor's renderer losing its WebGL 2 context (the packet's
 * `test:renderer-loss`, REQ-AUDIO-152, ADR-0044), in a Chromium that offers no
 * WebGPU adapter: the context given back, and never given back, when the
 * renderer steps down to Canvas 2D. What the renderer says of itself is read
 * from the Capabilities panel, and what it draws from the page's pixels, before
 * the loss and after the recovery, where the view is drawn as it is after a
 * change made while the context was away.
 */
test.describe('the editor renderer', () => {
  test('recovers a WebGL 2 context given back, and draws the view as it now is', async ({
    page,
  }) => {
    const panel = await openWithCapabilities(page);
    await expect(rendererReport(page)).toHaveAttribute('data-ag-renderer', 'webgl2');
    await expectDrawnAsShown(page, panel);
    const before = await readingOf(panel, 'Zoom').innerText();

    await webglLoss(page, 'loseContext');
    await expect(rendererReport(page)).toContainText('The graphics device was lost');
    // A change made while the device is away is the state the next frame shows.
    await surfaceOf(panel).press('ArrowUp');
    await expect(readingOf(panel, 'Zoom')).not.toHaveText(before);
    await webglLoss(page, 'restoreContext');

    await expect(rendererReport(page)).toContainText('Drawn with WebGL 2.');
    await expect(rendererReport(page)).toContainText('Lost 1 times, recovered 1.');
    await expectDrawnAsShown(page, panel);
    await expectLabelled(page, panel);
  });

  test('steps down to Canvas 2D when the WebGL 2 context never comes back', async ({ page }) => {
    const panel = await openWithCapabilities(page);
    await expectDrawnAsShown(page, panel);
    await webglLoss(page, 'loseContext');

    await expect(rendererReport(page)).toContainText('Drawn with Canvas 2D.', { timeout: 10_000 });
    await expect(rendererReport(page)).toContainText('WebGL 2: stopped');
    await expect(rendererReport(page)).toHaveAttribute('data-ag-renderer', 'canvas-2d');
    await expectDrawnAsShown(page, panel);
  });
});

/**
 * A field batch (ADR-0082) in the same Chromium, drawn by the editor's renderer
 * on the renderer harness: through its ramp on WebGL 2 and on Canvas 2D, each
 * read back by pixel, drawn again as it was once a lost context is given back,
 * drawn by Canvas 2D when it never is, and held within its texture budget.
 */
test.describe('a field batch', () => {
  test('is drawn through its ramp by every backend the browser offers', async ({ page }) => {
    await openHarness(page);
    const offered = await offeredBackends(page);
    expect(offered).toEqual(['webgl2', 'canvas-2d']);
    for (const kind of offered) {
      await openOn(page, kind);
      await drawPattern(page);
      await expectPatternDrawn(page);
    }
  });

  test('is uploaded and drawn again as it was when the WebGL 2 context is given back', async ({
    page,
  }) => {
    await openHarness(page);
    await openOn(page, 'webgl2');
    await drawPattern(page);
    const before = await expectPatternDrawn(page);
    const uploaded = await fieldTextures(page);
    expect(uploaded.held).toBe(1);

    await webglLoss(page, 'loseContext');
    await expect.poll(async () => (await fieldReport(page)).state).toBe('recovering');
    expect((await fieldTextures(page)).held, 'field textures held while the context is away').toBe(
      0,
    );
    await webglLoss(page, 'restoreContext');

    await expectRecovered(page, 1);
    await expectRedrawnAsBefore(page, before);
    const again = await fieldTextures(page);
    expect(again.made - uploaded.made, 'field textures uploaded again').toBe(1);
    expect(again.held).toBe(1);
  });

  test('is drawn by Canvas 2D when the WebGL 2 context never comes back', async ({ page }) => {
    await openHarness(page);
    await openOn(page, 'webgl2');
    await drawPattern(page);
    await expectPatternDrawn(page);

    await webglLoss(page, 'loseContext');

    await expect
      .poll(async () => (await fieldReport(page)).active, { timeout: 10_000 })
      .toBe('canvas-2d');
    await expectRecovered(page, 1);
    await expectPatternDrawn(page);
  });

  test('holds no WebGL 2 texture for a tile it does not draw, beyond its budget', async ({
    page,
  }) => {
    await openHarness(page);
    await openOn(page, 'webgl2', TILE_BUDGET);
    await expectTilesWithinBudget(page);
  });
});
