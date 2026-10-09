import { expect, type Locator, type Page } from '@playwright/test';

import { editorPanel, runCommand, writeTimesAs } from './editor.js';
import {
  TAP_PROCESSOR,
  banner,
  hear,
  largestDifference,
  makeProject,
  panelTitled,
  selectRange,
  tapTheOutput,
} from './hearing.js';
import { openFresh } from './shell.js';
import { test } from './test.js';

/**
 * Recording, driven in a real browser with Chromium's fake input device and the
 * microphone granted (the packet's acceptance: "A browser test records with a
 * fake input, punches in over a range, chooses another take, reloads, and hears
 * the same project; another reloads mid-recording and recovers the committed
 * chunks").
 *
 * A take is recorded into a new stack; a punch is armed over a range of its
 * recording and two takes punched in; the other take is chosen, and one undo
 * gives the choice back; the punched sound is heard, the page reloaded, and it
 * is heard again, the same samples. In the second test the page is reloaded
 * while a take is recorded, and the opening offers what was committed, which
 * is recovered as a take.
 *
 * Every step is taken as a person takes it, through the palette, the Recording
 * panel, the editor and the project's banner.
 */

/** How long a take is recorded for before it is stopped, at least. */
const TAKE_SECONDS = 3;

/** The range punched, in frames of the 48 kHz take: from 1.2 s to 2 s. */
const PUNCHED = { start: 57_600, end: 96_000 } as const;

/** The Recording panel. */
function recordingPanel(page: Page): Locator {
  return panelTitled(page, 'Recording');
}

/** The take stack whose name is `name`, in the Recording panel. */
function stackNamed(page: Page, name: string): Locator {
  return recordingPanel(page)
    .locator('[data-ag-stack]')
    .filter({ has: page.getByRole('heading', { name, exact: true, level: 4 }) });
}

/** The take named `name` of `stack`. */
function takeIn(stack: Locator, name: string): Locator {
  return stack.locator('[data-ag-take]').filter({ hasText: new RegExp(`^${name}\\b`, 'u') });
}

/** Seconds of the take being recorded that storage has kept, as the status bar says them. */
async function keptSeconds(page: Page): Promise<number> {
  const item = page
    .getByRole('contentinfo', { name: 'Status' })
    .getByText(/: [\d.]+ s kept$/u)
    .first();
  if ((await item.count()) === 0) return 0;
  const match = /: (?<seconds>[\d.]+) s kept$/u.exec(await item.innerText());
  return Number(match?.groups?.['seconds'] ?? '0');
}

/** Arms the input from the palette and waits for the status bar to say it is armed. */
async function arm(page: Page): Promise<void> {
  await runCommand(page, 'Arm the input');
  await expect(page.getByRole('group', { name: 'Input', exact: true })).toContainText('armed');
}

