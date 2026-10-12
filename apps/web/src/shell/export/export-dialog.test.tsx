import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WINDOWS_BROWSER_BIT_RATES } from '@audiogubbins/codecs/testing';
import { unsafeBrandId } from '@audiogubbins/domain';
import { BUILT_IN_PRESETS, resolvePreset, type ExportSettings } from '@audiogubbins/import-export';

import { ExportCommand } from '../../commands/import-export-ids.js';
import { servedCodecs } from '../../export/export-context.js';
import { ExportDialogStore } from '../../state/export-dialog-store.js';
import { observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import { EXPORT_CLOCK, exportContextOver } from '../../testing/export-contexts.js';
import { TrustedFoldersStore } from '../../state/trusted-folders-store.js';
import { ScriptedCodecs } from '../../testing/codec-fakes.js';
import { renderInTheShell } from '../../testing/in-the-shell.js';
import { ExportDialog } from './export-dialog.js';

/**
 * The dialog open over the project, planned against the codecs as the test's
 * codec environment serves them, as the page plans it; and the commands it ran.
 */
function shown(dialogs = true, kept?: ExportSettings) {
  const project = observable<OpenProjectState>({ kind: 'none' });
  const dialog = new ExportDialogStore(project);
  const codecs = new ScriptedCodecs();
  dialog.open({
    project: unsafeBrandId('project-one'),
    asset: unsafeBrandId('asset-one'),
    context: { ...exportContextOver(), codecs: servedCodecs(codecs.environment) },
    codecChanges: codecs.environment,
    clock: EXPORT_CLOCK,
    range: { kind: 'project' },
    selection: undefined,
    kept,
    dialogs,
  });
  const ran: { readonly id: string; readonly args: unknown }[] = [];
  renderInTheShell(
    <ExportDialog
      dialog={dialog}
      codecs={codecs}
      trusted={new TrustedFoldersStore(undefined)}
      presets={[]}
      run={(id, args) => {
        ran.push({ id, args });
        return true;
      }}
      unavailableReason={() => undefined}
    />,
  );
  return { dialog, codecs, ran };
}

function settingsOf(dialog: ExportDialogStore) {
  const state = dialog.get();
  if (state.kind !== 'open') throw new Error('The dialog is not open.');
  return state;
}

/** Opens the select called `name` from the keyboard, and picks `option`. */
async function choose(name: string, option: string): Promise<void> {
  screen.getByRole('combobox', { name }).focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('option', { name: option }));
}

