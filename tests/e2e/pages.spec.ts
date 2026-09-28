import { expect, type Response } from '@playwright/test';

import { test } from './test.js';

/**
 * AudioGubbins served from a sub-path, as a GitHub Pages project site is.
 *
 * REQ-PWA-031 requires GitHub Pages deployment, and the build takes its base
 * path from the environment for exactly that. The rest of the suite runs at the
 * origin's root, where an asset URL that ignored the base, a manifest link
 * written absolute, or a worker scoped to the wrong path would all work, so
 * these run against the production build under `/AudioGubbins/`.
 *
 * The project's base URL is the sub-path, so every navigation here is relative
 * to it: `./` is the application, and `/` would be the origin's root.
 */

test('starts under the sub-path and loads everything it needs from it', async ({ page }) => {
  const failures: string[] = [];
  const outside: string[] = [];
  page.on('response', (response: Response) => {
    const url = new URL(response.url());
    if (response.status() >= 400) failures.push(`${String(response.status())} ${url.pathname}`);
    if (url.protocol.startsWith('http') && !url.pathname.startsWith('/AudioGubbins/')) {
      outside.push(url.pathname);
    }
  });

  await page.goto('./');

  await expect(page.getByRole('menubar', { name: 'Main menu' })).toBeVisible();
  expect(failures).toEqual([]);
  expect(outside).toEqual([]);
});

test('links a manifest that resolves under the sub-path', async ({ page }) => {
  await page.goto('./');

  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/AudioGubbins/manifest.webmanifest');

  const response = await page.request.get(new URL(href ?? '', page.url()).toString());
  expect(response.status()).toBe(200);

  // Relative, so an installed application starts and stays inside the sub-path
  // rather than at the origin's root, where another project's site lives.
  const manifest = (await response.json()) as { name: string; start_url: string; scope: string };
  expect(manifest).toMatchObject({ name: 'AudioGubbins', start_url: '.', scope: '.' });
});

test('keeps what the user changes across a reload under the sub-path', async ({ page }) => {
  await page.goto('./');

  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Use the light theme' }).click();
  // Light before the reload as well, so the reload cannot come before the
  // change it is to keep.
  await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
  await page.reload();

  await expect(page.locator('.ag-theme-root')).toHaveAttribute('data-ag-theme', 'light');
});
