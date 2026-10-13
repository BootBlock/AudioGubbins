import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { CommonExportSettings, ExportSettings } from '@audiogubbins/import-export';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { canonicalJson, type JsonValue } from './canonical-json.js';
import { startReading } from './document-reading.js';
import { readExportSettings, writeExportSettings } from './export-settings-json.js';
import { readProjectDocument, writeProjectDocument } from './project-json.js';
import { withValue } from './testing/json-editing.js';
import { referenceState } from './testing/project-states.js';

const COMMON: CommonExportSettings = {
  sampleRate: expectSuccess(sampleRate(48_000)),
  channels: { kind: 'keep' },
  dither: { kind: 'triangular', amplitude: 1, shaping: 'first-order', seed: 4_294_967_295 },
  range: { kind: 'region', region: unsafeBrandId<'RegionId'>('a1a1a1a1-00000009') },
  metadata: {
    policy: 'minimal',
    edits: [
      { kind: 'set', key: 'title', value: 'Footsteps on gravel, “take 2”' },
      { kind: 'remove', key: 'comment' },
    ],
  },
  fileName: '{project} - {region} ({index})',
};

const COMMON_WAV: ExportSettings = {
  ...COMMON,
  format: 'wav',
  encoding: { kind: 'integer', bits: 16 },
};

/** Settings of every format, each encoding kind and conversion among them. */
const EVERY_FORMAT: readonly ExportSettings[] = [
  { ...COMMON, format: 'wav', encoding: { kind: 'integer', bits: 24 } },
  { ...COMMON, format: 'wav', encoding: { kind: 'float', bits: 64 }, dither: { kind: 'none' } },
  { ...COMMON, format: 'wav', encoding: { kind: 'ms-adpcm' } },
  { ...COMMON, format: 'aiff', encoding: { kind: 'integer', bits: 16 } },
  { ...COMMON, format: 'aifc', encoding: { kind: 'ima-adpcm' } },
  { ...COMMON, format: 'flac', encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: true } },
  { ...COMMON, format: 'mp3', encoding: { mode: 'constant', bitRate: 320 } },
  { ...COMMON, format: 'mp3', encoding: { mode: 'variable', quality: 0 } },
  { ...COMMON, format: 'ogg-vorbis', encoding: { mode: 'quality', quality: -1 } },
  { ...COMMON, format: 'ogg-vorbis', encoding: { mode: 'bit-rate', nominalBitRate: 192 } },
  {
    ...COMMON,
    format: 'opus',
    encoding: {
      bitRate: 255,
      application: 'restricted-low-delay',
      frameDuration: 2.5,
      complexity: 10,
    },
    channels: { kind: 'fold', to: StandardLayouts.stereo },
    range: { kind: 'selection', start: derivedSampleCount(10), length: derivedSampleCount(480) },
  },
  {
    ...COMMON,
    format: 'aac',
    encoding: { bitRate: 128 },
    channels: { kind: 'matrix', matrix: 'itu-bs775-5.1-to-stereo' },
    range: { kind: 'every-region' },
  },
  {
    ...COMMON,
    format: 'flac',
    encoding: { bits: 16, compressionLevel: 8, keepRiffChunks: false },
    channels: { kind: 'map', channels: [1, 0], to: StandardLayouts.stereo },
    range: { kind: 'project' },
  },
];

/** Settings read from a value, or every problem's code. */
function read(value: JsonValue): ExportSettings | readonly string[] {
  const reading = startReading();
  const result = reading.outcome(readExportSettings(reading, value, '', 'settings'));
  return result.ok ? result.value : result.failures.map((problem) => problem.code);
}

