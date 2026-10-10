import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { defaultExportSettings } from './default-settings.js';
import { BUILT_IN_PRESETS, resolvePreset } from './export-presets.js';
import type { ExportFormat, ExportSettings } from './export-settings.js';
import { validateExportSettings } from './settings-validation.js';
import { contextOf, rate } from './testing/export-fixtures.js';

const FORMATS: readonly ExportFormat[] = [
  'wav',
  'aiff',
  'aifc',
  'flac',
  'mp3',
  'ogg-vorbis',
  'opus',
  'aac',
];

const CONTEXTS = [
  ['a stereo 48 kHz project', contextOf()],
  ['a stereo 44.1 kHz project', contextOf({ hertz: 44_100 })],
  ['a mono 96 kHz project', contextOf({ hertz: 96_000, layout: StandardLayouts.mono })],
  [
    'a 16-bit stereo 44.1 kHz project',
    contextOf({ hertz: 44_100, precision: { kind: 'integer', bits: 16 } }),
  ],
] as const;

describe('the built-in presets', () => {
  it('cover game effects, masters and distribution, each id once', () => {
    const ids = BUILT_IN_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'game-wav-16-48k',
      'game-ogg-vorbis',
      'game-opus',
      'master-wav-24',
      'master-wav-float',
      'master-flac',
      'distribution-mp3-320',
      'distribution-mp3-v0',
      'distribution-aac',
    ]);
  });

  it.each(CONTEXTS)('each resolve to settings that validate for %s', (_name, context) => {
    for (const preset of BUILT_IN_PRESETS) {
      const settings = resolvePreset(preset, context);
      expect(settings.format).toBe(preset.format);
      expect(expectSuccess(validateExportSettings(settings, context))).toBe(settings);
    }
  });

  it('give what they choose, and the defaults for everything else', () => {
    const context = contextOf({ hertz: 44_100 });
    const game = BUILT_IN_PRESETS.find((preset) => preset.id === 'game-wav-16-48k');
    if (game === undefined) throw new Error('The game WAV preset is missing.');
    expect(resolvePreset(game, context)).toEqual({
      ...defaultExportSettings('wav', context),
      sampleRate: rate(48_000),
      encoding: { kind: 'integer', bits: 16 },
      dither: { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 0 },
    });
  });

  it('equal the expert settings once the same edits are made to either', () => {
    const context = contextOf();
    for (const preset of BUILT_IN_PRESETS) {
      const edited: ExportSettings = {
        ...resolvePreset(preset, context),
        range: { kind: 'every-region' },
        fileName: '{project} {region}',
        metadata: { policy: 'minimal', edits: [{ kind: 'set', key: 'title', value: 'Slam' }] },
      };
      const expert = {
        ...defaultExportSettings(preset.format, context),
        ...preset.settings,
        ...(preset.settings.dither === undefined ? { dither: edited.dither } : {}),
        range: { kind: 'every-region' },
        fileName: '{project} {region}',
        metadata: { policy: 'minimal', edits: [{ kind: 'set', key: 'title', value: 'Slam' }] },
      };
      expect(edited).toEqual(expert);
    }
  });

  it('keep a dither a preset chooses, even where its depth would default to none', () => {
    const context = contextOf();
    const dither = { kind: 'triangular', amplitude: 1, shaping: 'first-order', seed: 7 } as const;
    const settings = resolvePreset(
      {
        id: 'mine',
        name: 'Mine',
        format: 'wav',
        settings: { encoding: { kind: 'integer', bits: 24 }, dither },
      },
      context,
    );
    expect(settings.dither).toEqual(dither);
  });
});

describe('the default settings', () => {
  it.each(FORMATS)(
    'of %s validate, at the project rate and layout where the format codes them',
    (format) => {
      const context = contextOf();
      const settings = defaultExportSettings(format, context);
      expect(expectSuccess(validateExportSettings(settings, context))).toBe(settings);
      expect(settings.sampleRate).toBe(48_000);
      expect(settings.channels).toEqual({ kind: 'keep' });
      expect(settings.range).toEqual({ kind: 'project' });
      expect(settings.metadata).toEqual({ policy: 'full', edits: [] });
    },
  );

  it('are 32-bit float for WAV and AIFF-C, undithered', () => {
    for (const format of ['wav', 'aifc'] as const) {
      const settings = defaultExportSettings(format, contextOf());
      expect(settings.encoding).toEqual({ kind: 'float', bits: 32 });
      expect(settings.dither).toEqual({ kind: 'none' });
    }
  });

  it('take the shallowest FLAC and AIFF depth that holds the source, and the deepest for float', () => {
    const depth = (precision: Parameters<typeof contextOf>[0]): [number, number] => {
      const context = contextOf(precision);
      return [
        defaultExportSettings('flac', context).encoding.bits,
        defaultExportSettings('aiff', context).encoding.bits,
      ];
    };
    expect(depth({ precision: { kind: 'integer', bits: 8 } })).toEqual([16, 8]);
    expect(depth({ precision: { kind: 'integer', bits: 16 } })).toEqual([16, 16]);
    expect(depth({ precision: { kind: 'integer', bits: 20 } })).toEqual([24, 24]);
    expect(depth({ precision: { kind: 'integer', bits: 24 } })).toEqual([24, 24]);
    expect(depth({ precision: { kind: 'float' } })).toEqual([32, 32]);
  });

  it('dither a 16-bit default and leave a 24-bit one undithered', () => {
    const sixteen = defaultExportSettings(
      'flac',
      contextOf({ precision: { kind: 'integer', bits: 16 } }),
    );
    expect(sixteen.dither).toEqual({ kind: 'triangular', amplitude: 1, shaping: 'none', seed: 0 });
    expect(defaultExportSettings('flac', contextOf()).dither).toEqual({ kind: 'none' });
  });

  it('take the highest quality of each lossy format', () => {
    const context = contextOf();
    expect(defaultExportSettings('mp3', context).encoding).toEqual({
      mode: 'constant',
      bitRate: 320,
    });
    expect(defaultExportSettings('ogg-vorbis', context).encoding).toEqual({
      mode: 'quality',
      quality: 10,
    });
    expect(defaultExportSettings('opus', context).encoding).toEqual({
      bitRate: 510,
      application: 'audio',
      frameDuration: 20,
      complexity: 10,
    });
    expect(defaultExportSettings('aac', context).encoding).toEqual({ bitRate: 256 });
  });

  it('take the lowest rate a format codes above the project, or its highest', () => {
    expect(defaultExportSettings('opus', contextOf({ hertz: 44_100 })).sampleRate).toBe(48_000);
    expect(defaultExportSettings('mp3', contextOf({ hertz: 96_000 })).sampleRate).toBe(48_000);
    expect(defaultExportSettings('opus', contextOf({ hertz: 22_050 })).sampleRate).toBe(24_000);
  });

  it("give MP3 the highest bit rate of the rate's MPEG version", () => {
    const settings = defaultExportSettings('mp3', contextOf({ hertz: 22_050 }));
    expect(settings.encoding).toEqual({ mode: 'constant', bitRate: 160 });
    expect(validateExportSettings(settings, contextOf({ hertz: 22_050 })).ok).toBe(true);
  });
});
