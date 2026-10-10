import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { clearStaging, renditionScratchPath, stagedExportPaths } from './staging-paths.js';
import { mediaSharingOf } from './storage-sharing.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';

/**
 * The staging cleared as the storage worker starts (ADR-0090, ADR-0092): what
 * a window left is removed where no window is storing, and kept where one is,
 * since it may be that window's work in progress.
 */

const PROJECT = unsafeBrandId<'ProjectId'>('0000aaaa-0000-4000-8000-000000000001');

async function stagedTree(): Promise<MemoryStorageTree> {
  const tree = new MemoryStorageTree();
  await tree.writeFile(renditionScratchPath(PROJECT, 'r1'), new Uint8Array(8));
  const { body } = stagedExportPaths(PROJECT, 'e1');
  await tree.writeFile(body, new Uint8Array(8));
  await tree.writeFile('media/kept', new Uint8Array(1));
  await tree.writeFile(`cache/waveform/${PROJECT}/peaks`, new Uint8Array(1));
  return tree;
}

describe('clearing the staging as the storage worker starts', () => {
  it('removes everything staged, and nothing else, where no window is storing', async () => {
    const tree = await stagedTree();
    expect(await clearStaging(tree, new MemoryLeaseCoordinator())).toEqual({
      kind: 'done',
      value: undefined,
    });
    expect([...tree.paths()].sort()).toEqual([`cache/waveform/${PROJECT}/peaks`, 'media/kept']);
  });

  it('keeps what is staged where another window is storing or staging', async () => {
    const tree = await stagedTree();
    const coordinator = new MemoryLeaseCoordinator();
    const release = await mediaSharingOf(coordinator).share();
    expect(await clearStaging(tree, coordinator)).toEqual({ kind: 'busy' });
    expect(tree.paths()).toHaveLength(4);
    release();
  });

  it('keeps what is staged where windows cannot be told apart', async () => {
    const tree = await stagedTree();
    expect(await clearStaging(tree, undefined)).toEqual({ kind: 'unavailable' });
    expect(tree.paths()).toHaveLength(4);
  });
});
