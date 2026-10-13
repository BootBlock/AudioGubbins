import { describe, expect, it } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MediaObjectStore } from '@audiogubbins/media-store';
import { MemoryStorageTree, countingTokens } from '@audiogubbins/media-store/testing';
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

import { renditionScratchPath, stagedExportPaths } from './staging-paths.js';
import { cleanAtStart, type StartUpParts } from './start-up-cleaning.js';
import { mediaSharingOf } from './storage-sharing.js';
import { MemoryLeaseCoordinator } from './testing/memory-leases.js';
import { nodeDigest } from './testing/node-services.js';
import type { LeaseCoordinator } from './write-lease.js';

/**
 * What the storage worker cleans as it starts (ADR-0071, ADR-0090, ADR-0092):
 * the media store's recovery and the staging a window left, both under one
 * holding of the storage-wide lock alone, and neither where another window
 * holds it, since what it would remove may be that window's work in progress.
 */

const PROJECT = unsafeBrandId<'ProjectId'>('0000aaaa-0000-4000-8000-000000000001');

/** What a crash left in the media store's incoming files. */
const INCOMING = 'media/incoming/stray';

async function leftTree(): Promise<MemoryStorageTree> {
  const tree = new MemoryStorageTree();
  await tree.writeFile(renditionScratchPath(PROJECT, 'r1'), new Uint8Array(8));
  const { body } = stagedExportPaths(PROJECT, 'e1');
  await tree.writeFile(body, new Uint8Array(8));
  await tree.writeFile(INCOMING, new Uint8Array(1));
  await tree.writeFile('media/kept', new Uint8Array(1));
  await tree.writeFile(`cache/waveform/${PROJECT}/peaks`, new Uint8Array(1));
  return tree;
}

function partsOver(
  tree: MemoryStorageTree,
  coordinator: LeaseCoordinator | undefined,
): StartUpParts {
  const store = new MediaObjectStore({
    tree,
    root: 'media',
    digest: nodeDigest,
    nextToken: countingTokens(),
    sharing: mediaSharingOf(coordinator),
  });
  return coordinator === undefined ? { store, tree } : { store, tree, coordinator };
}

/** A tree whose removal of the staging the storage refuses. */
class StagingRefused extends MemoryStorageTree {
  override remove(path: string): Promise<void> {
    if (path.startsWith('cache/staging')) {
      return Promise.reject(new TreeFailure(TreeFailureKind.Unavailable, 'The storage refused.'));
    }
    return super.remove(path);
  }
}

describe('cleaning the storage as the worker starts', () => {
  it('recovers the media store and removes everything staged, and nothing else, where no window holds the lock', async () => {
    const tree = await leftTree();
    const cleaned = await cleanAtStart(partsOver(tree, new MemoryLeaseCoordinator()));
    if (cleaned.kind !== 'done') throw new Error(`The lock was not had: ${cleaned.kind}.`);
    expectSuccess(cleaned.value.recovered);
    expect(cleaned.value.staging).toEqual({ kind: 'cleared' });
    expect([...tree.paths()].sort()).toEqual([`cache/waveform/${PROJECT}/peaks`, 'media/kept']);
  });

  it('keeps everything where another window is storing or staging', async () => {
    const tree = await leftTree();
    const coordinator = new MemoryLeaseCoordinator();
    const release = await mediaSharingOf(coordinator).share();
    expect(await cleanAtStart(partsOver(tree, coordinator))).toEqual({ kind: 'busy' });
    expect(tree.paths()).toHaveLength(5);
    release();
  });

  it('keeps everything where windows cannot be told apart', async () => {
    const tree = await leftTree();
    expect(await cleanAtStart(partsOver(tree, undefined))).toEqual({ kind: 'unavailable' });
    expect(tree.paths()).toHaveLength(5);
  });

  it('still recovers the media store where the storage refuses to remove the staging', async () => {
    const tree = new StagingRefused();
    await tree.writeFile(renditionScratchPath(PROJECT, 'r1'), new Uint8Array(8));
    await tree.writeFile(INCOMING, new Uint8Array(1));
    const cleaned = await cleanAtStart(partsOver(tree, new MemoryLeaseCoordinator()));
    if (cleaned.kind !== 'done') throw new Error(`The lock was not had: ${cleaned.kind}.`);
    expectSuccess(cleaned.value.recovered);
    expect(cleaned.value.staging).toEqual({ kind: 'failed', reason: 'unavailable' });
    expect(tree.paths()).toEqual([renditionScratchPath(PROJECT, 'r1')]);
  });
});
