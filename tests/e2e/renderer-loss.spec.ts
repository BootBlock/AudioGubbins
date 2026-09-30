import { expect } from '@playwright/test';

import { readingOf, surfaceOf } from './editor.js';
import {
  expectDrawnAsShown,
  expectLabelled,
  openWithCapabilities,
  rendererReport,
  webglLoss,
} from './renderer.js';
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
