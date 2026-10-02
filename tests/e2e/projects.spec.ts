import { createHash } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import { runCommand } from './editor.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * Projects kept in the browser, driven in a real one: made, changed and kept
 * across a reload; open in two tabs at once, where one writes and the other
 * reads, is handed over and is taken over; taken out as a bundle and brought
 * back in; and stored data of another version, which blocks every project until
 * the person decides (REQ-STOR-021, REQ-STOR-098, REQ-STOR-099, REQ-STOR-052).
 *
 * Every step is taken as a person takes it, through the banner, the menus and
 * the Projects dialogue, and each assertion reads what the page shows. The
 * storage is the browser's own private file system, written by the storage
 * worker, and the tabs agree on who writes through the browser's own locks, so
 * this is where the parts no unit test can reach are proved together.
 */

/** The strip under the menu bar that says what project is open. */
function banner(page: Page): Locator {
  return page.getByRole('region', { name: 'Project' });
}

/** The Projects dialogue. */
function projectsDialogue(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Projects' });
}

/** Makes a project through the banner's New project button, and waits for it to open. */
async function makeProject(page: Page, name: string): Promise<void> {
  await banner(page).getByRole('button', { name: 'New project…' }).click();
  const dialogue = projectsDialogue(page);
  await dialogue.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialogue.getByRole('button', { name: 'Make the project' }).click();
  await expect(dialogue).toBeHidden();
  await expect(banner(page).getByText(`"${name}"`, { exact: true })).toBeVisible();
}

/** Chooses an entry of a menu of the menu bar. */
async function chooseFromMenu(page: Page, menu: string, entry: string): Promise<void> {
  await menuBarMenu(page, menu).click();
  await page.getByRole('menuitem', { name: entry }).click();
}

/** Renames the open project through the Projects dialogue's This project section. */
async function renameProject(page: Page, name: string): Promise<void> {
  await chooseFromMenu(page, 'File', 'Rename, fork or export…');
  const dialogue = projectsDialogue(page);
  const field = dialogue.getByRole('textbox', { name: 'Project name' });
  await field.fill(name);
  await dialogue.getByRole('button', { name: 'Rename', exact: true }).click();
  // Said in the dialogue, which hides the page behind it until it closes.
  await expect(dialogue.getByText(`The project is now called "${name}".`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialogue).toBeHidden();
  await expect(banner(page).getByText(`"${name}"`, { exact: true })).toBeVisible();
}

/** Whether every change of the open project is saved, as the status bar says. */
async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved')).toBeVisible();
}

