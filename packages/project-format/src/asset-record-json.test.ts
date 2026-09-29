import { describe, expect, it } from 'vitest';

import { createDeterministicIdGenerator, createProject } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { readAssetRecord, writeAssetRecord, type AssetRecord } from './asset-record-json.js';
import { canonicalJson, type JsonValue } from './canonical-json.js';
import { startReading } from './document-reading.js';
import { writeProjectDocument } from './project-json.js';
import { valueAt, withValue, without } from './testing/json-editing.js';
import { randomAssetRecord, seededRandom } from './testing/random-values.js';

/** A record of the sample project's, from a seed. */
function recordOf(seed: number): AssetRecord {
  return randomAssetRecord(
    seededRandom(seed),
    createDeterministicIdGenerator(seed),
    sampleProject().project.id,
  );
}

/** Reads a record at the place `at`, as a command reads its argument. */
function read(value: JsonValue, at = '') {
  const reading = startReading();
  return reading.outcome(readAssetRecord(reading, value, '', at));
}

/** Each failure's code and where it was found. */
function problemsOf(value: JsonValue, at = ''): readonly (readonly [string, unknown])[] {
  const result = read(value, at);
  return result.ok
    ? []
    : result.failures.map((problem) => [problem.code, problem.details?.['at']] as const);
}

describe('an asset record', () => {
  it('is the asset and its source entry, each exactly as the project document writes them', () => {
    const record = recordOf(1);
    const { project } = sampleProject();
    const holder = createProject(project.id, project.displayName, project.settings);
    const document = writeProjectDocument({
      project: { ...holder, assets: new Map([[record.asset.id, record.asset]]) },
      sources: new Map([[record.asset.id, record.source]]),
    });

    expect(writeAssetRecord(record)).toEqual({
      asset: valueAt(document, ['project', 'assets', 0]),
      source: valueAt(document, ['sources', 0]),
    });
  });

  it('reads back as the record it was written from, for any asset and source', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const record = recordOf(seed);
      const written = writeAssetRecord(record);

      expect(expectSuccess(read(written)), `seed ${String(seed)}`).toEqual(record);
      expect(canonicalJson(writeAssetRecord(expectSuccess(read(written))))).toBe(
        canonicalJson(written),
      );
    }
  });

  it('refuses a source that belongs to another asset, or gives another storage key', () => {
    const written = writeAssetRecord(recordOf(2));
    const other = recordOf(3).asset.id;

    expect(problemsOf(withValue(written, ['source', 'assetId'], other))).toEqual([
      ['source.unknown-asset', 'source.assetId'],
    ]);
    expect(problemsOf(withValue(written, ['asset', 'storageKey'], 'content:elsewhere'))).toEqual([
      ['source.storage-key-mismatch', 'source.media'],
    ]);
  });

  it('refuses a record of another shape, naming each place from where it is read', () => {
    const written = writeAssetRecord(recordOf(4));

    expect(problemsOf([])).toEqual([['schema.not-an-object', '']]);
    expect(problemsOf({ ...written, extra: 1 })).toEqual([['schema.unknown-member', '']]);
    expect(problemsOf(without(written, ['source']))).toEqual([['schema.missing-member', 'source']]);
    expect(
      problemsOf(withValue(written, ['asset', 'length'], -1), 'asset').map(([, at]) => at),
    ).toEqual(['asset.asset.length']);
  });
});
