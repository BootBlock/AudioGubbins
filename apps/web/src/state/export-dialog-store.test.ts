import { describe, expect, it } from 'vitest';

import type { CodecEnvironment } from '@audiogubbins/codecs';
import { WINDOWS_BROWSER_BIT_RATES } from '@audiogubbins/codecs/testing';
import { unsafeBrandId, type AssetId, type ProjectId } from '@audiogubbins/domain';
import {
  BUILT_IN_PRESETS,
  defaultExportSettings,
  planExport,
  type ExportPreset,
  type ExportRange,
  type ExportSettings,
} from '@audiogubbins/import-export';

import {
  EXPORT_CLOCK,
  FIRST_REGION,
  exportContextOver,
  rateOf,
} from '../testing/export-contexts.js';
import { createCodecEnvironmentStore } from '../codecs/codec-environment.js';
import { servedCodecs } from '../export/export-context.js';
import { ExportDialogStore, type ExportDialogRequest } from './export-dialog-store.js';
import { observable } from './observable.js';
import type { OpenProjectState } from './open-project-store.js';
import { ownPresetId, presetSettings } from './stored-export-presets.js';

const PROJECT: ProjectId = unsafeBrandId('project-one');
const ASSET: AssetId = unsafeBrandId('asset-one');
const context = exportContextOver();

function request(changes: Partial<ExportDialogRequest> = {}): ExportDialogRequest {
  return {
    project: PROJECT,
    asset: ASSET,
    context,
    codecChanges: observable(undefined),
    clock: EXPORT_CLOCK,
    range: { kind: 'project' },
    selection: undefined,
    kept: undefined,
    dialogs: true,
    ...changes,
  };
}

function opened(changes: Partial<ExportDialogRequest> = {}) {
  const project = observable<OpenProjectState>({ kind: 'opening', project: PROJECT });
  const store = new ExportDialogStore(project);
  store.open(request(changes));
  return { store, project };
}

/** The dialog's state, open. */
function shown(store: ExportDialogStore) {
  const state = store.get();
  if (state.kind !== 'open') throw new Error('The dialog is not open.');
  return state;
}

function preset(id: string): ExportPreset {
  const found = BUILT_IN_PRESETS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`No preset ${id}.`);
  return found;
}

describe('the Export dialog’s settings', () => {
  it.each(BUILT_IN_PRESETS.map((each) => [each.name, each] as const))(
    'resolves %s and the same values set in the expert controls to the same record',
    (_name, chosen) => {
      const byPreset = opened().store;
      byPreset.choosePreset({ kind: 'built-in', preset: chosen });
      const resolved = shown(byPreset).settings;

      const byHand = opened().store;
      byHand.chooseFormat(chosen.format);
      byHand.edit((settings) => ({ ...settings, sampleRate: resolved.sampleRate }));
      byHand.edit((settings) => ({ ...settings, dither: resolved.dither }));
      byHand.edit((settings) =>
        settings.format === resolved.format
          ? ({ ...settings, encoding: resolved.encoding } as ExportSettings)
          : settings,
      );

      expect(shown(byHand).settings).toEqual(resolved);
      expect(shown(byHand).planned).toEqual(shown(byPreset).planned);
      expect(shown(byPreset).source).toEqual({ kind: 'preset', id: chosen.id });
      expect(shown(byHand).source).toEqual({ kind: 'edited' });
    },
  );

  it('keeps an edit made after a preset, and gives it back after another preset is tried', () => {
    const { store } = opened();
    store.choosePreset({ kind: 'built-in', preset: preset('master-flac') });
    store.edit((settings) => ({ ...settings, sampleRate: rateOf(96_000) }));
    const edited = shown(store).settings;
    expect(edited.format).toBe('flac');
    expect(edited.sampleRate).toBe(96_000);

    store.choosePreset({ kind: 'built-in', preset: preset('distribution-mp3-320') });
    expect(shown(store).settings.format).toBe('mp3');
    expect(shown(store).edited).toBe(edited);

    store.chooseEdited();
    expect(shown(store).settings).toBe(edited);
    expect(shown(store).source).toEqual({ kind: 'edited' });
  });

  it('gives a preset of the person’s as it was saved, over the range the dialog shows', () => {
    const region: ExportRange = { kind: 'region', region: FIRST_REGION };
    const { store } = opened({ range: region });
    const saved: ExportSettings = {
      ...planless('opus'),
      fileName: '{region} cue',
    };
    store.choosePreset({
      kind: 'own',
      preset: { id: ownPresetId('Cues'), name: 'Cues', settings: presetSettings(saved) },
    });

    expect(shown(store).settings).toEqual({ ...saved, range: region });
  });

  it('opens with the project’s last settings, named for the range now shown', () => {
    const kept: ExportSettings = { ...planless('flac'), fileName: '{project}' };
    const { store } = opened({ kept, range: { kind: 'every-region' } });

    expect(shown(store).settings).toEqual({
      ...kept,
      range: { kind: 'every-region' },
      fileName: '{project} {region}',
    });
    expect(shown(store).source).toEqual({ kind: 'kept' });
    expect(shown(store).planned.ok).toBe(true);
  });

  it('keeps a file name the person chose when the range changes', () => {
    const kept: ExportSettings = { ...planless('wav'), fileName: '{project} take {index}' };
    const { store } = opened({ kept });
    store.chooseRange({ kind: 'every-region' });

    expect(shown(store).settings.fileName).toBe('{project} take {index}');
  });

  it('opens at the highest quality where the project kept no settings', () => {
    const { store } = opened();
    expect(shown(store).settings.format).toBe('wav');
    expect(shown(store).settings.encoding).toEqual({ kind: 'float', bits: 32 });
    expect(shown(store).source).toEqual({ kind: 'default' });
  });

  it('plans every change, with the package’s reasons where it cannot be made', () => {
    const { store } = opened();
    store.chooseFormat('mp3');
    store.edit((settings) =>
      settings.format === 'mp3'
        ? { ...settings, encoding: { mode: 'constant', bitRate: 100 } }
        : settings,
    );

    const { planned } = shown(store);
    expect(planned.ok).toBe(false);
    expect(planned.ok ? [] : planned.failures.map((one) => one.code)).toEqual([
      'import-export.encoding-invalid',
    ]);
  });

  it('keeps the conversion, the metadata and the name when the format changes', () => {
    const { store } = opened();
    store.edit((settings) => ({
      ...settings,
      metadata: { policy: 'minimal', edits: [] },
      fileName: '{project} final',
    }));
    store.chooseFormat('ogg-vorbis');

    const { settings } = shown(store);
    expect(settings.format).toBe('ogg-vorbis');
    expect(settings.metadata).toEqual({ policy: 'minimal', edits: [] });
    expect(settings.fileName).toBe('{project} final');
  });
});

