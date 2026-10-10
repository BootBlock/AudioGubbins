import { describe, expect, expectTypeOf, it } from 'vitest';

import { StandardLayouts, sampleRate, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { canonicalJson, type JsonValue } from './canonical-json.js';
import { stateFingerprintFrom } from './content-identity.js';
import { startReading } from './document-reading.js';
import { readExportRecord, writeExportRecord } from './export-record-json.js';
import {
  ExportDestinationKind,
  ExportStatus,
  type ExportOutput,
  type ExportRecord,
  type ExportedAudioFile,
} from './export-provenance.js';
import { ProvenanceLevel, stripExportRecords } from './provenance-stripping.js';
import { edited, withValue, without } from './testing/json-editing.js';
import { contentIdOfDigit } from './testing/project-states.js';

/** A WAV file exported into a trusted folder. */
const FILE: ExportedAudioFile = {
  settings: {
    format: 'wav',
    encoding: { kind: 'integer', bits: 16 },
    sampleRate: expectSuccess(sampleRate(48_000)),
    channels: { kind: 'fold', to: StandardLayouts.mono },
    dither: { kind: 'triangular', amplitude: 1, shaping: 'none', seed: 0 },
    range: { kind: 'project' },
    metadata: { policy: 'full', edits: [] },
    fileName: '{project}',
  },
  fileName: 'Forest steps.wav',
  byteLength: 96_044,
  sha256: 'ab'.repeat(32),
  codec: { id: 'pcm', implementation: 'application', version: '0.1.0' },
  reproducible: true,
};

const RECORD: ExportRecord = {
  id: unsafeBrandId<'ExportRecordId'>('e0e0e0e0-00000001'),
  at: 1_790_000_000_000,
  stateFingerprint: expectSuccess(stateFingerprintFrom(`s1-${'1'.repeat(64)}`)),
  historyNodeId: 'a1a1a1a1-00000002',
  recipe: { id: 'footsteps', version: 3 },
  engineVersions: new Map([
    ['renderer', '1.2.0'],
    ['limiter', '4'],
  ]),
  output: {
    container: 'ogg',
    settings: new Map<string, string | number | boolean>([
      ['quality', 0.6],
      ['dither', true],
      ['channels', 'stereo'],
    ]),
  },
  destination: { kind: ExportDestinationKind.GodotProject, label: 'Forest game' },
  outputContentId: contentIdOfDigit('9'),
  file: FILE,
  godot: { projectLabel: 'Forest game', resources: ['res://audio/step.ogg'] },
  status: ExportStatus.Partial,
  problems: ['The second file could not be written.'],
};

/** A record read from a value, or every problem's code and place. */
function read(value: JsonValue): ExportRecord | readonly (readonly [string, unknown])[] {
  const reading = startReading();
  const record = readExportRecord(reading, value, 'exports', 0);
  const result = reading.outcome(record);
  return result.ok
    ? result.value
    : result.failures.map((problem) => [problem.code, problem.details?.['at']] as const);
}

describe('export records as JSON', () => {
  it('take settings of plain values, so samples a running graph carries never reach one', () => {
    // A graph node's settings may hold samples in memory; an export's are
    // their own type, which the checker keeps samples out of.
    type ExportSetting =
      ExportOutput['settings'] extends ReadonlyMap<string, infer Value> ? Value : never;
    expectTypeOf<Float32Array>().not.toExtend<ExportSetting>();
  });

  it('read back as the record written, at every provenance level', () => {
    for (const level of Object.values(ProvenanceLevel)) {
      for (const record of stripExportRecords([RECORD], level)) {
        expect(read(writeExportRecord(record))).toEqual(record);
      }
    }
  });

  it('keep an exported file’s settings, size, hash and codec below full, and drop its name', () => {
    const [minimal] = stripExportRecords(
      [
        {
          ...RECORD,
          destination: { kind: ExportDestinationKind.TrustedDirectory, label: 'Sounds' },
        },
      ],
      ProvenanceLevel.Minimal,
    );
    const { fileName: _name, ...unnamed } = FILE;
    expect(minimal?.file).toEqual(unnamed);
    expect(minimal?.destination).toEqual({ kind: ExportDestinationKind.TrustedDirectory });
  });

  it('write maps as lists sorted by name, so equal records give equal text', () => {
    const reordered: ExportRecord = {
      ...RECORD,
      engineVersions: new Map([...RECORD.engineVersions].reverse()),
      output: { ...RECORD.output, settings: new Map([...RECORD.output.settings].reverse()) },
    };
    expect(canonicalJson(writeExportRecord(reordered))).toBe(
      canonicalJson(writeExportRecord(RECORD)),
    );
    expect(canonicalJson(writeExportRecord(RECORD))).toContain(
      '"engineVersions":[{"name":"limiter","version":"4"},{"name":"renderer","version":"1.2.0"}]',
    );
  });

  it.each([
    [
      'a malformed fingerprint',
      (value: JsonValue) => withValue(value, ['stateFingerprint'], 'c1-00'),
      'schema.malformed-fingerprint',
      'exports[0].stateFingerprint',
    ],
    [
      'two versions under one name',
      (value: JsonValue) =>
        edited(value, ['engineVersions'], (list) =>
          Array.isArray(list) ? [...list, { name: 'limiter', version: '5' }] : list,
        ),
      'schema.duplicate-name',
      'exports[0].engineVersions[2].name',
    ],
    [
      'a resource outside res://',
      (value: JsonValue) => withValue(value, ['godot', 'resources'], ['C:/game/step.ogg']),
      'schema.text-malformed',
      'exports[0].godot.resources[0]',
    ],
    [
      'a status that is not one',
      (value: JsonValue) => withValue(value, ['status'], 'maybe'),
      'schema.unknown-value',
      'exports[0].status',
    ],
    [
      'a destination kind that is not one',
      (value: JsonValue) => withValue(value, ['destination', 'kind'], 'cloud'),
      'schema.unknown-value',
      'exports[0].destination.kind',
    ],
    [
      'a setting that is an object',
      (value: JsonValue) => withValue(value, ['output', 'settings', 0, 'value'], {}),
      'schema.unknown-value',
      'exports[0].output.settings[0].value',
    ],
    [
      'a missing status',
      (value: JsonValue) => without(value, ['status']),
      'schema.missing-member',
      'exports[0].status',
    ],
    [
      'a hash that is not a SHA-256',
      (value: JsonValue) => withValue(value, ['file', 'sha256'], 'AB'.repeat(32)),
      'schema.text-malformed',
      'exports[0].file.sha256',
    ],
    [
      'a file name that is a path',
      (value: JsonValue) => withValue(value, ['file', 'fileName'], 'Sounds/step.wav'),
      'schema.text-malformed',
      'exports[0].file.fileName',
    ],
    [
      'a codec the registry does not name',
      (value: JsonValue) => withValue(value, ['file', 'codec', 'id'], 'speex'),
      'schema.unknown-value',
      'exports[0].file.codec.id',
    ],
    [
      'a malformed identifier',
      (value: JsonValue) => withValue(value, ['id'], 'Export 1'),
      'schema.malformed-id',
      'exports[0].id',
    ],
  ])('refuses %s', (_case, edit, code, at) => {
    expect(read(edit(writeExportRecord(RECORD)))).toContainEqual([code, at]);
  });
});
