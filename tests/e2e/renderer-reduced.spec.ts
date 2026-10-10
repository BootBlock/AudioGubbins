import { expect } from '@playwright/test';

import {
  crashGpuProcess,
  expectDrawnAsShown,
  expectLabelled,
  expectSpectrogramDrawn,
  openWithCapabilities,
  rendererReport,
} from './renderer.js';
import {
  drawPattern,
  expectCanvasHoldsNoTiles,
  expectPatternDrawn,
  expectRecovered,
  expectRedrawnAsBefore,
  offeredBackends,
  openHarness,
  openOn,
} from './renderer-field.js';
import { test } from './test.js';

/**
 * The editor's reduced renderer (REQ-AUDIO-082, ADR-0044): in a Chromium with
 * WebGL switched off, the view draws with Canvas 2D and says why, and draws
 * again, its labels as well, when the GPU process that holds both of its
 * canvases' contexts crashes. The browser gives the geometry's context back
 * before the overlay's, so the overlay is only painted if the renderer hears
 * that its own context is back. What it draws is read from the page's pixels.
 */
test.describe('the editor renderer', () => {
  test('draws with Canvas 2D where WebGL is switched off, and says why', async ({ page }) => {
    const panel = await openWithCapabilities(page);

    await expect(rendererReport(page)).toContainText('Drawn with Canvas 2D.');
    await expect(rendererReport(page)).toContainText('WebGL 2: not available');
    await expectDrawnAsShown(page, panel);
    await expectLabelled(page, panel);
  });

  test('draws the spectrogram the worker makes with Canvas 2D', async ({ page }) => {
    const panel = await openWithCapabilities(page);
    await expect(rendererReport(page)).toContainText('Drawn with Canvas 2D.');
    await expectSpectrogramDrawn(page, panel);
  });

  test('draws the view and its labels again when the GPU process crashes', async ({
    page,
    browser,
  }) => {
    const panel = await openWithCapabilities(page);
    await expectDrawnAsShown(page, panel);
    await expectLabelled(page, panel);

    await crashGpuProcess(browser);

    await expect(rendererReport(page)).toContainText('Lost 1 times, recovered 1.', {
      timeout: 10_000,
    });
    await expect(rendererReport(page)).toContainText('Drawn with Canvas 2D.');
    await expectDrawnAsShown(page, panel);
    await expectLabelled(page, panel);
  });
});

/**
 * A field batch (ADR-0082) in the same Chromium, drawn by the editor's renderer
 * on the renderer harness: through its ramp on Canvas 2D, read back by pixel,
 * drawn again as it was when the GPU process crashes, and composed tile after
 * tile on one canvas, with no texture held for any.
 */
test.describe('a field batch', () => {
  test('is drawn through its ramp by Canvas 2D, the one backend offered', async ({ page }) => {
    await openHarness(page);
    expect(await offeredBackends(page)).toEqual(['canvas-2d']);
    await openOn(page, 'canvas-2d');
    await drawPattern(page);
    await expectPatternDrawn(page);
  });

  test('is drawn again as it was when the GPU process crashes', async ({ page, browser }) => {
    await openHarness(page);
    await openOn(page, 'canvas-2d');
    await drawPattern(page);
    const before = await expectPatternDrawn(page);

    await crashGpuProcess(browser);

    await expectRecovered(page, 1);
    await expectRedrawnAsBefore(page, before);
  });

  test('is composed tile after tile on one canvas, holding nothing per tile', async ({ page }) => {
    await openHarness(page);
    await openOn(page, 'canvas-2d');
    await expectCanvasHoldsNoTiles(page);
  });
});