/** Records until storage has kept at least `seconds`, from the palette. */
async function recordFor(page: Page, seconds: number): Promise<void> {
  await runCommand(page, 'Record');
  await expect.poll(() => keptSeconds(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(seconds);
}

/** Shows the panel titled `title`, where it is not shown already, which a reload keeps. */
async function showPanel(page: Page, title: string): Promise<void> {
  if (await panelTitled(page, title).isVisible()) return;
  await runCommand(page, `Show the ${title} panel`);
  await expect(panelTitled(page, title)).toBeVisible();
}

/** Opens the first sound the Assets panel lists as `name` in the editor. */
async function openFirst(page: Page, name: string): Promise<void> {
  await showPanel(page, 'Assets');
  await panelTitled(page, 'Assets').getByRole('button', { name, exact: true }).first().click();
  await expect(editorPanel(page).locator('.ag-editor-asset-name')).toHaveText(name);
}

test.describe('recording', () => {
  // Hearing taps the output with a worklet made from a blob, which the page's
  // policy refuses, so the policy is set aside for these pages alone, as the
  // effect rack's spec does; the smoke suite holds the page to it.
  test.use({ viewport: { width: 1280, height: 1400 }, bypassCSP: true });

  test('records a take, punches in twice, chooses another take, undoes, reloads, and hears the same project', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.addInitScript(tapTheOutput, TAP_PROCESSOR);
    await openFresh(page);
    await makeProject(page, 'Harbour');
    await showPanel(page, 'Recording');

    await test.step('A take is recorded with the fake input into a new stack', async () => {
      await arm(page);
      await recordFor(page, TAKE_SECONDS);
      await runCommand(page, 'Stop recording');
      const stack = stackNamed(page, 'Recording 1');
      await expect(takeIn(stack, 'Take 1')).toContainText('(chosen)');
    });

    const punch = stackNamed(page, 'Punch over “Take 1”');
    await test.step('A punch is armed over a range of the take, and two takes punched in', async () => {
      await openFirst(page, 'Take 1');
      const editor = editorPanel(page);
      await writeTimesAs(page, editor, 'Samples');
      // The fake input gives two channels, and a punch replaces every channel.
      await selectRange(page, editor, PUNCHED, 2);
      await runCommand(page, 'Arm a punch over the selection');
      await expect(page.getByRole('group', { name: 'Input', exact: true })).toContainText('armed');
      await runCommand(page, 'Record');
      await expect(takeIn(punch, 'Take 1')).toBeVisible({ timeout: 60_000 });
      await runCommand(page, 'Record');
      await expect(takeIn(punch, 'Take 2')).toContainText('(chosen)', { timeout: 60_000 });
    });

    await test.step('The other take is chosen, and one undo gives the choice back', async () => {
      await takeIn(punch, 'Take 1').getByRole('button', { name: 'Choose', exact: true }).click();
      await expect(takeIn(punch, 'Take 1')).toContainText('(chosen)');
      await expect(takeIn(punch, 'Take 2')).not.toContainText('(chosen)');
      await runCommand(page, 'Undo');
      await expect(takeIn(punch, 'Take 2')).toContainText('(chosen)');
      await expect(takeIn(punch, 'Take 1')).not.toContainText('(chosen)');
    });

    await runCommand(page, 'Disarm the input');
    await expect(
      page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
    ).toBeVisible();
    await openFirst(page, 'Take 1');
    const before = await hear(page);
    expect(before.left.length).toBeGreaterThan(0);

    await page.reload();
    await expect(banner(page).getByText('“Harbour”', { exact: true })).toBeVisible();

    await test.step('After the reload the punched take is heard again, the same samples', async () => {
      await showPanel(page, 'Recording');
      await expect(takeIn(punch, 'Take 2')).toContainText('(chosen)');
      await openFirst(page, 'Take 1');
      const after = await hear(page);
      expect(after.left.length).toBe(before.left.length);
      expect(largestDifference(after.left, before.left, 0, before.left.length)).toBe(0);
      expect(largestDifference(after.right, before.right, 0, before.right.length)).toBe(0);
    });
  });

  test('reloads while recording, and recovers what was committed from the offer', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openFresh(page);
    await makeProject(page, 'Breakwater');
    await showPanel(page, 'Recording');
    await arm(page);
    await recordFor(page, 2);

    await page.reload();
    const offer = banner(page).getByRole('group', { name: 'Recordings cut short' });
    await expect(offer).toContainText('A recording was cut short');
    await expect(offer).toContainText('It ended because');
    await offer.getByRole('button', { name: 'Recover', exact: true }).click();
    await expect(offer).toBeHidden();

    await showPanel(page, 'Recording');
    const stack = stackNamed(page, 'Recording 1');
    await expect(takeIn(stack, 'Take 1')).toContainText('(chosen)');
    await showPanel(page, 'Assets');
    await expect(panelTitled(page, 'Assets').getByText(/A recorded take: “Take 1”/u)).toBeVisible();
  });
});
