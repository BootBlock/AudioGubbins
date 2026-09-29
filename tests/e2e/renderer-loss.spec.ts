import { expect } from '@playwright/test';

import { readingOf, surfaceOf } from './editor.js';
import { openWithCapabilities, rendererReport, webglLoss } from './renderer.js';
import { test } from './test.js';

/**
 * The editor's renderer losing its WebGL 2 context (the packet's
 * `test:renderer-loss`, REQ-AUDIO-152, ADR-0044), in a Chromium that offers no
 * WebGPU adapter: the context given back, and never given back, when the
 * renderer steps down to Canvas 2D. Each is read from what the Capabilities
 * panel says of the view's renderer, and the view is proved still to draw from
 * its state by the readings beside it after a change made while the context was
 * away.
 */
test.describe('the editor renderer', () => {
  test('recovers a WebGL 2 context given back, and draws the view as it now is', async ({
    page,
  }) => {
    const panel = await openWithCapabilities(page);
    await expect(rendererReport(page)).toHaveAttribute('data-ag-renderer', 'webgl2');

    await webglLoss(page, 'loseContext');
    await expect(rendererReport(page)).toContainText('The graphics device was lost');
    // A change made while the device is away is the state the next frame shows.
    await surfaceOf(panel).press('ArrowUp');
    const zoom = await readingOf(panel, 'Zoom').innerText();
    await webglLoss(page, 'restoreContext');

    await expect(rendererReport(page)).toContainText('Drawn with WebGL 2.');
    await expect(rendererReport(page)).toContainText('Lost 1 times, recovered 1.');
    await expect(readingOf(panel, 'Zoom')).toHaveText(zoom);
  });

  test('steps down to Canvas 2D when the WebGL 2 context never comes back', async ({ page }) => {
    await openWithCapabilities(page);
    await webglLoss(page, 'loseContext');

    await expect(rendererReport(page)).toContainText('Drawn with Canvas 2D.', { timeout: 10_000 });
    await expect(rendererReport(page)).toContainText('WebGL 2: stopped');
    await expect(rendererReport(page)).toHaveAttribute('data-ag-renderer', 'canvas-2d');
  });
});
