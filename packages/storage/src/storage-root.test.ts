import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, generatedBytes, memorySource } from '@audiogubbins/media-store/testing';
import {
  canonicalJson,
  encodeUtf8,
  hexOf,
  openZip,
  readVerified,
  type ByteSink,
} from '@audiogubbins/project-format';

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { exportRawStorage } from './raw-export.js';
import { openStorageRoot, wipeStorage } from './storage-root.js';
import { nodeDigest } from './testing/node-services.js';

/**
 * The storage root and the pre-1.0 compatibility flow (REQ-STOR-052): an empty
 * storage is initialised, one of this build's schema is accepted, and one of
 * another schema is reported without a byte changed, so the person may export
 * everything raw, cancel, or confirm a wipe that initialises the current
 * schema.
 */

/**
 * A root with a sound checksum, written by a build of storage schema `version`
 * whose projects' documents are of schema `projectDocument`.
 */
async function rootOfSchema(
  version: number,
  projectDocument: number = SCHEMA_VERSIONS.projectDocument,
): Promise<Uint8Array> {
  const body = { schemas: { projectDocument }, writtenBy: '0.0.1' };
  const checksum = hexOf(await nodeDigest(encodeUtf8(canonicalJson(body))));
  return encodeUtf8(
    canonicalJson({ body, checksum, kind: 'storage-root', schemaVersion: version }),
  );
}

async function olderStorage(): Promise<MemoryStorageTree> {
  return new MemoryStorageTree(
    {},
    new Map([
      ['storage.json', await rootOfSchema(99)],
      ['projects/0000aaaa-0000-4000-8000-000000000001/project-0.json', encodeUtf8('{"old":true}')],
      ['media/ab/c1-large', generatedBytes(0, 300_000, 5)],
    ]),
  );
}

/** Each file of a tree and the digest of its bytes, cheap to compare. */
async function digestsOf(tree: MemoryStorageTree): Promise<ReadonlyMap<string, string>> {
  const digests = new Map<string, string>();
  for (const [path, bytes] of tree.snapshot()) digests.set(path, hexOf(await nodeDigest(bytes)));
  return digests;
}

/** A sink that keeps what it is given. */
function keptSink(): ByteSink & { readonly bytes: () => Uint8Array<ArrayBuffer> } {
  const chunks: Uint8Array[] = [];
  return {
    write: (chunk) => {
      chunks.push(chunk.slice());
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    bytes: () => {
      const whole = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let at = 0;
      for (const chunk of chunks) {
        whole.set(chunk, at);
        at += chunk.length;
      }
      return whole;
    },
  };
}

describe('the storage root', () => {
  it('initialises an empty storage with this build’s schema, then finds it current', async () => {
    const tree = new MemoryStorageTree();
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({ kind: 'fresh' });
    expect(tree.paths()).toEqual(['storage.json']);
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({ kind: 'current' });
  });

  it('initialises again a root a crash tore with nothing beside it', async () => {
    const tree = new MemoryStorageTree({}, new Map([['storage.json', encodeUtf8('{"bo')]]));
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({ kind: 'fresh' });
  });

  it('reports storage whose root is missing, and writes nothing', async () => {
    const tree = new MemoryStorageTree(
      {},
      new Map([['projects/x/project-0.json', encodeUtf8('{}')]]),
    );
    const before = tree.snapshot();
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({
      kind: 'unreadable',
      fault: { kind: 'missing' },
    });
    expect(tree.snapshot()).toEqual(before);
  });

  it('reports storage of another schema and changes nothing, so cancelling leaves every byte', async () => {
    const tree = await olderStorage();
    const before = await digestsOf(tree);
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({
      kind: 'incompatible',
      schema: 'projectStorage',
      found: 99,
      current: SCHEMA_VERSIONS.projectStorage,
    });
    expect(await digestsOf(tree)).toEqual(before);
  });

  it('reports storage whose project documents are of another schema, though its own records are current', async () => {
    const tree = new MemoryStorageTree(
      {},
      new Map([['storage.json', await rootOfSchema(SCHEMA_VERSIONS.projectStorage, 97)]]),
    );
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({
      kind: 'incompatible',
      schema: 'projectDocument',
      found: 97,
      current: SCHEMA_VERSIONS.projectDocument,
    });
    expect(
      expectFailureCode(
        await wipeStorage(tree, nodeDigest, {
          kind: 'incompatible',
          schema: 'projectStorage',
          found: 97,
        }),
      ),
    ).toBe('storage.wipe-unconfirmed');
    expectSuccess(
      await wipeStorage(tree, nodeDigest, {
        kind: 'incompatible',
        schema: 'projectDocument',
        found: 97,
      }),
    );
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({ kind: 'current' });
  });

  it('exports every file raw into a ZIP that opens back to the same bytes', async () => {
    const tree = await olderStorage();
    const sink = keptSink();
    const written = expectSuccess(await exportRawStorage(tree, sink));
    expect(written.entries).toBe(3);

    const archive = expectSuccess(await openZip(memorySource(sink.bytes())));
    const held = tree.snapshot();
    expect(archive.entries.map((entry) => entry.path)).toEqual(tree.paths());
    for (const entry of archive.entries) {
      const read: Uint8Array[] = [];
      expectSuccess(
        await readVerified(entry, (chunk) => {
          read.push(chunk);
          return Promise.resolve();
        }),
      );
      const bytes = Uint8Array.from(read.flatMap((chunk) => [...chunk]));
      const original = held.get(entry.path);
      expect(original && hexOf(await nodeDigest(bytes))).toBe(
        original && hexOf(await nodeDigest(original)),
      );
    }
  });

  it('wipes only on the confirmation of what was found, then initialises the current schema', async () => {
    const tree = await olderStorage();
    const before = await digestsOf(tree);
    expect(
      expectFailureCode(
        await wipeStorage(tree, nodeDigest, {
          kind: 'incompatible',
          schema: 'projectStorage',
          found: 98,
        }),
      ),
    ).toBe('storage.wipe-unconfirmed');
    expect(await digestsOf(tree)).toEqual(before);

    expectSuccess(
      await wipeStorage(tree, nodeDigest, {
        kind: 'incompatible',
        schema: 'projectStorage',
        found: 99,
      }),
    );
    expect(tree.paths()).toEqual(['storage.json']);
    expect(expectSuccess(await openStorageRoot(tree, nodeDigest))).toEqual({ kind: 'current' });
  });

  it('leaves storage of the old schema whole where a wipe is cut short', async () => {
    const found = await olderStorage();
    // Crash on the second removal, after the media went: the root is removed
    // last, so the storage still reads as the old schema, and the wipe can be
    // confirmed again.
    const tree = new MemoryStorageTree({ crashAt: 4 }, found.snapshot());
    await expect(
      wipeStorage(tree, nodeDigest, { kind: 'incompatible', schema: 'projectStorage', found: 99 }),
    ).rejects.toThrow();
    const after = tree.restarted();
    expect(after.paths().some((path) => path.startsWith('media/'))).toBe(false);
    expect(expectSuccess(await openStorageRoot(after, nodeDigest))).toMatchObject({
      kind: 'incompatible',
    });
  });
});
