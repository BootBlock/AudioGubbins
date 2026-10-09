import { expect, type Locator, type Page } from '@playwright/test';

import { noise, sine, wavFile } from '../../packages/test-fixtures/src/index.js';
import { runCommand } from './editor.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * The assistants, driven in a real browser (ADR-0062): a recording with
 * clicks and a mains hum is imported into a project, the detection worker the
 * built application starts analyses it, the Analysis panel shows what it
 * found and recommends, the Repair recommendation is applied through the
 * project's commands, and one undo takes it away again.
 *
 * As in the core-editing spec, the page is given a browser without the File
 * System Access pickers, which Playwright cannot answer, and the file is
 * chosen through the file input the application falls back to.
 */

const RATE = 48_000;
const LENGTH = 3 * RATE;

/** Where each click starts. */
const CLICKS = [36_000, 84_000, 120_000] as const;

/**
 * Three seconds of a held note under a 60 Hz hum and a little hiss, with a
 * scratch's click at each of `CLICKS`, as a WAV file's bytes.
 */
function scratchyWav(): Uint8Array<ArrayBuffer> {
  const scratchy = sine(440, { sampleRate: RATE, length: LENGTH, amplitude: 0.3 });
  const [samples] = scratchy.channels;
  const [hum] = sine(60, { sampleRate: RATE, length: LENGTH, amplitude: 0.01 }).channels;
  const [hiss] = noise(5, { length: LENGTH, amplitude: 0.002 }).channels;
  const [burst] = noise(9, { length: 9, amplitude: 0.4 }).channels;
  if (samples === undefined) throw new Error('The note has no channel.');
  for (let frame = 0; frame < LENGTH; frame += 1) {
    samples[frame] = (samples[frame] ?? 0) + (hum?.[frame] ?? 0) + (hiss?.[frame] ?? 0);
  }
  for (const at of CLICKS) {
    for (let offset = 0; offset < 9; offset += 1) {
      samples[at + offset] = (samples[at + offset] ?? 0) + (burst?.[offset] ?? 0);
    }
  }
  return wavFile(scratchy);
}

/** The strip under the menu bar that says what project is open. */
function banner(page: Page): Locator {
  return page.getByRole('region', { name: 'Project' });
}

/** The panel whose heading is `title`. */
function panelTitled(page: Page, title: string): Locator {
  return page
    .locator('section.ag-panel')
    .filter({ has: page.getByRole('heading', { name: title, level: 2, exact: true }) });
}

/**
 * A note from 0.3 s to 1.3 s and from 2.3 s to 3.3 s, digital silence
 * before, between and after, to 3.7 s, as a WAV file's bytes.
 */
function pausedWav(): Uint8Array<ArrayBuffer> {
  const length = Math.round(3.7 * RATE);
  const paused = sine(440, { sampleRate: RATE, length, amplitude: 0.3 });
  const [samples] = paused.channels;
  if (samples === undefined) throw new Error('The note has no channel.');
  for (let frame = 0; frame < length; frame += 1) {
    const seconds = frame / RATE;
    const sounding = (seconds >= 0.3 && seconds < 1.3) || (seconds >= 2.3 && seconds < 3.3);
    if (!sounding) samples[frame] = 0;
  }
  return wavFile(paused);
}

/** Makes a project, imports the scratchy recording into it, and waits for it to open. */
async function importScratchy(page: Page): Promise<void> {
  await importInto(page, 'Scratchy', scratchyWav());
}

/** Makes a project, imports `bytes` into it as `name`, and waits for it to open. */
async function importInto(page: Page, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  await banner(page).getByRole('button', { name: 'New project…' }).click();
  const dialogue = page.getByRole('dialog', { name: 'Projects' });
  await dialogue.getByRole('textbox', { name: 'Name' }).fill('Workshop');
  await dialogue.getByRole('button', { name: 'Make the project' }).click();
  await expect(dialogue).toBeHidden();
  const choosing = page.waitForEvent('filechooser');
  await menuBarMenu(page, 'File').click();
  await page.getByRole('menuitem', { name: 'Import audio…' }).click();
  await (
    await choosing
  ).setFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(bytes) });
  await expect(page.getByText(`“${name}” is imported and open.`).first()).toBeVisible();
}

