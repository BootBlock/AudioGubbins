import { describe, expect, it } from 'vitest';

import { FakeDirectoryHandle, FakeFileHandle } from '@audiogubbins/browser-storage/testing';
import { fail, failure, FailureKind } from '@audiogubbins/domain';
import { exportBatch } from '@audiogubbins/import-export';

import type { OpenExportDialog } from '../state/export-dialog-store.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { scriptedExport, type ScriptedExport } from '../testing/export-services.js';
import { ExportCommand } from './import-export-ids.js';

holdPlatformFiles();

/** A window with audio in the editor, offering `exporting`, with two regions where asked. */
async function editing(
  exporting: ScriptedExport = scriptedExport(),
  regions = false,
): Promise<AudioWindow> {
  const audio = await windowWithAudio({
    exports: exporting.services,
    ...(regions
      ? {
          regions: [
            { name: 'Splash', start: 0, end: 48_000 },
            { name: 'Wake', start: 96_000, end: 144_000 },
          ],
        }
      : {}),
  });
  const { context } = audio.window;
  context.editorViews.open('editor', audio.asset());
  context.editorViews.measured('editor', 1000, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

/** The dialog, open. */
function dialogOf(audio: AudioWindow): OpenExportDialog {
  const shown = audio.window.projects.exportDialog.get();
  if (shown.kind !== 'open') throw new Error('The Export dialog is not open.');
  return shown;
}

/** Why `id` was refused, or `undefined` where it ran. */
function refusalOf(audio: AudioWindow, id: string, args?: Record<string, string>) {
  const ran = audio.window.run(id, args);
  return ran.kind === 'refused' ? ran.failures.map((one) => one.summary) : undefined;
}

describe('opening the Export dialog', () => {
  it('opens over the asset in the editor, its range the whole asset', async () => {
    const audio = await editing();

    expect(refusalOf(audio, ExportCommand.Audio)).toBeUndefined();

    const dialog = dialogOf(audio);
    expect(dialog.asset).toBe(audio.assetId);
    expect(dialog.settings.range).toEqual({ kind: 'project' });
    expect(dialog.source).toEqual({ kind: 'default' });
    expect(dialog.planned.ok).toBe(true);
  });

  it('opens over one region its row names, and over every region a file each', async () => {
    const audio = await editing(scriptedExport(), true);
    const [splash] = audio.session.getSnapshot().model.state.project.regions.values();
    if (splash === undefined) throw new Error('No region.');

    audio.window.run(ExportCommand.Region, { region: splash.id });
    expect(dialogOf(audio).settings.range).toEqual({ kind: 'region', region: splash.id });
    expect(dialogOf(audio).settings.fileName).toBe('{project} {region}');

    audio.window.run(ExportCommand.EveryRegion);
    const every = dialogOf(audio);
    expect(every.settings.range).toEqual({ kind: 'every-region' });
    expect(every.planned.ok ? every.planned.value.map((file) => file.name.stem) : []).toEqual([
      'Harbour Splash',
      'Harbour Wake',
    ]);
    expect(every.destination).toEqual({ kind: 'folder', policy: 'prompt' });
  });

  it('opens over the selection, on the asset’s frames', async () => {
    const audio = await editing();
    expect(refusalOf(audio, ExportCommand.Selection)).toEqual([expect.stringMatching(/select/iu)]);
    audio.window.run('editor.select-time', { start: 48_000, end: 96_000 });

    audio.window.run(ExportCommand.Selection);

    expect(dialogOf(audio).settings.range).toEqual({
      kind: 'selection',
      start: 48_000,
      length: 48_000,
    });
  });

  it('is unavailable for every region where the asset has none', async () => {
    const audio = await editing();
    expect(refusalOf(audio, ExportCommand.EveryRegion)).toEqual([
      'The asset in the editor has no regions to export one by one.',
    ]);
  });

  it('is unavailable, saying why, where the page offers no export', async () => {
    const audio = await windowWithAudio();
    audio.window.context.editorViews.open('editor', audio.asset());
    audio.window.context.editorViews.focus('editor');

    expect(refusalOf(audio, ExportCommand.Audio)).toEqual([
      'This browser offers no export here, since it cannot keep projects.',
    ]);
  });
});

describe('starting the export', () => {
  it('keeps the settings as the project’s last, then starts the export with them', async () => {
    const exporting = scriptedExport();
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);
    const dialog = dialogOf(audio);
    const chosen = new FakeFileHandle(new File([], 'Harbour.wav'));
    exporting.files.push(chosen);

    expect(await audio.window.runAndHear(ExportCommand.Start)).toBe('The export is done.');

    expect(exporting.suggested).toEqual(['Harbour.wav']);
    expect(audio.session.getSnapshot().model.state.exportSettings).toEqual(dialog.settings);
    expect(exporting.started).toHaveLength(1);
    const [started] = exporting.started;
    expect(started?.start.asset).toBe(audio.assetId);
    expect(started?.start.settings).toEqual(dialog.settings);
    expect(started?.start.destination).toEqual({ kind: 'file', handle: chosen });
    expect(audio.window.projects.exportDialog.get()).toEqual({ kind: 'closed' });

    audio.window.run(ExportCommand.Audio);
    expect(dialogOf(audio).source).toEqual({ kind: 'kept' });
  });

  it('delivers to a folder with its policy, and downloads where the browser gives no dialog', async () => {
    const exporting = scriptedExport();
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseDestination({ kind: 'folder', policy: 'rename' });
    const folder = new FakeDirectoryHandle('Sounds', []);
    exporting.folders.push(folder);
    await audio.window.runAndHear(ExportCommand.Start);
    expect(exporting.started[0]?.start.destination).toEqual({
      kind: 'folder',
      handle: folder,
      policy: 'rename',
    });

    const downloading = scriptedExport(undefined, false);
    const other = await editing(downloading);
    other.window.run(ExportCommand.Audio);
    expect(dialogOf(other).destination).toEqual({ kind: 'download' });
    await other.window.runAndHear(ExportCommand.Start);
    expect(downloading.started[0]?.start.destination).toEqual({ kind: 'download' });
  });

  it('leaves the dialog open and keeps nothing where the person dismisses the save dialog', async () => {
    const exporting = scriptedExport();
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);

    expect(audio.window.run(ExportCommand.Start).kind).toBe('applied');
    await expect.poll(() => exporting.suggested).toHaveLength(1);
    await Promise.resolve();

    expect(audio.window.projects.exportDialog.get().kind).toBe('open');
    expect(exporting.started).toEqual([]);
    expect(audio.session.getSnapshot().model.state.exportSettings).toBeUndefined();
  });

  it('refuses with the package’s reasons where the settings cannot be made', async () => {
    const audio = await editing();
    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseFormat('mp3');
    audio.window.projects.exportDialog.edit((settings) =>
      settings.format === 'mp3'
        ? { ...settings, encoding: { mode: 'constant', bitRate: 100 } }
        : settings,
    );

    expect(refusalOf(audio, ExportCommand.Start)).toEqual([
      expect.stringContaining('An MP3 at 48000 Hz codes at one of'),
    ]);
  });

  it('refuses a save dialog for several files, and an export while another runs', async () => {
    const exporting = scriptedExport();
    const audio = await editing(exporting, true);
    audio.window.run(ExportCommand.EveryRegion);
    audio.window.projects.exportDialog.chooseDestination({ kind: 'file' });
    expect(refusalOf(audio, ExportCommand.Start)).toEqual([
      'This export makes 2 files, and a save dialog names one; choose a folder.',
    ]);

    audio.window.projects.exportDialog.chooseDestination({ kind: 'folder', policy: 'skip' });
    exporting.run.set({ kind: 'held', batch: exportBatch([]), files: new Map() });
    expect(refusalOf(audio, ExportCommand.Start)).toEqual([
      'An export waits for a file to be delivered; retry it, deliver it elsewhere, or cancel it.',
    ]);
  });

  it('says why the export control refused to start', async () => {
    const exporting = scriptedExport(
      fail(failure('test.no-room', FailureKind.Rejected, 'There is no room for this export.')),
      false,
    );
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);

    expect(await audio.window.runAndHear(ExportCommand.Start)).toBe(
      'There is no room for this export.',
    );
  });
});

