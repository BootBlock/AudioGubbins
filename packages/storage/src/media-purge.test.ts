import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, generatedSource } from '@audiogubbins/media-store/testing';

import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import { storageOf, storedMedia } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';

/**
 * A purge of media across windows (REQ-STOR-102): it runs only holding the
 * storage-wide lock alone, so media another window stored and has yet to refer
 * to is never removed under it; and it is refused, saying why, where windows
 * cannot be coordinated at all.
 */

async function withUnreferenced() {
  const test = harness(3);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const unreferenced = await storedMedia(storage.store, 5);
  return { test, tree, storage, unreferenced };
}

async function objects(store: ReturnType<typeof storageOf>['store']) {
  const found: string[] = [];
  for await (const { contentId } of store.list()) found.push(contentId);
  return found;
}

describe('purging media while another window stores it', () => {
  it('removes nothing while a window holds media it has yet to refer to, and purges after', async () => {
    const { test, tree, storage, unreferenced } = await withUnreferenced();
    const plan = expectSuccess(
      await planCleanup([{ kind: 'unreferenced-media' }], storage.cleaning, 0),
    );
    expect(plan.steps).toMatchObject([{ kind: 'unreferenced-media' }]);

    // Another window stores the same bytes, and has not yet recorded them.
    const other = storageOf(test, tree);
    const stored = expectSuccess(await other.store.put(generatedSource(3_000, 5)));
    expect(stored.contentId).toBe(unreferenced);

    const refused = expectSuccess(
      await runCleanup(plan, { bytes: plan.confirmationBytes }, storage.cleaning),
    );
    expect(refused).toEqual([
      { step: 'unreferenced-media', freed: 0, busy: [], refused: { kind: 'storing' } },
    ]);
    expect(await objects(storage.store)).toEqual([unreferenced]);

    other.store.release(stored.contentId);
    const purged = expectSuccess(
      await runCleanup(plan, { bytes: plan.confirmationBytes }, storage.cleaning),
    );
    expect(purged).toMatchObject([{ step: 'unreferenced-media', freed: 3_000 }]);
    expect(await objects(storage.store)).toEqual([]);
  });

  it('is refused, saying why, where windows cannot be coordinated', async () => {
    const { storage, unreferenced } = await withUnreferenced();
    const { coordinator: _none, ...uncoordinated } = storage.cleaning;
    const unplanned = expectSuccess(
      await planCleanup([{ kind: 'unreferenced-media' }], uncoordinated, 0),
    );
    expect(unplanned.steps).toEqual([]);
    expect(unplanned.mediaRefused).toEqual({ kind: 'no-coordination' });

    const plan = expectSuccess(
      await planCleanup([{ kind: 'unreferenced-media' }], storage.cleaning, 0),
    );
    expect(
      expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, uncoordinated)),
    ).toEqual([
      { step: 'unreferenced-media', freed: 0, busy: [], refused: { kind: 'no-coordination' } },
    ]);
    expect(await objects(storage.store)).toEqual([unreferenced]);
  });
});
