import { expect } from '@playwright/test';

import { readingOf, surfaceOf } from './editor.js';
import {
  destroyWebGpuDevice,
  expectDrawnAsShown,
  expectLabelled,
  openWithCapabilities,
  rendererReport,
} from './renderer.js';
import {
  TILE_BUDGET,
  drawPattern,
  expectPatternDrawn,
  expectRecovered,
  expectRedrawnAsBefore,
  expectTilesWithinBudget,
  fieldTextures,
  offeredBackends,
  openHarness,
  openOn,
} from './renderer-field.js';
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

    await destroyWebGpuDevice(page);
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

/**
 * A field batch (ADR-0082) in the same Chromium, drawn by the editor's renderer
 * on the renderer harness: through its ramp on WebGPU, WebGL 2 and Canvas 2D,
 * each read back by pixel, drawn again as it was on the device asked for once
 * the one it drew with is destroyed, and held within its texture budget.
 */
test.describe('a field batch', () => {
  test('is drawn through its ramp by every backend the browser offers', async ({ page }) => {
    await openHarness(page);
    const offered = await offeredBackends(page);
    expect(offered).toEqual(['webgpu', 'webgl2', 'canvas-2d']);
    for (const kind of offered) {
      await openOn(page, kind);
      await drawPattern(page);
      await expectPatternDrawn(page);
    }
  });

  test('is uploaded and drawn again as it was on the WebGPU device asked for after a loss', async ({
    page,
  }) => {
    await openHarness(page);
    await openOn(page, 'webgpu');
    await drawPattern(page);
    const before = await expectPatternDrawn(page);
    const uploaded = await fieldTextures(page);
    expect(uploaded.held).toBe(1);

    await destroyWebGpuDevice(page);

    await expectRecovered(page, 1);
    await expectRedrawnAsBefore(page, before);
    const again = await fieldTextures(page);
    expect(again.made - uploaded.made, 'field textures uploaded again').toBe(1);
    expect(again.held).toBe(1);
  });

  test('holds no WebGPU texture for a tile it does not draw, beyond its budget', async ({
    page,
  }) => {
    await openHarness(page);
    await openOn(page, 'webgpu', TILE_BUDGET);
    await expectTilesWithinBudget(page);
  });
});