describe('export settings as JSON (ADR-0092)', () => {
  it('read back as the settings written, for every format and encoding', () => {
    for (const settings of EVERY_FORMAT) {
      const written = writeExportSettings(settings);
      expect(read(written)).toEqual(settings);
      // Canonical text, so a project's fingerprint never depends on how its
      // settings record was built.
      expect(canonicalJson(writeExportSettings(settings))).toBe(canonicalJson(written));
    }
  });

  it('refuse an encoding the format does not hold, rather than reading it as another', () => {
    const aiff = writeExportSettings({
      ...COMMON,
      format: 'aiff',
      encoding: { kind: 'integer', bits: 16 },
    });
    expect(read(withValue(aiff, ['encoding'], { kind: 'float', bits: 32 }))).toEqual([
      'export-settings.encoding-not-held',
    ]);
    const aifc = writeExportSettings({ ...COMMON, format: 'aifc', encoding: { kind: 'a-law' } });
    expect(read(withValue(aifc, ['encoding'], { kind: 'ms-adpcm' }))).toEqual([
      'export-settings.encoding-not-held',
    ]);
    const flac = writeExportSettings({
      ...COMMON,
      format: 'flac',
      encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: false },
    });
    expect(read(withValue(flac, ['encoding'], { kind: 'integer', bits: 24 }))).toContain(
      'schema.unknown-member',
    );
  });

  it('refuse a depth, a duration or a member no type allows', () => {
    const wav = writeExportSettings(COMMON_WAV);
    const float = writeExportSettings({
      ...COMMON,
      format: 'wav',
      encoding: { kind: 'float', bits: 32 },
    });
    expect(read(withValue(float, ['encoding', 'bits'], 48))).toEqual(['schema.unknown-value']);
    const opus = writeExportSettings(EVERY_FORMAT[10] ?? COMMON_WAV);
    expect(read(withValue(opus, ['encoding', 'frameDuration'], 30))).toEqual([
      'schema.unknown-value',
    ]);
    expect(read(withValue(wav, ['dither', 'seed'], 2 ** 32))).toEqual([
      'schema.number-out-of-range',
    ]);
    expect(
      read(withValue(wav, ['channels'], { kind: 'matrix', matrix: 'ambisonic-conversion' })),
    ).toEqual(['schema.unknown-value']);
    expect(read(withValue(wav, ['metadata', 'edits', 0, 'key'], 'path'))).toEqual([
      'schema.unknown-value',
    ]);
    expect(read(withValue(wav, ['extra'], true))).toEqual(['schema.unknown-member']);
  });

  it('read every integer depth as typed, and leave whether a format holds it to validation', () => {
    const wav = writeExportSettings(COMMON_WAV);
    const flac = writeExportSettings(EVERY_FORMAT[5] ?? COMMON_WAV);
    for (const bits of [12, 20, 31, 40]) {
      expect(read(withValue(wav, ['encoding', 'bits'], bits))).toEqual({
        ...COMMON_WAV,
        encoding: { kind: 'integer', bits },
      });
      expect(read(withValue(flac, ['encoding', 'bits'], bits))).toMatchObject({
        format: 'flac',
        encoding: { bits },
      });
    }
    expect(read(withValue(wav, ['encoding', 'bits'], '20'))).toEqual(['schema.not-a-number']);
  });

  it('refuse a FLAC encoding that does not say, as a boolean, whether it keeps the WAV chunks', () => {
    const flac = writeExportSettings({
      ...COMMON,
      format: 'flac',
      encoding: { bits: 24, compressionLevel: 5, keepRiffChunks: true },
    });
    expect(read(withValue(flac, ['encoding', 'keepRiffChunks'], 'yes'))).toEqual([
      'schema.not-a-boolean',
    ]);
    expect(read(withValue(flac, ['encoding'], { bits: 24, compressionLevel: 5 }))).toEqual([
      'schema.missing-member',
    ]);
  });

  it('are kept in the project document, and the document reads back with them', () => {
    const state = {
      ...referenceState(sampleProject()),
      exportSettings: EVERY_FORMAT[6] ?? COMMON_WAV,
    };
    const read = expectSuccess(readProjectDocument(writeProjectDocument(state)));
    expect(read.exportSettings).toEqual(state.exportSettings);
    const without = referenceState(sampleProject());
    expect(
      expectSuccess(readProjectDocument(writeProjectDocument(without))).exportSettings,
    ).toBeUndefined();
  });
});
