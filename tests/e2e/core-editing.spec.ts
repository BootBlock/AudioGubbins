import { expect, type Locator, type Page } from '@playwright/test';

import { sine, stereo, wavFile } from '../../packages/test-fixtures/src/index.js';
import { editorPanel, runCommand } from './editor.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * Core non-destructive editing, driven in a real browser: a WAV file is
 * imported into a project from the File menu and read by AudioGubbins' own
 * reader at its own rate, a marker is placed on it and it is edited, and after
 * a reload the same project holds the same asset, marker and edit (the packet's
 * `test:e2e:core-editing`, REQ-STOR-025, REQ-AUDIO-220, REQ-EDIT-014).
 *
 * Every step is taken as a person takes it, through the banner, the menus, the
 * palette and the panels, and each assertion reads what the page shows. The
 * file is kept in the browser's private file system by the storage worker.
 *
 * Playwright cannot answer the File System Access pickers Chromium offers, so
 * the page is given a browser without them, as Firefox is, and the file is
 * chosen through the file input the application falls back to.
 */

/** One second of stereo at 44.1 kHz, as a WAV file's bytes. */
const HARBOUR_WAV = wavFile(
  stereo(
    sine(440, { sampleRate: 44_100, length: 44_100, amplitude: 0.5 }),
    sine(660, { sampleRate: 44_100, length: 44_100, amplitude: 0.25 }),
  ),
);

/** The strip under the menu bar that says what project is open. */
function banner(page: Page): Locator {
  return page.getByRole('region', { name: 'Project' });
}

/** Chooses an entry of a menu of the menu bar. */
async function chooseFromMenu(page: Page, menu: string, entry: string): Promise<void> {
  await menuBarMenu(page, menu).click();
  await page.getByRole('menuitem', { name: entry }).click();
}

/** Makes a project through the banner's New project button, and waits for it to open. */
async function makeProject(page: Page, name: string): Promise<void> {
  await banner(page).getByRole('button', { name: 'New project…' }).click();
  const dialogue = page.getByRole('dialog', { name: 'Projects' });
  await dialogue.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialogue.getByRole('button', { name: 'Make the project' }).click();
  await expect(dialogue).toBeHidden();
  await expect(banner(page).getByText(`"${name}"`, { exact: true })).toBeVisible();
}

/** The panel whose heading is `title`. */
function panelTitled(page: Page, title: string): Locator {
  return page
    .locator('section.ag-panel')
    .filter({ has: page.getByRole('heading', { name: title, level: 2, exact: true }) });
}

/** The list of the asset's edits in the Inspector. */
function editsListed(page: Page): Locator {
  return panelTitled(page, 'Inspector')
    .getByRole('heading', { name: 'Its edits' })
    .locator('xpath=following-sibling::*[1]');
}

test.describe('core non-destructive editing', () => {
  test('imports a file, marks and edits it, and finds the same project after a reload', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
        Reflect.deleteProperty(window, picker);
      }
    });
    await openFresh(page);
    await makeProject(page, 'Harbour walk');

    const choosing = page.waitForEvent('filechooser');
    await chooseFromMenu(page, 'File', 'Import audio…');
    await (
      await choosing
    ).setFiles({ name: 'Harbour.wav', mimeType: 'audio/wav', buffer: Buffer.from(HARBOUR_WAV) });
    await expect(page.getByText('"Harbour" is imported and open.').first()).toBeVisible();

    const editor = editorPanel(page);
    await runCommand(page, 'Add a marker at the playhead');
    await expect(editor.getByRole('list', { name: 'Markers' }).getByRole('listitem')).toHaveCount(
      1,
    );
    await runCommand(page, 'Reverse');
    await runCommand(page, 'Show the Inspector panel');
    const inspector = panelTitled(page, 'Inspector');
    await expect(inspector.getByText('44.1 kHz', { exact: true })).toBeVisible();
    await expect(editsListed(page)).toContainText('Reversed from');
    await expect(
      page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
    ).toBeVisible();

    await page.reload();

    await expect(banner(page).getByText('"Harbour walk"', { exact: true })).toBeVisible();
    await runCommand(page, 'Show the Assets panel');
    const browser = panelTitled(page, 'Assets');
    await browser.getByRole('button', { name: 'Harbour', exact: true }).click();
    await runCommand(page, 'Show the Inspector panel');
    await expect(editsListed(page)).toContainText('Reversed from');
    await expect(
      editorPanel(page).getByRole('list', { name: 'Markers' }).getByRole('listitem'),
    ).toHaveCount(1);
  });
});
