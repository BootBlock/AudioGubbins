import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  canonicalJson,
  decodeUtf8,
  encodeUtf8,
  hexOf,
  objectOf,
  required,
  textConverter,
  type Converter,
  type JsonValue,
} from '@audiogubbins/project-format';

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { CheckedRecords, RecordKind } from './checked-records.js';
import { nodeDigest } from './testing/node-services.js';

const NAME_MEMBERS: ReadonlySet<string> = new Set(['name']);
const asName = textConverter({ maximumLength: 16 });
const readName: Converter<string> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, NAME_MEMBERS);
  return object === undefined ? undefined : required(reading, object, 'body', 'name', asName);
};

async function written() {
  const tree = new MemoryStorageTree();
  const records = new CheckedRecords(tree, nodeDigest);
  expectSuccess(await records.write('record.json', RecordKind.Lease, { name: 'Forest' }));
  return { tree, records };
}

async function envelope(body: object, overrides: Record<string, unknown>): Promise<Uint8Array> {
  const checksum = hexOf(await nodeDigest(encodeUtf8(canonicalJson({ ...body }))));
  return encodeUtf8(
    JSON.stringify({
      body,
      checksum,
      kind: 'lease',
      schemaVersion: SCHEMA_VERSIONS.projectStorage,
      ...overrides,
    }),
  );
}

describe('checked records (REQ-STOR-101, REQ-EXEC-136.12)', () => {
  it('reads back what was written, as compact canonical JSON', async () => {
    const { tree, records } = await written();
    expect(await records.read('record.json', RecordKind.Lease, readName)).toEqual({
      kind: 'valid',
      value: 'Forest',
    });
    const text = decodeUtf8((await tree.readFile('record.json')) ?? new Uint8Array());
    expect(text.ok && text.value.startsWith('{"body":{"name":"Forest"},"checksum":"')).toBe(true);
  });

  it('reads a missing file as absent', async () => {
    const { records } = await written();
    expect(await records.read('other.json', RecordKind.Lease, readName)).toEqual({
      kind: 'absent',
    });
  });

  it('reads a torn file as damaged, never as data', async () => {
    const { tree, records } = await written();
    const bytes = await tree.readFile('record.json');
    await tree.writeFile('record.json', (bytes ?? new Uint8Array()).subarray(0, 30));
    expect(await records.read('record.json', RecordKind.Lease, readName)).toMatchObject({
      kind: 'invalid',
      fault: { kind: 'damaged', cause: { code: 'json.unexpected-end' } },
    });
  });

  it('reads a record of another kind as foreign', async () => {
    const { records } = await written();
    expect(await records.read('record.json', RecordKind.Checkpoint, readName)).toEqual({
      kind: 'invalid',
      fault: { kind: 'foreign', found: 'lease' },
    });
  });

  it('reads a record of another schema version as incompatible, with both versions', async () => {
    const { tree, records } = await written();
    await tree.writeFile(
      'record.json',
      await envelope({ name: 'Forest' }, { schemaVersion: SCHEMA_VERSIONS.projectStorage + 1 }),
    );
    expect(await records.read('record.json', RecordKind.Lease, readName)).toEqual({
      kind: 'invalid',
      fault: {
        kind: 'incompatible',
        found: SCHEMA_VERSIONS.projectStorage + 1,
        current: SCHEMA_VERSIONS.projectStorage,
      },
    });
  });

  it('reads a body its checksum was not taken of as a mismatch', async () => {
    const { tree, records } = await written();
    const bytes = await envelope({ name: 'Forest' }, {});
    const altered = decodeUtf8(bytes);
    if (!altered.ok) throw new Error('Not text.');
    await tree.writeFile('record.json', encodeUtf8(altered.value.replace('Forest', 'Desert')));
    expect(await records.read('record.json', RecordKind.Lease, readName)).toEqual({
      kind: 'invalid',
      fault: { kind: 'checksum-mismatch' },
    });
  });

  it('reads a sound envelope whose body its kind does not hold as malformed', async () => {
    const { tree, records } = await written();
    await tree.writeFile('record.json', await envelope({ name: 'Forest', extra: 1 }, {}));
    expect(await records.read('record.json', RecordKind.Lease, readName)).toMatchObject({
      kind: 'invalid',
      fault: { kind: 'malformed', failures: [{ code: 'schema.unknown-member' }] },
    });
  });

  it('reads JSON that is not an envelope as damaged', async () => {
    const { tree, records } = await written();
    await tree.writeFile('record.json', encodeUtf8('{"name":"Forest"}'));
    expect(await records.read('record.json', RecordKind.Lease, readName)).toMatchObject({
      kind: 'invalid',
      fault: { kind: 'damaged', cause: { code: 'storage.not-a-record' } },
    });
  });
});

describe('writing a record its reader cannot read back', () => {
  const anyValue: Converter<JsonValue> = (_reading, value) => value;
  const nested = (depth: number): JsonValue =>
    Array.from({ length: depth - 1 }).reduce<JsonValue>((inner) => [inner], []);

  it('writes a body nested as deep as the reader reads, and reads it back', async () => {
    const records = new CheckedRecords(new MemoryStorageTree(), nodeDigest);
    expectSuccess(await records.write('deep.json', RecordKind.Lease, nested(31)));
    const read = await records.read('deep.json', RecordKind.Lease, anyValue);
    expect(read).toEqual({ kind: 'valid', value: nested(31) });
  });

  it('refuses one level deeper, and writes nothing', async () => {
    const tree = new MemoryStorageTree();
    const records = new CheckedRecords(tree, nodeDigest);
    const written = await records.write('deep.json', RecordKind.Lease, nested(32));
    expect(await tree.readFile('deep.json')).toBeUndefined();
    expect(expectFailureCode(written)).toBe('storage.record-too-large');
  });
});
