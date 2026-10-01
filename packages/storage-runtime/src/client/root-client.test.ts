import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { memoryStorage } from '../testing/memory-storage.js';

/**
 * A storage whose root was written by an earlier version, of the schema before
 * this build's, with a checksum of its body so only the schema is wrong.
 */
async function olderStorage(): Promise<MemoryStorageTree> {
  const tree = new MemoryStorageTree();
  const body = '{"writtenBy":"0.0.9"}';
  const checksum = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const root = `{"body":${body},"checksum":"${checksum}","kind":"storage-root","schemaVersion":0}`;
  await tree.writeFile('storage.json', new TextEncoder().encode(root));
  return tree;
}

describe('the storage root, asked of the storage worker', () => {
  it('initialises an empty storage, and finds it current after', async () => {
    const { client } = memoryStorage();

    await expect(client.root.open()).resolves.toEqual({ ok: true, value: { kind: 'fresh' } });
    await expect(client.root.open()).resolves.toEqual({ ok: true, value: { kind: 'current' } });
  });

  it('wipes storage of another schema only as the person was shown it', async () => {
    const { client } = memoryStorage({ tree: await olderStorage() });

    const found = expectSuccess(await client.root.open());
    if (found.kind !== 'incompatible') throw new Error(`The storage was found ${found.kind}.`);
    const { schema } = found;

    const refused = await client.root.wipe({
      kind: 'incompatible',
      schema,
      found: found.found + 1,
    });
    expect(expectFailureCode(refused)).toBe('storage.wipe-unconfirmed');
    expectSuccess(await client.root.wipe({ kind: 'incompatible', schema, found: found.found }));

    await expect(client.root.open()).resolves.toEqual({ ok: true, value: { kind: 'current' } });
  });
});
