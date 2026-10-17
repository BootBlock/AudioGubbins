import { expect, type Locator, type Page } from '@playwright/test';

import { sine, wavFile } from '../../packages/test-fixtures/src/index.js';
import { editorPanel, runCommand } from './editor.js';
import { banner, makeProject, panelTitled, said } from './hearing.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * The game-audio workflows, driven in a real browser (the packet's
 * `test:e2e:game-workflows`; REQ-GAME-023, REQ-GAME-075, REQ-GAME-120,
 * REQ-GAME-121, REQ-GAME-122).
 *
 * A long recording of footsteps is cut into a dozen named regions of a new
 * group, `Footsteps/Grass`, without another source being made; the parent group
 * is given an export preset and a naming template, which `Grass` is seen to
 * inherit in the Inspector, a region overrides its profile and is reset, and
 * the group's export plan names every file and the group that owns each of its
 * values. Prepare One-Shot runs over the group as one step of the History, its
 * fades shown in the Inspector, and one undo takes it away. A hum is looped
 * whole, the Loop panel analyses it and lists candidates without moving the
 * loop, and a candidate is heard and applied by hand, one undoable step. The
 * Game preview triggers the group twenty times beside the looped hum, twice,
 * and the two runs' logs are the same under the seed, while the History is left
 * as it was. The group is exported into a folder, and after a reload the
 * groups, their policy, the loop and the scenario are found as they were.
 *
 * Every step is taken as a person takes it, through the menus, the palette,
 * the panels and the dialogs, and each assertion reads what the page shows.
 * Playwright cannot answer the browser's pickers, and the page reads them once
 * as it starts, all three or none (`storage-platform.ts`), so the page starts
 * without them, files being chosen through the file input it falls back to;
 * for the export it is reloaded with each replaced, the directory picker
 * giving a folder of the origin's private file system as the person's choice,
 * as the import and export suite does.
 */

const RATE = 48_000;

/** The project's name. */
const PROJECT = 'Meadow walk';

/** How many footsteps the long recording holds. */
const STEPS = 12;

/** A footstep, in frames: a fifth of a second. */
const STEP_LENGTH = RATE / 5;

/** The silence before, between and after the footsteps, in frames: half a second. */
const PAUSE = RATE / 2;

/**
 * The footsteps: {@link STEPS} bursts of a 440 Hz tone, each separated from
 * the next by half a second of digital silence, which the Silence assistant
 * finds and Cut Into Sounds cuts at. The tone is gated in place, so every
 * burst is a stretch of the one sine.
 */
function footstepsWav(): Uint8Array {
  const length = PAUSE + STEPS * (STEP_LENGTH + PAUSE);
  const signal = sine(440, { sampleRate: RATE, length, amplitude: 0.5 });
  const [samples] = signal.channels;
  if (samples === undefined) throw new Error('The sine has no channel.');
  for (let frame = 0; frame < length; frame += 1) {
    const within = (frame - PAUSE) % (STEP_LENGTH + PAUSE);
    if (frame < PAUSE || within >= STEP_LENGTH) samples[frame] = 0;
  }
  return wavFile(signal);
}

/**
 * A steady hum whose length is no whole number of its periods (437 Hz over
 * 95,000 frames is 864.9 periods), so looped whole its seam jumps in phase,
 * and the loop analysis has something to find and better points near it.
 */
function humWav(): Uint8Array {
  return wavFile(sine(437, { sampleRate: RATE, length: 95_000, amplitude: 0.4 }));
}

/** The group the footsteps are cut into, and its parent. */
const PARENT = 'Footsteps';
const GROUP = 'Grass';
const GROUP_PATH = `${PARENT}/${GROUP}`;

/** The naming the cut gives each region, and the naming the parent exports them by. */
const REGION_NAMING = 'step_{number:2}';
const EXPORT_NAMING = '{group:snake}_{number:2}';

/** The folder `Grass` exports into, inside the folder chosen. */
const DESTINATION = 'sfx/footsteps';

/** The export preset the parent's profile is set from, and the one a region overrides it by. */
const WAV_PRESET = 'Game effect, WAV 16-bit 48 kHz';
const OGG_PRESET = 'Game effect, Ogg Vorbis';

