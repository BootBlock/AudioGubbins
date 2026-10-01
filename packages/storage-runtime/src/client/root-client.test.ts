import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import { openZip } from '@audiogubbins/project-format';
import { memorySink } from '@audiogubbins/storage/testing';

import { memoryStorage } from '../testing/memory-storage.js';
import { madeProject } from '../testing/project-scene.js';

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

  it('takes every stored file out as it is, into a sink the page lent', async () => {
    const storage = memoryStorage({ tree: await olderStorage() });
    const sink = memorySink();

    const written = expectSuccess(await storage.client.root.exportRaw(sink));

    expect(sink.ending).toBe('closed');
    expect(storage.lentPorts()).toBe(0);
    const archive = expectSuccess(await openZip(memorySource(sink.bytes())));
    expect(archive.entries.map(({ path }) => path)).toEqual(['storage.json']);
    expect(written.entries).toBe(1);
  });

  it('takes out the files of every project the worker keeps', async () => {
    const storage = memoryStorage();
    expectSuccess(await storage.client.root.open());
    const project = await madeProject(storage);
    const sink = memorySink();

    const written = expectSuccess(await storage.client.root.exportRaw(sink));

    const archive = expectSuccess(await openZip(memorySource(sink.bytes())));
    const paths = archive.entries.map(({ path }) => path);
    expect(paths.length).toBe(written.entries);
    expect(paths.some((path) => path.includes(project))).toBe(true);
  });
});