describe('the person’s presets', () => {
  it('keeps the dialog’s settings as a preset, and removes it', async () => {
    const audio = await editing();
    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseFormat('flac');

    expect(await audio.window.runAndHear(ExportCommand.SavePreset, { name: 'Masters' })).toBe(
      'The preset “Masters” is kept.',
    );
    const [kept] = audio.window.context.preferences.get().exportPresets;
    expect(kept?.settings.format).toBe('flac');

    expect(refusalOf(audio, ExportCommand.SavePreset, { name: '' })).toEqual([
      'Give the preset a name.',
    ]);
    expect(
      await audio.window.runAndHear(ExportCommand.RemovePreset, { preset: 'own:Masters' }),
    ).toBe('The preset “Masters” is removed.');
    expect(audio.window.context.preferences.get().exportPresets).toEqual([]);
  });
});

describe('running each a second time', () => {
  it('changes something only the first time', async () => {
    const exporting = scriptedExport(undefined, false);
    const audio = await editing(exporting);
    const twice = async (id: string, args?: Record<string, string>) => {
      await audio.window.runAndHear(id, args);
      return audio.window.run(id, args).kind;
    };

    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseFormat('flac');
    expect(audio.window.run(ExportCommand.Audio).kind).toBe('unchanged');
    expect(dialogOf(audio).settings.format).toBe('flac');

    expect(await twice(ExportCommand.SavePreset, { name: 'Masters' })).toBe('unchanged');
    expect(await twice(ExportCommand.RemovePreset, { preset: 'own:Masters' })).toBe('refused');
    expect(await twice(ExportCommand.Start)).toBe('refused');

    audio.window.run(ExportCommand.Audio);
    expect(audio.window.run(ExportCommand.CloseDialog).kind).toBe('applied');
    expect(audio.window.run(ExportCommand.CloseDialog).kind).toBe('refused');
  });
});