test.describe('projects kept in the browser', () => {
  test('keeps a project it made, and a change made to it, across a reload', async ({ page }) => {
    await openFresh(page);
    await expect(banner(page).getByText('No project is open.')).toBeVisible();

    await makeProject(page, 'Forest walk');
    await renameProject(page, 'Forest walk at dawn');
    await expectSaved(page);

    await page.reload();

    // Opened again at the start, as the person left it, with its history: the
    // rename is there to undo.
    await expect(banner(page).getByText('"Forest walk at dawn"', { exact: true })).toBeVisible();
    await menuBarMenu(page, 'Edit').click();
    await expect(page.getByRole('menuitem', { name: /^Undo Rename/ })).toBeEnabled();
    await page.keyboard.press('Escape');
  });

  test('opens a project another tab is changing to read, names that tab, and hands it over and back', async ({
    context,
    page,
  }) => {
    await openFresh(page);
    await makeProject(page, 'Harbour');
    await expectSaved(page);

    // A second tab of the same browser opens the project last open, and finds
    // the first tab writing it.
    const second = await context.newPage();
    await second.goto('/');
    await expect(
      banner(second).getByText(
        /"Harbour" is open to read here, because the tab opened at \d\d:\d\d:\d\d is changing it\./,
      ),
    ).toBeVisible();

    // Asked, the first tab hands it over, and reads it from then on.
    await banner(second).getByRole('button', { name: 'Ask to change it' }).click();
    await expect(banner(page).getByText(/asks to change "Harbour"/)).toBeVisible();
    await banner(page).getByRole('button', { name: 'Hand it over' }).click();
    await expect(banner(second).getByText(/is open to read here/)).toBeHidden();
    await expect(
      banner(page).getByText(/"Harbour" is open to read here, because the tab opened at/),
    ).toBeVisible();

    // The first tab takes it back, after reading what that costs, and the
    // second is told which tab took it.
    await banner(page).getByRole('button', { name: 'Take over…' }).click();
    await expect(banner(page).getByText(/Anything it has not saved yet is lost\./)).toBeVisible();
    await banner(page).getByRole('button', { name: 'Take over now' }).click();
    await expect(banner(page).getByText(/is open to read here/)).toBeHidden();
    await expect(
      banner(second).getByText(
        /^The tab opened at \d\d:\d\d:\d\d took "Harbour" over, so this tab can no longer change it\./,
      ),
    ).toBeVisible();

    // The first tab changes it, which the second could not.
    await renameProject(page, 'Harbour, taken back');
    await expectSaved(page);
  });

  test('fits each point of the History panel to its width, cutting the description short and not the time or marks', async ({
    page,
  }) => {
    await openFresh(page);
    await makeProject(page, 'Harbour');
    await renameProject(page, 'Harbour seen from the far end of the long sea wall at dusk');
    await expectSaved(page);
    await runCommand(page, 'Show the History panel');

    const list = page.getByRole('listbox', { name: 'Points in the history' });
    const current = list.getByRole('option').last();
    await expect(current.getByText('Current', { exact: true })).toBeVisible();
    const line = await current.locator('.ag-history-row-line').boundingBox();
    if (line === null) throw new Error('The point is not drawn.');
    for (const part of await current.locator('.ag-history-row-time, .ag-history-row-mark').all()) {
      const box = await part.boundingBox();
      expect(box, 'a time or a mark is drawn').not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(line.x + line.width + 0.5);
    }
    const description = current.locator('.ag-history-row-description');
    expect(await description.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
      true,
    );
  });

  test('exports a project as a bundle and brings the bundle back in', async ({ page }, info) => {
    // Without the pickers, as every browser but Chromium is: the bundle is a
    // download, and the bundle to bring in is chosen through the file input,
    // both of which the harness can answer.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'showSaveFilePicker');
    });
    await openFresh(page);
    await makeProject(page, 'Night market');
    await renameProject(page, 'Night market, mixed');
    await expectSaved(page);

    const downloading = page.waitForEvent('download');
    await chooseFromMenu(page, 'File', 'Export as a bundle…');
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('Night market, mixed.zip');
    const bundle = info.outputPath('bundle.zip');
    await download.saveAs(bundle);
    // Said aloud and shown, so the words are on the page twice.
    await expect(
      page.getByText('"Night market, mixed" is exported as a bundle.').first(),
    ).toBeVisible();

    // Brought in while this browser keeps the project, it comes in as a copy
    // beside it, with the name and the history it was exported with.
    const choosing = page.waitForEvent('filechooser');
    await chooseFromMenu(page, 'File', 'Import a bundle…');
    await (await choosing).setFiles(bundle);
    await expect(
      page.getByText(/"Night market, mixed" is brought in as a copy/).first(),
    ).toBeVisible();

    await chooseFromMenu(page, 'File', 'Open project…');
    const list = projectsDialogue(page).getByRole('list', { name: 'Projects' });
    await expect(list.getByText('Night market, mixed', { exact: true })).toHaveCount(2);
  });

  test('blocks every project on stored data of another version until the person decides', async ({
    page,
  }) => {
    // Stored data written by an earlier version, put in the browser's private
    // storage from a blank page of the same origin, answered here so that
    // AudioGubbins does not run and read the storage first. A file the server
    // has would not do: Firefox downloads what it does not show.
    const body = '{"writtenBy":"0.0.9"}';
    const checksum = createHash('sha256').update(body).digest('hex');
    const root = `{"body":${body},"checksum":"${checksum}","kind":"storage-root","schemaVersion":0}`;
    await page.route('**/storage-seed', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Seed</title>' }),
    );
    await page.goto('/storage-seed');
    await page.evaluate(async (text) => {
      const directory = await navigator.storage.getDirectory();
      const file = await directory.getFileHandle('storage.json', { create: true });
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
    }, root);

    // Not `openFresh`: the screen blocks the page, so the menu bar behind it is
    // hidden from the reader until a decision is made.
    await page.goto('/');
    const screen = page.getByRole('dialog', { name: 'Your stored projects need a decision' });
    await expect(screen).toBeVisible();
    await expect(
      screen.getByText(/saved in format 0, and this version of AudioGubbins reads format 1/),
    ).toBeVisible();

    // Deciding later leaves the data as it is, and every project unavailable.
    await screen.getByRole('button', { name: 'Decide later' }).click();
    await expect(screen).toBeHidden();
    await expect(banner(page).getByText(/made by another version of AudioGubbins/)).toBeVisible();
    await menuBarMenu(page, 'File').click();
    await expect(page.getByRole('menuitem', { name: 'New project…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');

    // Removing it asks a second time, and then projects can be made.
    await banner(page).getByRole('button', { name: 'Decide now' }).click();
    await screen.getByRole('button', { name: 'Remove the stored data…' }).click();
    await screen.getByRole('button', { name: 'Remove everything for good' }).click();
    await expect(screen).toBeHidden();
    await expect(banner(page).getByText('No project is open.')).toBeVisible();
    await makeProject(page, 'Afresh');
  });
});
