import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  COLLISION_PROMPT_WORDS,
  EXPORT_BUTTON,
  EXPORT_DIALOG_WORDS,
  IMPORT_EXPORT_MENU,
  IMPORT_LIST_LABEL,
  collisionPromptTitle,
} from '../../apps/web/src/import-export-words.js';
import { codecDescriptor } from '../../packages/codecs/src/codec-registry.js';
import { formatSentence } from '../../packages/codecs/src/recognised-format.js';
import { succeed } from '../../packages/domain/src/result.js';
import {
  instantiateCodecModule,
  type CodecModule,
} from '../../packages/codec-runtime/src/codec-module.js';
import { FLACENC_ENCODER } from '../../packages/codec-runtime/src/encoding/encoder-identity.js';
import { oggOpusFile } from '../../packages/codec-runtime/src/testing/encoded-fixtures.js';
import {
  decodeAll,
  encodeWhole,
  exportRequest,
  testSignal,
} from '../../packages/codec-runtime/src/testing/export-encoding.js';
import { memoryBytes } from '../../packages/codec-runtime/src/testing/memory-bytes.js';
import type { ExportEncoderServices } from '../../packages/codec-runtime/src/worker/encode-job.js';
import { sine, stereo, wavFile } from '../../packages/test-fixtures/src/index.js';
import { CODEC_MODULE, MP3_MODULE, VORBIS_MODULE } from '../../tools/build-wasm.mjs';
import { editorPanel, runCommand, scopeOf, writeTimesAs } from './editor.js';
import { banner, makeProject, panelTitled, said, selectRange } from './hearing.js';
import { menuBarMenu, openFresh } from './shell.js';
import { test } from './test.js';

/**
 * Import and export through the codec system, driven in a real browser (the
 * packet's `test:e2e:import-export`; ADR-0090, ADR-0092, REQ-STOR-197).
 *
 * A FLAC file, made here by the codec module the build carries, is imported,
 * and then a folder holding a WAV file, an Ogg Opus file and a text file, the
 * text file refused with its reason. A region of the FLAC file is exported
 * from its row in the Assets panel into a folder that already holds a file of
 * the export's name, and the person keeps both: the file that was there is
 * left as it was, and the export, named " (2)", holds the region's samples
 * exactly. After a reload the assets are there and the History names the
 * export with its codec, the encoder's version and that its bytes repeat.
 *
 * AAC is written by the browser's own encoder alone. Where this browser has
 * one, AAC is exported and imported again, and the frames read back are the
 * source's, the encoder's priming left out; where it has none, as Chromium
 * built without proprietary codecs has not, AAC is offered as a format this
 * browser cannot write, with the codecs that can be written instead.
 *
 * Playwright cannot answer the browser's pickers, and the page reads them once
 * as it starts, all three or none (`storage-platform.ts`). Files are chosen
 * through the file input the page falls back to without them; a folder to
 * export into needs them, so for the export the page is reloaded with each
 * picker replaced, the directory picker giving a folder of the origin's
 * private file system as the person's choice. The folder is never kept
 * trusted: a trusted folder is a handle kept in IndexedDB, and Chromium's
 * bundled build crashes reading back a record that holds a handle of the
 * private file system.
 */

const RATE = 48_000;

/** The bit rate AAC is exported at where the browser encodes it, in bits a second. */
const AAC_BIT_RATE = 128_000;

/** The project's name, which the export's file is named by (`{project}`). */
const PROJECT = 'Shoreline';

/** The folder of the private file system the directory picker gives. */
const CHOSEN_FOLDER = 'Chosen folder';

/** What the file already in the chosen folder holds, which keeping both must leave alone. */
const ALREADY_THERE = new TextEncoder().encode('A file the person put here first.\n');

/** The session's key that says which pickers the page is given as it starts. */
const PICKERS_KEY = 'audiogubbins-test-pickers';

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

/** Reloads the page with the stand-in pickers, the directory picker giving the chosen folder. */
async function reloadWithAFolderPicker(page: Page): Promise<void> {
  await page.evaluate((key) => {
    sessionStorage.setItem(key, 'folder');
  }, PICKERS_KEY);
  await page.reload();
  await expect(banner(page).getByText(`“${PROJECT}”`, { exact: true })).toBeVisible();
}

