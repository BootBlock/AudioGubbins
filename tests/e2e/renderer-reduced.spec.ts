import { expect } from '@playwright/test';

import { openWithCapabilities, rendererReport } from './renderer.js';
import { test } from './test.js';

/**
 * The editor's reduced renderer (REQ-AUDIO-082, ADR-0044): in a Chromium with
 * WebGL switched off, the view draws with Canvas 2D and says why.
 */
test.describe('the editor renderer', () => {
  test('draws with Canvas 2D where WebGL is switched off, and says why', async ({ page }) => {
    await openWithCapabilities(page);

    await expect(rendererReport(page)).toContainText('Drawn with Canvas 2D.');
    await expect(rendererReport(page)).toContainText('WebGL 2: not available');
  });
});