/** The `n`th region the cut makes, by its name. */
function stepName(n: number): string {
  return `step_${String(n).padStart(2, '0')}`;
}

/** The `n`th member's file, as the parent's naming names it. */
function stepFile(n: number): string {
  return `grass_${String(n).padStart(2, '0')}.wav`;
}

/** The region the hum is cut into, by the workflow's own naming. */
const HUM_REGION = 'engine_hum_01';

/** The folder of the private file system the directory picker gives. */
const CHOSEN_FOLDER = 'Game build';

/** The session's key that says which pickers the page is given as it starts. */
const PICKERS_KEY = 'audiogubbins-test-pickers';

/** How long an analysis, a workflow's analyses or an export may take. */
const WORKING = 120_000;

/**
 * Gives every page of the test the pickers `sessionStorage` asks for as it
 * starts: none at first, so files are chosen through the file input, and
 * stand-ins once the test asks for a folder to export into. Run before any
 * script of the page, which reads the pickers once.
 */
function choosePickers({ key, folder }: { key: string; folder: string }): void {
  const pickers = ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker'] as const;
  if (sessionStorage.getItem(key) !== 'folder') {
    for (const picker of pickers) Reflect.deleteProperty(window, picker);
    return;
  }
  const refuse = (): Promise<never> =>
    Promise.reject(new Error('The test chooses no file through a picker, only a folder.'));
  Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: refuse });
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: refuse });
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    value: async () =>
      await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true }),
  });
}

/** Every file under the chosen folder, by its path inside it, sorted. */
async function chosenFolderFiles(page: Page): Promise<readonly string[]> {
  const found = await page.evaluate(async (folder) => {
    const paths: string[] = [];
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of directory.entries()) {
        if (handle instanceof FileSystemDirectoryHandle) await walk(handle, `${prefix}${name}/`);
        else paths.push(`${prefix}${name}`);
      }
    };
    await walk(
      await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true }),
      '',
    );
    return paths;
  }, CHOSEN_FOLDER);
  return found.toSorted();
}

