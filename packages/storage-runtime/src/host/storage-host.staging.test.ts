import { describe, expect, it, vi } from 'vitest';

import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import { mediaSharingOf, type StorageLockMode, type StorageLocking } from '@audiogubbins/storage';
import { MemoryLeaseCoordinator } from '@audiogubbins/storage/testing';

import { memoryStorage } from '../testing/memory-storage.js';

/**
 * The staging the storage worker clears as it starts (ADR-0090, ADR-0092):
 * what a window left staged is removed where the storage-wide lock is free,
 * and kept where another window holds it, since it may be that window's work
 * in progress. Driven through the worker's own composition over its injected
 * tree and leases, so the start-up's own taking of the lock is what is tested.
 */

const STAGED: readonly string[] = [
  'cache/staging/0000aaaa-0000-4000-8000-000000000001/rendition-r1',
  'cache/staging/0000aaaa-0000-4000-8000-000000000001/export-e1.body',
  'cache/staging/0000aaaa-0000-4000-8000-000000000002/export-e2.head',
];

const KEPT: readonly string[] = [
  'cache/waveform/0000aaaa-0000-4000-8000-000000000001/peaks',
  'projects/kept.json',
];

/** A tree holding what a window left staged, beside what no start removes. */
async function stagedTree(): Promise<MemoryStorageTree> {
  const tree = new MemoryStorageTree();
  for (const path of [...STAGED, ...KEPT]) await tree.writeFile(path, new Uint8Array(4));
  return tree;
}

/** What the tree holds under the staging. */
function stagedIn(tree: MemoryStorageTree): readonly string[] {
  return tree.paths().filter((path) => path.startsWith('cache/staging/'));
}

/** Leases that count each answer to a request for the storage-wide lock alone. */
class CountedLeases extends MemoryLeaseCoordinator {
  aloneAnswers = 0;

  override async lockStorage(
    mode: StorageLockMode,
    options: { readonly wait: boolean; readonly signal?: AbortSignal },
  ): Promise<StorageLocking> {
    const locking = await super.lockStorage(mode, options);
    if (mode === 'exclusive') this.aloneAnswers += 1;
    return locking;
  }
}

/**
 * Waits until the worker's start has been answered for the lock alone and
 * has finished with what it was answered, so what it left is final.
 */
async function startSettled(leases: CountedLeases): Promise<void> {
  await vi.waitFor(() => {
    expect(leases.aloneAnswers).toBeGreaterThan(0);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the storage worker as it starts', () => {
  it('removes everything staged, and nothing else, where no window holds the storage lock', async () => {
    const tree = await stagedTree();
    memoryStorage({ tree, coordinator: new CountedLeases() });
    await vi.waitFor(() => {
      expect(stagedIn(tree)).toEqual([]);
    });
    expect([...tree.paths()].sort()).toEqual([...KEPT].sort());
  });

  it('keeps what is staged where another window shares the storage lock', async () => {
    const tree = await stagedTree();
    const leases = new CountedLeases();
    const release = await mediaSharingOf(leases).share();
    memoryStorage({ tree, coordinator: leases });
    await startSettled(leases);
    expect([...stagedIn(tree)].sort()).toEqual([...STAGED].sort());
    release();
  });

  it('keeps what is staged where windows cannot be told apart', async () => {
    const tree = await stagedTree();
    const leases = new CountedLeases({ refuses: true });
    memoryStorage({ tree, coordinator: leases });
    await startSettled(leases);
    expect([...stagedIn(tree)].sort()).toEqual([...STAGED].sort());
  });
});
