import { describe, expect, expectTypeOf, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
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
} from './export-provenance.js';
import { ProvenanceLevel, stripExportRecords } from './provenance-stripping.js';
import { edited, withValue, without } from './testing/json-editing.js';
import { contentIdOfDigit } from './testing/project-states.js';

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
      'a malformed identifier',
      (value: JsonValue) => withValue(value, ['id'], 'Export 1'),
      'schema.malformed-id',
      'exports[0].id',
    ],
  ])('refuses %s', (_case, edit, code, at) => {
    expect(read(edit(writeExportRecord(RECORD)))).toContainEqual([code, at]);
  });
});