describe('the Export dialog', () => {
  it('is named Export, and lists every preset saying what it sets', () => {
    shown();

    const dialog = screen.getByRole('dialog', { name: 'Export' });
    const presets = within(dialog).getByRole('group', { name: 'Preset' });
    for (const preset of BUILT_IN_PRESETS) {
      const radio = within(presets).getByRole('radio', { name: preset.name });
      expect(radio).toHaveAccessibleDescription(/^Sets /u);
    }
    expect(
      within(presets).getByRole('radio', { name: 'Game effect, WAV 16-bit 48 kHz' }),
    ).toHaveAccessibleDescription(
      'Sets WAV, 16-bit integer, at 48 kHz; everything else is the highest quality for this asset.',
    );
  });

  it('sets the record the preset resolves to, and keeps an edit made after it', async () => {
    const { dialog } = shown();
    const master = BUILT_IN_PRESETS.find((preset) => preset.id === 'master-flac');
    if (master === undefined) throw new Error('No FLAC preset.');

    await userEvent.click(screen.getByRole('radio', { name: master.name }));
    expect(settingsOf(dialog).settings).toEqual({
      ...resolvePreset(master, settingsOf(dialog).context),
      range: { kind: 'project' },
    });
    expect(screen.getByRole('radio', { name: master.name })).toBeChecked();

    await userEvent.click(screen.getByText('Every setting'));
    await choose('Compression level', '3');

    expect(settingsOf(dialog).settings.encoding).toEqual({ bits: 24, compressionLevel: 3 });
    expect(screen.getByRole('radio', { name: 'Your edited settings' })).toBeChecked();
  });

  it('labels every control, each reached from the keyboard, with every setting disclosed', async () => {
    shown();
    await userEvent.click(screen.getByText('Every setting'));
    await choose('Kind of dither', 'Triangular');

    const dialog = screen.getByRole('dialog', { name: 'Export' });
    const controls = [
      ...within(dialog).getAllByRole('combobox'),
      ...within(dialog).getAllByRole('textbox'),
      ...within(dialog).getAllByRole('radio'),
      ...within(dialog).getAllByRole('button'),
    ];
    for (const control of controls) expect(control).toHaveAccessibleName();
    for (const name of [
      'Export',
      'Format',
      'Samples',
      'Bit depth',
      'Sample rate',
      'Channels',
      'Kind of dither',
      'Noise shaping',
      'Carry',
      'Deliver to',
    ]) {
      expect(within(dialog).getByRole('combobox', { name })).not.toHaveAttribute('tabindex', '-1');
    }
    for (const name of ['Amplitude', 'Seed', 'File name', 'Preset name']) {
      expect(within(dialog).getByRole('textbox', { name })).toBeVisible();
    }
  });

  it('shows each format’s own controls as the format changes', async () => {
    const { dialog } = shown();
    await userEvent.click(screen.getByText('Every setting'));

    await choose('Format', 'Opus');
    expect(settingsOf(dialog).settings.format).toBe('opus');
    for (const name of ['Tuning', 'Frame length', 'Complexity']) {
      expect(screen.getByRole('combobox', { name })).toBeVisible();
    }
    expect(screen.getByRole('textbox', { name: 'Bit rate' })).toHaveValue('510');

    await choose('Format', 'MP3');
    await choose('Bit rate mode', 'Variable bit rate');
    expect(settingsOf(dialog).settings.encoding).toEqual({ mode: 'variable', quality: 0 });
  });

  it('says what the export will do, and every reason it cannot as the settings change', async () => {
    const { dialog } = shown();
    expect(
      screen.getByText(/^Exports one file, “Footsteps\.wav”: WAV, 32-bit float at 48 kHz/u),
    ).toBeVisible();

    await userEvent.click(screen.getByText('Every setting'));
    const fileName = screen.getByRole('textbox', { name: 'File name' });
    await userEvent.clear(fileName);
    await userEvent.type(fileName, '{{region}');

    expect(settingsOf(dialog).planned.ok).toBe(false);
    const reasons = screen.getByRole('list', { name: 'Why this cannot be exported yet' });
    expect(
      within(reasons).getByText(/names \{region\}, but the export is not of a region/u),
    ).toBeVisible();
  });

  it('names a format this browser cannot write, and what it can instead', async () => {
    const { codecs } = shown();
    codecs.adopt({
      ...codecs.environment.get(),
      encoderModules: new Map([
        ['mp3', 'failed'],
        ['vorbis', 'loaded'],
      ]),
    });

    await choose('Format', 'MP3, which this browser cannot write');

    expect(
      screen.getAllByText(
        /The MP3 encoder .*could not be loaded.*This browser can write .* instead\./u,
      )[0],
    ).toBeVisible();
  });

  it("offers AAC at the bit rates the browser's encoder codes, and reports a preset it cannot export as it is", async () => {
    const { codecs, dialog } = shown();
    codecs.adopt({
      ...codecs.environment.get(),
      browserEncoders: new Set(['aac-lc']),
      browserBitRates: WINDOWS_BROWSER_BIT_RATES,
    });
    const refused =
      "This browser's encoder codes AAC of 2 channels at 48000 Hz at 96, 128, 160 or 192 kbit/s, not at 256.";

    await choose('Format', 'AAC');
    expect(settingsOf(dialog).settings.encoding).toEqual({ bitRate: 192 });
    const preset = screen.getByRole('radio', { name: 'Distribution, AAC 256 kbit/s' });
    expect(preset).toHaveAccessibleDescription(
      `Sets AAC, 256 kbit/s; everything else is the highest quality for this asset. As it is, it cannot be exported here: ${refused}`,
    );
    await userEvent.click(screen.getByText('Every setting'));
    expect(screen.getByRole('textbox', { name: 'Bit rate' })).toHaveAccessibleDescription(
      "In kbit/s. This browser's encoder codes this audio at 96, 128, 160 or 192 kbit/s.",
    );

    await userEvent.click(preset);
    expect(settingsOf(dialog).settings.encoding).toEqual({ bitRate: 256 });
    const reasons = screen.getByRole('list', { name: 'Why this cannot be exported yet' });
    expect(within(reasons).getByText(refused)).toBeVisible();
  });

  it('starts and closes through their commands', async () => {
    const { ran } = shown();

    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Preset name' }), 'Mine{Enter}');

    expect(ran).toEqual([
      { id: ExportCommand.Start, args: undefined },
      { id: ExportCommand.CloseDialog, args: undefined },
      { id: ExportCommand.SavePreset, args: { name: 'Mine' } },
    ]);
  });

  it('offers a download alone where the browser gives no dialog', async () => {
    shown(false);
    screen.getByRole('combobox', { name: 'Deliver to' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'A download',
    ]);
  });
});
