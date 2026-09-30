import { expect } from '@playwright/test';

import {
  crashGpuProcess,
  expectDrawnAsShown,
  expectLabelled,
  openWithCapabilities,
  rendererReport,
} from './renderer.js';
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
