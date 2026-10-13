import { describe, expect, it } from 'vitest';

import { FakeDirectoryHandle, FakeFileHandle } from '@audiogubbins/browser-storage/testing';
import { commandId } from '@audiogubbins/commands';
import { fail, failure, FailureKind } from '@audiogubbins/domain';
import { exportBatch } from '@audiogubbins/import-export';

import type { OpenExportDialog } from '../state/export-dialog-store.js';
import { ScriptedCodecs } from '../testing/codec-fakes.js';
import { busOfShellCommands } from '../testing/command-availability.js';
import { shownRun } from '../testing/export-states.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { ScriptedExportControl } from '../testing/scripted-export-control.js';
import { ExportCommand } from './import-export-ids.js';

holdPlatformFiles();

/** A window with audio in the editor, offering `exporting`, with two regions where asked. */
async function editing(
  exporting: ScriptedExportControl = new ScriptedExportControl(),
  regions = false,
): Promise<AudioWindow> {
  const audio = await windowWithAudio({
    exports: exporting,
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
  context.editorViews.measured('editor', { width: 1000, height: 300 }, audio.asset().length);
  context.editorViews.focus('editor');
  return audio;
}

/** The dialog, open. */
function dialogOf(audio: AudioWindow): OpenExportDialog {
  const shown = audio.window.projects.exportDialog.get();
  if (shown.kind !== 'open') throw new Error('The Export dialog is not open.');
  return shown;
}

/** The window's codecs, as the test scripts them. */
function codecsOf(audio: AudioWindow): ScriptedCodecs {
  const { codecs } = audio.window.context;
  if (!(codecs instanceof ScriptedCodecs)) throw new Error('The window has no scripted codecs.');
  return codecs;
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

  it('starts the codec worker as it opens, so the formats it can write are known', async () => {
    const audio = await editing();
    const before = codecsOf(audio).readied;

    audio.window.run(ExportCommand.Audio);

    expect(codecsOf(audio).readied).toBe(before + 1);
  });

  it('opens over one region its row names, and over every region a file each', async () => {
    const audio = await editing(new ScriptedExportControl(), true);
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
    const audio = await editing();
    const ran = busOfShellCommands().execute(
      { ...audio.window.context, exports: undefined },
      { commandId: commandId(ExportCommand.Audio) },
    );

    expect(ran.kind === 'refused' ? ran.failures.map((one) => one.summary) : []).toEqual([
      'This browser offers no export here, since it cannot keep projects.',
    ]);
  });
});

describe('starting the export', () => {
  it('keeps the settings as the project’s last, then starts the export with them', async () => {
    const exporting = new ScriptedExportControl();
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);
    const dialog = dialogOf(audio);
    const chosen = new FakeFileHandle(new File([], 'Harbour.wav'));
    const { destinations } = audio.window.exporting;
    destinations.file = chosen;

    expect(await audio.window.runAndHear(ExportCommand.Start)).toBe('The export is done.');

    expect(destinations.suggested).toEqual([
      `${dialog.planned.ok ? (dialog.planned.value[0]?.name.stem ?? '') : ''}.wav`,
    ]);
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

  it('delivers to a folder with its policy, and as a download where asked', async () => {
    const exporting = new ScriptedExportControl();
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseDestination({ kind: 'folder', policy: 'rename' });
    const folder = new FakeDirectoryHandle('Sounds', []);
    audio.window.exporting.destinations.folder = folder;
    await audio.window.runAndHear(ExportCommand.Start);
    expect(exporting.started[0]?.start.destination).toEqual({
      kind: 'folder',
      handle: folder,
      policy: 'rename',
    });

    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseDestination({ kind: 'download' });
    await audio.window.runAndHear(ExportCommand.Start);
    expect(exporting.started[1]?.start.destination).toEqual({ kind: 'download' });
  });

  it('leaves the dialog open and keeps nothing where the person dismisses the save dialog', async () => {
    const exporting = new ScriptedExportControl();
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);

    expect(audio.window.run(ExportCommand.Start).kind).toBe('applied');
    await expect.poll(() => audio.window.exporting.destinations.suggested).toHaveLength(1);
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

    const planned = dialogOf(audio).planned;
    expect(planned.ok ? [] : planned.failures.map((one) => one.code)).toEqual([
      'import-export.encoding-invalid',
    ]);
    expect(refusalOf(audio, ExportCommand.Start)).toEqual(
      planned.ok ? [] : planned.failures.map((one) => one.summary),
    );
  });

  it('refuses a save dialog for several files, and an export while another runs', async () => {
    const exporting = new ScriptedExportControl();
    const audio = await editing(exporting, true);
    audio.window.run(ExportCommand.EveryRegion);
    audio.window.projects.exportDialog.chooseDestination({ kind: 'file' });
    expect(refusalOf(audio, ExportCommand.Start)).toEqual([
      'This export makes 2 files, and a save dialog names one; choose a folder.',
    ]);

    audio.window.projects.exportDialog.chooseDestination({ kind: 'folder', policy: 'skip' });
    exporting.run.set({ kind: 'held', ...shownRun(exportBatch([])) });
    expect(refusalOf(audio, ExportCommand.Start)).toEqual([
      'An export waits for a file to be delivered; retry it, deliver it elsewhere, or cancel it.',
    ]);
  });

  it('refuses a format this browser cannot write, naming those it can', async () => {
    const audio = await editing();
    const codecs = codecsOf(audio);
    codecs.adopt({
      ...codecs.environment.get(),
      encoderModules: new Map([
        ['mp3', { kind: 'failed', reason: 'CompileError: expected magic word 00 61 73 6d' }],
        ['vorbis', { kind: 'loaded' }],
      ]),
    });
    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseFormat('mp3');

    expect(refusalOf(audio, ExportCommand.Start)).toEqual([
      expect.stringMatching(
        /^The MP3 encoder .*could not be loaded, so MP3 cannot be exported here: CompileError: expected magic word 00 61 73 6d\. This browser can write .* instead\.$/u,
      ),
    ]);
  });

  it('says why the export control refused to start', async () => {
    const exporting = new ScriptedExportControl(
      fail(failure('test.no-room', FailureKind.Rejected, 'There is no room for this export.')),
    );
    const audio = await editing(exporting);
    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseDestination({ kind: 'download' });

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
    const audio = await editing();
    const twice = async (id: string, args?: Record<string, string>) => {
      await audio.window.runAndHear(id, args);
      return audio.window.run(id, args).kind;
    };

    audio.window.run(ExportCommand.Audio);
    audio.window.projects.exportDialog.chooseFormat('flac');
    audio.window.projects.exportDialog.chooseDestination({ kind: 'download' });
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
