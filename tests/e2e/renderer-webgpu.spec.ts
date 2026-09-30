import { expect } from '@playwright/test';

import { readingOf, surfaceOf } from './editor.js';
import {
  expectDrawnAsShown,
  expectLabelled,
  openWithCapabilities,
  rendererReport,
} from './renderer.js';
import { test } from './test.js';

/**
 * The editor's renderer losing its WebGPU device (the packet's
 * `test:renderer-loss`, ADR-0044), in a Chromium that offers WebGPU on a
 * software adapter: the device destroyed, and another asked for. What it draws
 * is read from the page's pixels before the loss and after the recovery, where
 * the view is drawn as it is after a change made as the device was lost.
 */
test.describe('the editor renderer', () => {
  test('asks for another WebGPU device when the one it drew with is destroyed', async ({
    page,
  }) => {
    const panel = await openWithCapabilities(page);
    await expect(rendererReport(page)).toHaveAttribute('data-ag-renderer', 'webgpu', {
      timeout: 15_000,
    });
    await expectDrawnAsShown(page, panel);
    const before = await readingOf(panel, 'Zoom').innerText();

    await page.evaluate(() => {
      // Read without the WebGPU type definitions, which the suites are not
      // compiled with: the context's configuration names the device it draws
      // on.
      const canvas = document.querySelector<HTMLCanvasElement>('.ag-editor-canvas-geometry');
      const context: unknown = canvas?.getContext('webgpu');
      const member = (host: unknown, name: string): unknown =>
        typeof host === 'object' && host !== null ? Reflect.get(host, name) : undefined;
      const configuration = member(context, 'getConfiguration');
      if (typeof configuration !== 'function')
        throw new Error('The view draws with no WebGPU context.');
      const device = member(Reflect.apply(configuration, context, []), 'device');
      const destroy = member(device, 'destroy');
      if (typeof destroy !== 'function') throw new Error('The WebGPU context names no device.');
      Reflect.apply(destroy, device, []);
    });
    // Whether the new device is given before or after it, the change is what
    // the view shows from then on.
    await surfaceOf(panel).press('ArrowUp');
    await expect(readingOf(panel, 'Zoom')).not.toHaveText(before);

    await expect(rendererReport(page)).toContainText('Lost 1 times, recovered 1.', {
      timeout: 15_000,
    });
    await expect(rendererReport(page)).toContainText('Drawn with WebGPU.');
    await expectDrawnAsShown(page, panel);
    await expectLabelled(page, panel);
  });
});