/** One file of the chosen folder: its name and its bytes. */
interface FolderFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Puts `bytes` in the chosen folder as `name`, as the person had before the export. */
async function putInChosenFolder(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  await page.evaluate(
    async ({ folder, file, content }) => {
      const directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(folder, { create: true });
      const writable = await (
        await directory.getFileHandle(file, { create: true })
      ).createWritable();
      await writable.write(new Uint8Array(content));
      await writable.close();
    },
    { folder: CHOSEN_FOLDER, file: name, content: [...bytes] },
  );
}

/** Every file of the chosen folder. */
async function chosenFolderFiles(page: Page): Promise<readonly FolderFile[]> {
  const files = await page.evaluate(async (folder) => {
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle(folder, { create: true });
    const found: { name: string; bytes: number[] }[] = [];
    for await (const [name, handle] of directory.entries()) {
      if (!(handle instanceof FileSystemFileHandle)) continue;
      const file = await handle.getFile();
      found.push({ name, bytes: [...new Uint8Array(await file.arrayBuffer())] });
    }
    return found;
  }, CHOSEN_FOLDER);
  return files.map((file) => ({ name: file.name, bytes: Uint8Array.from(file.bytes) }));
}

/** The codec module the build carries, which made the fixtures and reads the export. */
async function builtCodecModule(): Promise<CodecModule> {
  const instantiated = await instantiateCodecModule(new Uint8Array(readFileSync(CODEC_MODULE)));
  if (!instantiated.ok) throw new Error(instantiated.failures[0].summary);
  return instantiated.value;
}

/** The services the export encoder is opened with in Node: the built modules, and no browser. */
function builtServices(module: CodecModule): ExportEncoderServices {
  const encoders = { mp3: MP3_MODULE, vorbis: VORBIS_MODULE };
  return {
    codecModule: () => Promise.resolve(succeed(module)),
    encoderModule: async (name) =>
      succeed(await WebAssembly.compile(new Uint8Array(readFileSync(encoders[name])))),
    encoding: undefined,
    browser: undefined,
    signal: new AbortController().signal,
  };
}

/** Every frame of `file`, one plane per channel, as the codec module decodes it. */
function decoded(module: CodecModule, file: Uint8Array): Float32Array[] {
  const session = module.openDecoder(memoryBytes(file));
  if (!session.ok) throw new Error(session.failures[0].summary);
  return decodeAll(session.value);
}