/** Chooses `entry` from the menu bar's `menu`. */
async function chooseFromMenu(page: Page, menu: string, entry: string): Promise<void> {
  await menuBarMenu(page, menu).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${escaped(entry)}`, 'u') }).click();
}

/** Chooses `option` in the field `label` of `within`. */
async function choose(page: Page, within: Locator, label: string, option: string): Promise<void> {
  const field = within.getByRole('combobox', { name: label, exact: true });
  await field.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(field).toContainText(option);
}

/** The panel titled `title`, shown from its command where it is not on the page. */
async function shownPanel(page: Page, title: string): Promise<Locator> {
  const panel = panelTitled(page, title);
  if (!(await panel.isVisible())) await runCommand(page, `Show the ${title} panel`);
  await expect(panel).toBeVisible();
  return panel;
}

/** Imports `bytes` as the WAV file `name` from the File menu, and waits for it to open. */
async function importWav(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await chooseFromMenu(page, 'File', 'Import audio…');
  await (
    await choosing
  ).setFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(bytes) });
  await said(page, `“${name}” is imported and open.`);
}

/** Opens the asset or region `name` from the Assets panel in the editor, and brings the editor into use. */
async function openFromAssets(page: Page, name: string): Promise<void> {
  await (await shownPanel(page, 'Assets')).getByRole('button', { name, exact: true }).click();
  const editor = editorPanel(page);
  await expect(editor.locator('.ag-editor-asset-name')).toHaveText(name);
  // A press in the editor brings it into use, which takes the Inspector back
  // from an asset group chosen in the tree.
  await editor.locator('.ag-editor-asset-name').click();
}

/** The project's assets, each the top of its row in the Assets panel, its regions under it. */
function assetRows(assets: Locator): Locator {
  return assets.getByRole('list', { name: 'The project’s audio' }).locator(':scope > li');
}

/** Waits for the status bar to say the project is saved. */
async function saved(page: Page): Promise<void> {
  await expect(page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved')).toBeVisible();
}

/** The group of the tree in the Asset groups panel called `name`, with its count of members. */
function treeItem(groups: Locator, name: string): Locator {
  return groups.getByRole('tree', { name: 'Asset groups' }).getByRole('treeitem', {
    name: new RegExp(`^(▸ )?${escaped(name)} \\(\\d+ members?\\)$`, 'u'),
  });
}

/** One field's row of the policy the Inspector shows, by the field's heading. */
function policyRow(inspector: Locator, heading: string): Locator {
  return inspector.getByRole('group', { name: heading, exact: true });
}

/**
 * Expects the policy row `row` to say where its value comes from, as its source
 * chip does, and, where given, to show `value`.
 */
async function expectSource(row: Locator, source: string, value?: string): Promise<void> {
  await expect(row.locator('.ag-source-chip')).toHaveText(source);
  if (value !== undefined) await expect(row.locator('.ag-policy-value')).toHaveText(value);
}

/** Opens the settings section `title` of `within`, where its fields are. */
async function openSettings(within: Locator, title: string): Promise<void> {
  const section = within.getByRole('button', { name: title, exact: true });
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await expect(section).toHaveAttribute('aria-expanded', 'true');
}

/** What the hint named `label` of `within` says, opened as a person opens it, then closed. */
async function hintOf(page: Page, within: Locator, label: string): Promise<Locator> {
  await within.getByRole('button', { name: label, exact: true }).click();
  const said = page.getByRole('dialog', { name: label, exact: true });
  await expect(said).toBeVisible();
  return said;
}

/** The History's points, each by its description, and which is the current one. */
async function historyPoints(
  page: Page,
): Promise<{ readonly descriptions: readonly string[]; readonly current: number }> {
  const history = await shownPanel(page, 'History');
  const options = history
    .getByRole('listbox', { name: 'Points in the history' })
    .getByRole('option');
  await expect(options.first()).toBeVisible();
  const descriptions = await options.locator('.ag-history-row-description').allTextContents();
  const marks = await options.evaluateAll((all) =>
    all.map((option) => option.textContent.includes('Current')),
  );
  return { descriptions, current: marks.indexOf(true) };
}

/** A guided workflow's dialog, called by the workflow's name. */
function workflowDialog(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name });
}

/**
 * Runs the analyses `dialog`'s workflow needs, waits for every sound to be
 * analysed, applies the plan with nothing refused, and closes the dialog.
 */
async function analyseAndApply(dialog: Locator): Promise<void> {
  const analyses = dialog.getByRole('region', { name: 'Analyses' });
  await analyses.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(analyses.getByRole('status')).toHaveText(
    /^(?<count>\d+) sounds? (is|are) analysed as (it is|they are) now, of \k<count>\.$/u,
    { timeout: WORKING },
  );
  const plan = dialog.getByRole('region', { name: 'What it will do' });
  await expect(plan.locator('.ag-workflow-summary')).toHaveText(/^\d+ items? to change\.$/u);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Done' }).getByRole('status')).toHaveText(
    /^Applied as one step, “.+” in the History panel; one undo reverses it\./u,
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * The rows of the preview's event log as the table shows them, once the
 * footsteps' twenty triggers have all started and played out beside the
 * looped hum, which sounds on.
 */
async function finishedLog(preview: Locator): Promise<readonly string[]> {
  await expect(
    preview.getByRole('table', { name: /^The latest \d+ events heard, oldest first$/u }),
  ).toBeVisible({ timeout: WORKING });
  const page = preview.page();
  const counts = await hintOf(page, preview, 'How many events of each kind were heard');
  await expect(counts).toHaveText(/^21 voices started; 0 stolen and 0 refused/u, {
    timeout: WORKING,
  });
  await page.keyboard.press('Escape');
  const steps = preview.getByRole('region', { name: 'Emitter 1', exact: true });
  const hum = preview.getByRole('region', { name: 'Emitter 2', exact: true });
  await expect(steps.getByText('Sounding 0 of 8 voices.', { exact: true })).toBeVisible({
    timeout: WORKING,
  });
  await expect(hum.getByText('Sounding 1 of 8 voices.', { exact: true })).toBeVisible();
  const rows = preview
    .getByRole('table', { name: /^The latest \d+ events heard, oldest first$/u })
    .locator('tbody tr');
  // Twenty-one starts and the twenty footsteps that played to their end.
  await expect(rows).toHaveCount(41);
  return await rows.evaluateAll((all) =>
    all.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent).join(' | ')),
  );
}

test.describe('game-audio workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(choosePickers, { key: PICKERS_KEY, folder: CHOSEN_FOLDER });
  });

  test('cuts a recording into a group, prepares and loops its sounds, previews them, exports the group and finds it all after a reload', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await openFresh(page);
    await makeProject(page, PROJECT);

    await test.step('The long recording is imported, one asset in the project', async () => {
      await importWav(page, 'Footsteps take', footstepsWav());
      await expect(assetRows(await shownPanel(page, 'Assets'))).toHaveCount(1);
    });

    await test.step('Cut Into Sounds makes a named region of each footstep in a new group, and no new source', async () => {
      await runCommand(page, 'Cut Into Sounds');
      const dialog = workflowDialog(page, 'Cut Into Sounds');
      await expect(dialog.getByRole('combobox', { name: 'Run it on' })).toContainText(
        'The sound “Footsteps take”',
      );
      await choose(page, dialog, 'Put the sounds in', 'A new group…');
      await dialog.getByRole('textbox', { name: 'New group' }).fill(GROUP_PATH);
      await dialog.getByRole('textbox', { name: 'Naming' }).fill(REGION_NAMING);
      await dialog.getByRole('textbox', { name: 'Shortest pause between sounds' }).fill('0.25');
      await analyseAndApply(dialog);
      await saved(page);

      const assets = await shownPanel(page, 'Assets');
      await expect(assetRows(assets)).toHaveCount(1);
      await expect(
        assets.getByRole('list', { name: 'Regions of Footsteps take' }).getByRole('listitem'),
      ).toHaveCount(STEPS);

      const groups = await shownPanel(page, 'Asset groups');
      await expect(treeItem(groups, PARENT)).toHaveAccessibleName(`${PARENT} (0 members)`);
      await treeItem(groups, GROUP).click();
      await expect(
        groups.getByRole('table', { name: `Members of ${GROUP_PATH}` }).getByRole('rowheader'),
      ).toHaveText(Array.from({ length: STEPS }, (_, index) => `“${stepName(index + 1)}”`));
    });

    await test.step('The parent is given an export preset and a naming template, which Grass inherits', async () => {
      const groups = await shownPanel(page, 'Asset groups');
      await treeItem(groups, PARENT).click();
      const inspector = await shownPanel(page, 'Inspector');
      await expect(
        inspector.getByRole('heading', { name: `Asset group: ${PARENT}`, exact: true }),
      ).toBeVisible();

      const profile = policyRow(inspector, 'Export profile');
      await profile.getByRole('button', { name: 'Set here…' }).click();
      await choose(page, profile, 'From the export preset', WAV_PRESET);
      await profile.getByRole('button', { name: 'Set on this group' }).click();
      await expectSource(profile, 'Set on this group');

      const naming = policyRow(inspector, 'Naming template');
      await naming.getByRole('button', { name: 'Set here…' }).click();
      await naming.getByRole('textbox', { name: 'Naming template' }).fill(EXPORT_NAMING);
      await naming.getByRole('button', { name: 'Set on this group' }).click();
      await expectSource(naming, 'Set on this group', `“${EXPORT_NAMING}”`);

      await treeItem(await shownPanel(page, 'Asset groups'), GROUP).click();
      await expect(
        inspector.getByRole('heading', { name: `Asset group: ${GROUP_PATH}`, exact: true }),
      ).toBeVisible();
      await expectSource(policyRow(inspector, 'Export profile'), 'Inherited from Footsteps');
      await expectSource(
        policyRow(inspector, 'Naming template'),
        'Inherited from Footsteps',
        `“${EXPORT_NAMING}”`,
      );

      const destination = policyRow(inspector, 'Destination folder');
      await destination.getByRole('button', { name: 'Set here…' }).click();
      await destination
        .getByRole('textbox', { name: 'Destination folder, its folders separated by /' })
        .fill(DESTINATION);
      await destination.getByRole('button', { name: 'Set on this group' }).click();
      await expectSource(destination, 'Set on this group', `“${DESTINATION}”`);
      await saved(page);
    });

    await test.step('A region overrides the inherited profile, and is reset to it', async () => {
      await openFromAssets(page, stepName(1));
      const inspector = await shownPanel(page, 'Inspector');
      await expect(
        inspector.getByRole('heading', { name: `Game policy, in “${GROUP_PATH}”`, exact: true }),
      ).toBeVisible();
      const profile = policyRow(inspector, 'Export profile');
      await expectSource(profile, 'Inherited from Footsteps');
      await profile.getByRole('button', { name: 'Override…' }).click();
      await choose(page, profile, 'From the export preset', OGG_PRESET);
      await profile.getByRole('button', { name: 'Override on this member' }).click();
      await expectSource(profile, 'Overridden on this region');
      await expect(
        profile.getByRole('list', { name: 'What the export profile here hides' }),
      ).toContainText('set on Footsteps.');

      await profile.getByRole('button', { name: 'Reset to inherited' }).click();
      await expectSource(profile, 'Inherited from Footsteps');
    });

    await test.step('The group’s export plan names each file and the group that owns each value', async () => {
      const groups = await shownPanel(page, 'Asset groups');
      await treeItem(groups, GROUP).click();
      const plan = groups.getByRole('region', { name: 'Export plan' });
      await expect(
        plan.getByText(`${String(STEPS)} members are planned and 0 are refused.`, {
          exact: false,
        }),
      ).toBeVisible();
      await expect(plan.getByRole('listitem')).toHaveText(
        Array.from(
          { length: STEPS },
          (_, index) => `“${stepName(index + 1)}” to ${DESTINATION}/${stepFile(index + 1)}`,
        ),
      );
      const owners = await hintOf(
        page,
        plan.getByRole('listitem').first(),
        `Where the file of “${stepName(1)}” takes its values from`,
      );
      await expect(owners).toHaveText(
        `Profile: ${PARENT}; name: ${PARENT}; folder: ${GROUP_PATH}.`,
      );
      await page.keyboard.press('Escape');
    });

    await test.step('Prepare One-Shot over the group is one step of the History, its fades in the Inspector, and one undo', async () => {
      await openFromAssets(page, stepName(1));
      const inspector = await shownPanel(page, 'Inspector');
      const region = inspector.getByRole('region', { name: `Region: ${stepName(1)}`, exact: true });
      const ownProcessing = region
        .getByRole('heading', { name: 'Its own processing' })
        .locator('xpath=following-sibling::*[1]');
      await expect(ownProcessing).toHaveText('None.');
      const placed = await region.getByText(/^From .+ frames long\.$/u).innerText();
      const before = await historyPoints(page);

      await runCommand(page, 'Prepare One-Shot');
      const dialog = workflowDialog(page, 'Prepare One-Shot');
      await choose(page, dialog, 'Run it on', `The group “${GROUP_PATH}”, ${String(STEPS)} sounds`);
      await analyseAndApply(dialog);

      const after = await historyPoints(page);
      expect(after.descriptions).toHaveLength(before.descriptions.length + 1);
      expect(after.descriptions.slice(0, -1)).toEqual(before.descriptions);
      expect(after.current).toBe(after.descriptions.length - 1);

      await shownPanel(page, 'Inspector');
      await expect(
        ownProcessing.getByRole('listitem').filter({ hasText: /^Fade in, / }),
      ).toHaveCount(1);
      await expect(
        ownProcessing.getByRole('listitem').filter({ hasText: /^Fade out, / }),
      ).toHaveCount(1);

      await runCommand(page, 'Undo');
      await expect(ownProcessing).toHaveText('None.');
      await expect(region.getByText(/^From .+ frames long\.$/u)).toHaveText(placed);
      const undone = await historyPoints(page);
      expect(undone.descriptions).toEqual(after.descriptions);
      expect(undone.current).toBe(before.current);
      await saved(page);
    });

    const loopBefore =
      await test.step('A hum is cut into a group of its own and looped whole', async () => {
        await importWav(page, 'Engine hum', humWav());
        await runCommand(page, 'Cut Into Sounds');
        const dialog = workflowDialog(page, 'Cut Into Sounds');
        await choose(page, dialog, 'Put the sounds in', 'A new group…');
        await dialog.getByRole('textbox', { name: 'New group' }).fill('Ambience');
        await analyseAndApply(dialog);

        await openFromAssets(page, HUM_REGION);
        await runCommand(page, 'Loop the selection of the region');
        const inspector = await shownPanel(page, 'Inspector');
        const loop = inspector.getByText(
          /^It loops between .+ of the region, with no crossfade\.$/u,
        );
        await expect(loop).toBeVisible();
        await saved(page);
        return await loop.innerText();
      });

    const loopAfter =
      await test.step('The Loop panel analyses the loop and lists candidates without moving it; one is heard, applied by hand, and undone', async () => {
        const panel = await shownPanel(page, 'Loop');
        await expect(panel.locator('.ag-panel-sub-label')).toHaveText(HUM_REGION);
        const before = await historyPoints(page);
        await shownPanel(page, 'Loop');

        await panel.getByRole('button', { name: 'Analyse the loop', exact: true }).click();
        await expect(panel.getByText(/^As heard, the loop fails \d+ checks?/u)).toBeVisible({
          timeout: WORKING,
        });
        await panel.getByRole('button', { name: 'Find better loop points', exact: true }).click();
        const candidates = panel.getByRole('region', { name: 'Candidate loop points, best first' });
        await expect(candidates.getByRole('heading', { name: /^Candidate 1: / })).toBeVisible({
          timeout: WORKING,
        });

        // Nothing is applied by being found: the loop and the History are as they were.
        const inspector = await shownPanel(page, 'Inspector');
        await expect(inspector.getByText(loopBefore, { exact: true })).toBeVisible();
        expect(await historyPoints(page)).toEqual(before);

        await shownPanel(page, 'Loop');
        // What is being heard, said beside the controls that hear the loop.
        const hearing = panel.getByRole('group', { name: 'Hear the loop' }).getByRole('paragraph');
        await expect(hearing).toHaveText('No loop is being heard.');
        await candidates.getByRole('button', { name: 'Hear candidate 1', exact: true }).click();
        await expect(hearing).toHaveText(`Hearing the cycles of candidate 1 of “${HUM_REGION}”.`, {
          timeout: WORKING,
        });
        await panel.getByRole('button', { name: 'Stop hearing the loop', exact: true }).click();
        await expect(hearing).toHaveText('No loop is being heard.');
        expect(await historyPoints(page)).toEqual(before);

        await shownPanel(page, 'Loop');
        await candidates.getByRole('button', { name: 'Apply candidate 1', exact: true }).click();
        await shownPanel(page, 'Inspector');
        const applied = inspector.getByText(/^It loops between .+ of the region, with /u);
        await expect(applied).not.toHaveText(loopBefore);
        const moved = await applied.innerText();
        const after = await historyPoints(page);
        expect(after.descriptions).toHaveLength(before.descriptions.length + 1);
        expect(after.descriptions.slice(0, -1)).toEqual(before.descriptions);

        await runCommand(page, 'Undo');
        await shownPanel(page, 'Inspector');
        await expect(inspector.getByText(loopBefore, { exact: true })).toBeVisible();
        await runCommand(page, 'Redo');
        await expect(inspector.getByText(moved, { exact: true })).toBeVisible();
        await saved(page);
        return moved;
      });

    await test.step('The Game preview triggers the group twenty times beside the looped hum, twice alike under its seed, and leaves the History as it was', async () => {
      const preview = await shownPanel(page, 'Game preview');
      await preview.getByRole('button', { name: 'New scenario', exact: true }).click();
      await openSettings(preview, 'Settings for Scenario 1');
      await preview.getByRole('textbox', { name: 'Seed' }).fill('7');

      const steps = preview.getByRole('region', { name: 'Emitter 1', exact: true });
      await openSettings(steps, 'Settings for Emitter 1');
      await choose(page, steps, 'Plays', `The group ${GROUP_PATH}`);
      await choose(page, steps, 'Triggered', 'Repeatedly');
      await steps.getByRole('textbox', { name: 'Every' }).fill('100');
      await steps.getByRole('textbox', { name: 'Times' }).fill('20');

      await preview.getByRole('button', { name: 'Add an emitter', exact: true }).click();
      const hum = preview.getByRole('region', { name: 'Emitter 2', exact: true });
      await openSettings(hum, 'Settings for Emitter 2');
      await choose(page, hum, 'Plays', 'The group Ambience');
      await choose(page, hum, 'Triggered', 'Repeatedly');
      await hum.getByRole('textbox', { name: 'Times' }).fill('1');

      await preview.getByRole('button', { name: 'Keep in the project', exact: true }).click();
      await said(page, 'Scenario 1 is kept in the project.');
      await saved(page);
      const before = await historyPoints(page);

      await shownPanel(page, 'Game preview');
      await preview.getByRole('button', { name: 'Run', exact: true }).click();
      const first = await finishedLog(preview);
      await preview.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(steps.getByText(/^Sounding \d+ of 8 voices\.$/u)).toBeHidden();

      await preview.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(steps.getByText(/^Sounding \d+ of 8 voices\.$/u)).toBeVisible();
      const second = await finishedLog(preview);
      await preview.getByRole('button', { name: 'Stop', exact: true }).click();

      expect(second).toEqual(first);
      expect(first.filter((row) => row.includes('| Started, trigger '))).toHaveLength(21);
      expect(await historyPoints(page)).toEqual(before);
    });

    await test.step('The group is exported into a folder, each file named and placed by its policy', async () => {
      await page.evaluate((key) => {
        sessionStorage.setItem(key, 'folder');
      }, PICKERS_KEY);
      await page.reload();
      await expect(banner(page).getByText(`“${PROJECT}”`, { exact: true })).toBeVisible();
      const groups = await shownPanel(page, 'Asset groups');
      await treeItem(groups, GROUP).click();
      const plan = groups.getByRole('region', { name: 'Export plan' });
      await expect(
        plan.getByText(`${String(STEPS)} members are planned and 0 are refused.`, {
          exact: false,
        }),
      ).toBeVisible();
      await plan.getByRole('button', { name: 'Export the planned members…', exact: true }).click();
      const expected = Array.from(
        { length: STEPS },
        (_, index) => `${DESTINATION}/${stepFile(index + 1)}`,
      ).toSorted();
      await expect
        .poll(async () => await chosenFolderFiles(page), { timeout: WORKING })
        .toEqual(expected);
    });

    await test.step('After a reload the groups, their policy, the loop and the scenario are as they were', async () => {
      await saved(page);
      await page.reload();
      await expect(banner(page).getByText(`“${PROJECT}”`, { exact: true })).toBeVisible();

      const groups = await shownPanel(page, 'Asset groups');
      await expect(treeItem(groups, PARENT)).toHaveAccessibleName(`${PARENT} (0 members)`);
      await expect(treeItem(groups, GROUP)).toHaveAccessibleName(
        `${GROUP} (${String(STEPS)} members)`,
      );
      await expect(treeItem(groups, 'Ambience')).toHaveAccessibleName('Ambience (1 member)');

      await treeItem(groups, GROUP).click();
      const inspector = await shownPanel(page, 'Inspector');
      await expectSource(policyRow(inspector, 'Export profile'), 'Inherited from Footsteps');
      await expectSource(
        policyRow(inspector, 'Naming template'),
        'Inherited from Footsteps',
        `“${EXPORT_NAMING}”`,
      );
      await expectSource(
        policyRow(inspector, 'Destination folder'),
        'Set on this group',
        `“${DESTINATION}”`,
      );

      await openFromAssets(page, HUM_REGION);
      await expect(
        (await shownPanel(page, 'Inspector')).getByText(loopAfter, { exact: true }),
      ).toBeVisible();

      const preview = await shownPanel(page, 'Game preview');
      await choose(page, preview, 'Scenario', 'Scenario 1');
      const steps = preview.getByRole('region', { name: 'Emitter 1', exact: true });
      await openSettings(steps, 'Settings for Emitter 1');
      await expect(steps.getByRole('combobox', { name: 'Plays' })).toContainText(
        `The group ${GROUP_PATH}`,
      );
      await expect(steps.getByRole('textbox', { name: 'Times' })).toHaveValue('20');
      const hum = preview.getByRole('region', { name: 'Emitter 2', exact: true });
      await openSettings(hum, 'Settings for Emitter 2');
      await expect(hum.getByRole('combobox', { name: 'Plays' })).toContainText(
        'The group Ambience',
      );
      await openSettings(preview, 'Settings for Scenario 1');
      await expect(preview.getByRole('textbox', { name: 'Seed' })).toHaveValue('7');
    });
  });
});

/** `text` with every character a regular expression gives a meaning escaped. */
function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