test.describe('the assistants', () => {
  test.use({ viewport: { width: 1280, height: 1400 } });

  test('find the clicks and the hum, apply the repair in one step, and undo it', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
        Reflect.deleteProperty(window, picker);
      }
    });
    await openFresh(page);
    await importScratchy(page);
    await runCommand(page, 'Show the Analysis panel');
    // Beside the Inspector, where a panel has the window's height to list in.
    await runCommand(page, 'Move this panel to the right');
    const panel = panelTitled(page, 'Analysis');

    await panel.getByRole('button', { name: 'Analyse the audio' }).click();

    const repair = panel.getByRole('region', { name: 'Repair' });
    await expect(repair).toBeVisible({ timeout: 60_000 });
    await expect(repair.getByText(/^Clicks: \d+$/u)).toBeVisible();
    const restoration = panel.getByRole('region', { name: 'Restoration' });
    await expect(restoration.getByText('Mains hums: 1')).toBeVisible();
    await expect(restoration.getByText(/A de-hum at fundamental 60 Hz/u)).toBeVisible();
    await expect(
      repair.getByText(/A de-click at sensitivity 8, for the \d+ clicks found\./u),
    ).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath('analysis-panel.png') });

    await repair.getByRole('button', { name: 'Apply the Repair recommendation' }).click();

    await expect(
      page.getByText('Applied the Repair recommendation to all of Scratchy: de-click.').first(),
    ).toBeVisible();
    await expect(panel.getByText(/The audio has changed since it was analysed, so/u)).toBeVisible();
    await expect(
      repair.getByRole('button', { name: 'Apply the Repair recommendation' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await panel.screenshot({ path: testInfo.outputPath('analysis-panel-applied.png') });

    await runCommand(page, 'Undo');

    await expect(panel.getByText(/The audio has changed since it was analysed, so/u)).toBeHidden();
    await expect(
      repair.getByRole('button', { name: 'Apply the Repair recommendation' }),
    ).toHaveAttribute('aria-disabled', 'false');
  });

  test('find the silence at the edges and the long pause, and take it out in one step', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      for (const picker of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
        Reflect.deleteProperty(window, picker);
      }
    });
    await openFresh(page);
    await importInto(page, 'Paused', pausedWav());
    await runCommand(page, 'Show the Analysis panel');
    await runCommand(page, 'Move this panel to the right');
    const panel = panelTitled(page, 'Analysis');

    await panel.getByRole('button', { name: 'Analyse the audio' }).click();

    const silence = panel.getByRole('region', { name: 'Silence' });
    await expect(silence).toBeVisible({ timeout: 60_000 });
    await expect(silence.getByText('Silent stretches: 3')).toBeVisible();
    await expect(silence.getByText(/^2 silent stretches at the edges\./u)).toBeVisible();
    await expect(silence.getByText(/^1 long pause, shortened to the pause kept\./u)).toBeVisible();
    await silence.screenshot({ path: testInfo.outputPath('analysis-silence.png') });

    // A pause of a second is no pause once the shortest is two: analysed again.
    const shortest = silence.getByRole('textbox', { name: 'Shortest pause in s' });
    await shortest.fill('2');
    await shortest.press('Enter');
    await expect(silence.getByRole('textbox', { name: 'Shortest pause in s' })).toHaveValue('2', {
      timeout: 60_000,
    });
    await expect(silence.getByText(/^1 long pause/u)).toBeHidden();
    await expect(silence.getByText(/^2 silent stretches at the edges\./u)).toBeVisible();
    await silence.screenshot({ path: testInfo.outputPath('analysis-silence-settings.png') });

    await silence.getByRole('button', { name: 'Trim the silence at the edges' }).click();

    await expect(
      page.getByText('Removed the silence at the edges from all of Paused: 2 stretches.').first(),
    ).toBeVisible();
    await expect(panel.getByText(/The audio has changed since it was analysed, so/u)).toBeVisible();

    await runCommand(page, 'Undo');

    await expect(panel.getByText(/The audio has changed since it was analysed, so/u)).toBeHidden();
  });
});