describe('the Export dialog’s destination', () => {
  it('asks for a file for one file, a folder for several, and downloads with no dialogs', () => {
    expect(shown(opened().store).destination).toEqual({ kind: 'file' });
    expect(shown(opened({ range: { kind: 'every-region' } }).store).destination).toEqual({
      kind: 'folder',
      policy: 'prompt',
    });
    expect(shown(opened({ dialogs: false }).store).destination).toEqual({ kind: 'download' });
  });

  it('changes as the person chooses, keeping the settings', () => {
    const { store } = opened();
    const before = shown(store).settings;
    store.chooseDestination({ kind: 'trusted-folder', key: 'folder-1', policy: 'rename' });

    expect(shown(store).destination).toEqual({
      kind: 'trusted-folder',
      key: 'folder-1',
      policy: 'rename',
    });
    expect(shown(store).settings).toBe(before);
  });
});

describe('the Export dialog’s plan as the codecs are found', () => {
  /** A dialog over AAC at 256 kbit/s, planned against the codecs an environment store serves. */
  function overAac() {
    const environment = createCodecEnvironmentStore(true);
    const served = { ...context, codecs: servedCodecs(environment) };
    const kept = {
      ...defaultExportSettings('aac', served),
      encoding: { bitRate: 256 },
    } satisfies ExportSettings;
    const { store } = opened({ context: served, codecChanges: environment, kept });
    return { store, environment };
  }

  /** Chromium's on Windows, as its probe finds it. */
  const WINDOWS: CodecEnvironment = {
    webAssembly: true,
    codecModule: 'loaded',
    encoderModules: new Map(),
    browserDecoders: new Set(),
    browserEncoders: new Set(['aac-lc']),
    browserBitRates: WINDOWS_BROWSER_BIT_RATES,
  };

  it("plans again once the browser's encoder is found, reporting a bit rate it does not code, never changing it", () => {
    const { store, environment } = overAac();
    expect(shown(store).planned.ok).toBe(true);

    environment.adopt(WINDOWS);

    const { planned, settings } = shown(store);
    expect(settings.encoding).toEqual({ bitRate: 256 });
    expect(planned.ok ? [] : planned.failures.map((one) => one.summary)).toEqual([
      "This browser's encoder codes AAC of 2 channels at 48000 Hz at 96, 128, 160 or 192 kbit/s, not at 256.",
    ]);
  });

  it('stops following the codecs once it closes', () => {
    const { store, environment } = overAac();
    store.close();
    environment.adopt(WINDOWS);
    expect(store.get()).toEqual({ kind: 'closed' });
  });
});

describe('the Export dialog', () => {
  it('closes once its project is no longer open, and when asked', () => {
    const first = opened();
    first.project.set({ kind: 'none' });
    expect(first.store.get()).toEqual({ kind: 'closed' });

    const second = opened();
    expect(second.store.close()).toBe(true);
    expect(second.store.close()).toBe(false);
  });
});

/** A format's settings as a dialog over the project opens them, with nothing planned. */
function planless(format: 'wav' | 'flac' | 'opus'): ExportSettings {
  const { store } = opened();
  store.chooseFormat(format);
  const { settings } = shown(store);
  expect(planExport(settings, context, EXPORT_CLOCK).ok).toBe(true);
  return settings;
}
