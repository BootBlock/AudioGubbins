import { expect, type Locator, type Page } from '@playwright/test';

import { openAsset, runCommand } from './editor.js';

/**
 * What the renderer suites share: the renderer report of the editor view, as
 * the Capabilities panel lists it, the tone bursts opened beside that panel,
 * and a WebGL 2 context taken away and given back. Each suite runs in the
 * Chromium its project launches: with WebGPU on a software adapter, without
 * one, or with WebGL switched off.
 */

/** The renderer report of the one editor view, as the Capabilities panel lists it. */
export function rendererReport(page: Page): Locator {
  return page.locator('.ag-capability[data-ag-renderer]');
}

/** Opens the tone bursts, and the Capabilities panel beside the editor. */
export async function openWithCapabilities(page: Page): Promise<Locator> {
  const panel = await openAsset(page, 'Tone bursts');
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