/** Chooses `entry` from the menu bar's `menu`, whose name goes on to its shortcut where it has one. */
async function chooseFromMenu(page: Page, menu: string, entry: string): Promise<void> {
  await menuBarMenu(page, menu).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${escaped(entry)}`, 'u') }).click();
}

/** Chooses `option` in the field `label` of `within`. */
async function choose(page: Page, within: Locator, label: string, option: string): Promise<void> {
  await within.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(within.getByRole('combobox', { name: label })).toContainText(option);
}

/** How long an export may take to render, encode and deliver its file. */
const EXPORTING = 120_000;

/** Waits for the page to say that the file `name` is exported. */
async function exported(page: Page, name: string): Promise<void> {
  await expect(
    page.locator('.ag-live-regions [role="status"]').filter({ hasText: `“${name}” is exported.` }),
  ).toHaveCount(1, { timeout: EXPORTING });
}

/** The panel titled `title`, shown from its command where it is not on the page. */
async function shownPanel(page: Page, title: string): Promise<Locator> {
  const panel = panelTitled(page, title);
  if (!(await panel.isVisible())) await runCommand(page, `Show the ${title} panel`);
  await expect(panel).toBeVisible();
  return panel;
}

/** Opens the asset or region `name` from the Assets panel in the editor. */
async function openFromAssets(page: Page, name: string): Promise<void> {
  await (await shownPanel(page, 'Assets')).getByRole('button', { name, exact: true }).click();
  await expect(editorPanel(page).locator('.ag-editor-asset-name')).toHaveText(name);
}

/** The row of the list of files being imported that names `file`. */
function importRow(page: Page, file: string): Locator {
  return page
    .getByRole('list', { name: IMPORT_LIST_LABEL })
    .getByRole('listitem')
    .filter({ hasText: file });
}

test.describe('import and export', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(choosePickers, { key: PICKERS_KEY, folder: CHOSEN_FOLDER });
  });

  test('imports a FLAC file and a folder, exports a region beside a file of its name, and finds the export in the History after a reload', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const module = await builtCodecModule();
    const flac = await encodeWhole(
      exportRequest({ format: 'flac', encoding: { bits: 16, compressionLevel: 5 } }, RATE),
      testSignal(2, 2 * RATE, RATE),
      builtServices(module),
    );
    // What the FLAC file holds, as its own decoder reads it: what the export is held to.
    const source = decoded(module, flac);

    const folder = testInfo.outputPath('Field recordings');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'Gull.wav'),
      wavFile(
        stereo(
          sine(440, { sampleRate: RATE, length: RATE, amplitude: 0.5 }),
          sine(660, { sampleRate: RATE, length: RATE, amplitude: 0.25 }),
        ),
      ),
    );
    writeFileSync(
      join(folder, 'Tide.ogg'),
      oggOpusFile(module, testSignal(2, RATE, RATE), {
        bitRate: 128_000,
        application: 'audio',
        frameDuration: 20,
        complexity: 10,
        rateControl: 'variable',
      }),
    );
    writeFileSync(join(folder, 'Notes.txt'), 'Wind from the west, gulls at the end.\n');

    await openFresh(page);
    await makeProject(page, PROJECT);

    await test.step('The FLAC file is imported from the File menu', async () => {
      const choosing = page.waitForEvent('filechooser');
      await chooseFromMenu(page, 'File', IMPORT_EXPORT_MENU.importFiles);
      await (
        await choosing
      ).setFiles({ name: 'Shore.flac', mimeType: 'audio/flac', buffer: Buffer.from(flac) });
      await said(page, '“Shore” is imported and open.');
    });

    await test.step('A folder is imported: its WAV and Ogg files, and its text file refused with why', async () => {
      const choosing = page.waitForEvent('filechooser');
      await chooseFromMenu(page, 'File', IMPORT_EXPORT_MENU.importFolder);
      await (await choosing).setFiles(folder);
      await said(page, '2 of 3 files imported.');
      await expect(importRow(page, 'Gull.wav')).toContainText('Imported');
      await expect(importRow(page, 'Tide.ogg')).toContainText('Imported');
      await expect(importRow(page, 'Notes.txt')).toContainText(
        `Refused: ${formatSentence({ kind: 'unknown' })}`,
      );
    });

    const region = await test.step('A region is made of the FLAC file', async () => {
      await openFromAssets(page, 'Shore');
      const editor = editorPanel(page);
      await writeTimesAs(page, editor, 'Samples');
      const selected = await selectRange(page, editor, { start: 24_000, end: 72_000 }, 2);
      await runCommand(page, 'Make a region of the selection');
      await said(page, 'Region 1 made of Shore.');
      await expect(
        page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
      ).toBeVisible();
      return selected;
    });

    // A region's file is named `{project} {region}`.
    const taken = `${PROJECT} Region 1.flac`;
    const kept = `${PROJECT} Region 1 (2).flac`;

    await test.step('The region is exported from its row into a folder holding a file of its name, keeping both', async () => {
      await reloadWithAFolderPicker(page);
      await putInChosenFolder(page, taken, ALREADY_THERE);
      await (
        await shownPanel(page, 'Assets')
      )
        .getByRole('list', { name: 'Regions of Shore' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'Region 1', exact: true }) })
        .getByRole('button', { name: EXPORT_BUTTON, exact: true })
        .click();

      const dialog = page.getByRole('dialog', { name: EXPORT_DIALOG_WORDS.title });
      await choose(page, dialog, 'Format', 'FLAC');
      await dialog.getByText(EXPORT_DIALOG_WORDS.everySetting, { exact: true }).click();
      await choose(page, dialog, 'Bit depth', '16-bit');
      // Without dither the region's 16-bit samples come back as they went in.
      await choose(page, dialog, 'Kind of dither', 'None');
      await choose(page, dialog, 'Deliver to', 'A folder you choose');
      await choose(
        page,
        dialog,
        'Where a name is taken',
        'You are asked what to do with a file whose name is taken',
      );
      await dialog.getByRole('button', { name: EXPORT_DIALOG_WORDS.start, exact: true }).click();

      const prompt = page.getByRole('dialog', { name: collisionPromptTitle(taken) });
      await prompt
        .getByRole('button', { name: COLLISION_PROMPT_WORDS.answers.rename, exact: true })
        .click();
      await expect(prompt).toBeHidden();
      await exported(page, kept);
    });

    await test.step('The file that was there is left alone, and the export holds the region exactly', async () => {
      const files = new Map((await chosenFolderFiles(page)).map((file) => [file.name, file.bytes]));
      expect([...files.keys()].toSorted()).toEqual([kept, taken].toSorted());
      expect(files.get(taken)).toEqual(ALREADY_THERE);
      const written = decoded(module, files.get(kept) ?? new Uint8Array());
      expect(written).toHaveLength(2);
      source.forEach((plane, channel) => {
        expect(written[channel]).toEqual(plane.slice(region.start, region.end));
      });
    });

    await test.step('After a reload the assets are there, and the History names the export', async () => {
      await expect(
        page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
      ).toBeVisible();
      await page.reload();
      await expect(banner(page).getByText(`“${PROJECT}”`, { exact: true })).toBeVisible();
      const assets = await shownPanel(page, 'Assets');
      for (const name of ['Shore', 'Gull', 'Tide', 'Region 1']) {
        await expect(assets.getByRole('button', { name, exact: true })).toBeVisible();
      }
      await expect(assets.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(0);

      const history = await shownPanel(page, 'History');
      const record = new RegExp(
        `Exported as “${escaped(kept)}” to “${escaped(CHOSEN_FOLDER)}” on .+, encoded as ${escaped(codecDescriptor('flac').name)} by ${escaped(FLACENC_ENCODER.version)} in the codec module, the same bytes on every machine`,
        'u',
      );
      await expect(
        history.getByRole('listbox', { name: 'Points in the history' }).getByText(record),
      ).toBeVisible();
    });
  });

  test('exports AAC and reads back the source’s frames where the browser encodes it, and offers it as unavailable with what can be written where it does not', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const module = await builtCodecModule();
    const length = 2 * RATE;
    const flac = await encodeWhole(
      exportRequest({ format: 'flac', encoding: { bits: 16, compressionLevel: 5 } }, RATE),
      testSignal(2, length, RATE),
      builtServices(module),
    );
    const source = decoded(module, flac);

    await openFresh(page);
    await makeProject(page, PROJECT);
    const choosing = page.waitForEvent('filechooser');
    await chooseFromMenu(page, 'File', IMPORT_EXPORT_MENU.importFiles);
    await (
      await choosing
    ).setFiles({ name: 'Shore.flac', mimeType: 'audio/flac', buffer: Buffer.from(flac) });
    await said(page, '“Shore” is imported and open.');
    await expect(
      page.getByRole('contentinfo', { name: 'Status' }).getByText('Saved'),
    ).toBeVisible();
    await reloadWithAFolderPicker(page);
    await openFromAssets(page, 'Shore');

    const encodes = await page.evaluate(
      async ({ sampleRate, bitrate }) => {
        if (typeof AudioEncoder === 'undefined') return false;
        const support = await AudioEncoder.isConfigSupported({
          codec: 'mp4a.40.2',
          sampleRate,
          numberOfChannels: 2,
          bitrate,
        });
        return support.supported === true;
      },
      { sampleRate: RATE, bitrate: AAC_BIT_RATE },
    );

    await chooseFromMenu(page, 'File', IMPORT_EXPORT_MENU.exportAudio);
    const dialog = page.getByRole('dialog', { name: EXPORT_DIALOG_WORDS.title });
    const aac = codecDescriptor('aac-lc').name;

    if (!encodes) {
      await test.step('AAC is offered as a format this browser cannot write, naming what can be', async () => {
        await choose(page, dialog, 'Format', 'AAC, which this browser cannot write');
        const why = dialog.locator('.ag-panel-note[data-ag-status="unavailable"]');
        await expect(why).toContainText(
          `Writing ${aac} needs the browser's own encoder, which this browser does not have.`,
        );
        const instead = /(?<names>[^.]+) can be written here instead\.$/u.exec(
          await why.innerText(),
        )?.groups?.['names'];
        expect(instead?.split(/, | and /u).slice(0, 3)).toEqual(
          (['opus', 'vorbis', 'mp3'] as const).map((codec) => codecDescriptor(codec).name),
        );
        await expect(
          dialog.getByRole('list', { name: 'Why this cannot be exported yet' }),
        ).toContainText(await why.innerText());
      });
      return;
    }

    await test.step('AAC is exported, imported again, and its frames are the source’s', async () => {
      await choose(page, dialog, 'Format', 'AAC');
      // The rate the probe above asked for: an encoder takes only the rates it
      // was built for, Chromium's on Windows 96 to 192 kbit/s for stereo.
      await dialog.getByText(EXPORT_DIALOG_WORDS.everySetting, { exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Bit rate' }).fill(String(AAC_BIT_RATE / 1_000));
      await choose(page, dialog, 'Deliver to', 'A folder you choose');
      await dialog.getByRole('button', { name: EXPORT_DIALOG_WORDS.start, exact: true }).click();
      await exported(page, `${PROJECT}.m4a`);
      const [written] = (await chosenFolderFiles(page)).filter((file) =>
        file.name.endsWith('.m4a'),
      );
      if (written === undefined) throw new Error('No AAC file was written to the folder.');
      // The priming the encoder put before the sound is left out as the file
      // is read, by the codec module here and by the page below: what is read
      // back is the source's length, and lines up with it frame for frame,
      // agreeing best with no shift between them. An encoder that states no
      // priming, as Chromium's on Windows, put none before the sound.
      const readBack = decoded(module, written.bytes);
      expect(readBack.map((plane) => plane.length)).toEqual([length, length]);
      expect(bestLag(source, readBack, 4_096)).toBe(0);

      await page.evaluate((key) => {
        sessionStorage.removeItem(key);
      }, PICKERS_KEY);
      await page.reload();
      await expect(banner(page).getByText(`“${PROJECT}”`, { exact: true })).toBeVisible();
      const choosingAgain = page.waitForEvent('filechooser');
      await chooseFromMenu(page, 'File', IMPORT_EXPORT_MENU.importFiles);
      await (
        await choosingAgain
      ).setFiles({
        name: 'Read back.m4a',
        mimeType: 'audio/mp4',
        buffer: Buffer.from(written.bytes),
      });
      await said(page, '“Read back” is imported and open.');

      const editor = editorPanel(page);
      await writeTimesAs(page, editor, 'Samples');
      await runCommand(page, 'Select all');
      await expect(scopeOf(editor)).toHaveText(
        `0 to ${length.toLocaleString('en-GB')} on every channel`,
      );
    });
  });
});

/**
 * The shift, within `most` frames either way, at which `other` agrees best
 * with `planes`, by the correlation of their first channels: positive where
 * `other` lags behind.
 */
function bestLag(
  planes: readonly Float32Array[],
  other: readonly Float32Array[],
  most: number,
): number {
  const [one] = planes;
  const [two] = other;
  if (one === undefined || two === undefined) throw new Error('A stream has no channel.');
  let best = { lag: 0, score: -Infinity };
  for (let lag = -most; lag <= most; lag += 1) {
    let score = 0;
    for (let frame = most; frame < one.length - most; frame += 1) {
      score += (one[frame] ?? 0) * (two[frame + lag] ?? 0);
    }
    if (score > best.score) best = { lag, score };
  }
  return best.lag;
}

/** `text` with every character a regular expression gives a meaning escaped. */
function escaped(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
