/**
 * What the storage worker cleans as it starts, before it stores anything: the
 * media store's recovery of what a crash left unfinished (ADR-0071,
 * REQ-STOR-101), and the staging a window left, a rendition it was decoding or
 * an export it had not delivered (ADR-0090, ADR-0092).
 *
 * Each looks, while another window is working, exactly like what a crash left:
 * an object another window is storing until its seal is written, and that
 * window's staged work. So both run with the storage-wide lock held alone
 * (`storage-sharing.ts`), and under one holding of it: two takings of the lock
 * alone, asked for at once, would leave the second refused by the first, and
 * one asked for after the first lets go would find the lock shared by whatever
 * the page asked to write meanwhile. Where another window holds the lock,
 * nothing is undone or removed this time, and where the platform cannot
 * coordinate windows nothing is at all, since nothing could tell the two
 * apart.
 *
 * What the recovery undoes is the store's own: its incoming files and the
 * objects its intents name. A recording session's chunks and manifest lie
 * under the project, so the recovery never runs over them, and a recording cut
 * short while its file was being stored keeps its session, to be recovered as
 * the file it was.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { MediaObjectStore, RecoveryReport } from '@audiogubbins/media-store';
import { TreeFailure, type StorageTree, type TreeFailureKind } from '@audiogubbins/project-format';

import { removeStaging } from './staging-paths.js';
import { whileAlone, type Alone } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';

/** What removing the staging came to, with the lock held alone. */
export type StagingCleared =
  | { readonly kind: 'cleared' }
  /** The storage would not remove it now; it is removed at a later start. */
  | { readonly kind: 'failed'; readonly reason: TreeFailureKind };

/** What the start's cleaning came to, with the lock held alone. */
export interface StartUpCleaning {
  readonly recovered: DomainResult<RecoveryReport>;
  readonly staging: StagingCleared;
}

/** What the start's cleaning works on. */
export interface StartUpParts {
  readonly store: MediaObjectStore;
  readonly tree: StorageTree;
  /** Absent where the platform cannot coordinate windows. */
  readonly coordinator?: LeaseCoordinator;
}

/**
 * Runs the media store's recovery, then removes the whole staging, with the
 * storage-wide lock held alone throughout, or says why the lock was not had.
 */
export async function cleanAtStart(parts: StartUpParts): Promise<Alone<StartUpCleaning>> {
  return await whileAlone(parts.coordinator, async () => ({
    recovered: await parts.store.recoverIncomplete(),
    staging: await clearedStaging(parts.tree),
  }));
}

/** Removes the staging, saying where the storage would not. */
async function clearedStaging(tree: StorageTree): Promise<StagingCleared> {
  try {
    await removeStaging(tree);
    return { kind: 'cleared' };
  } catch (error) {
    // A staging the storage will not remove now holds nothing anything depends
    // on, so it is reported and left for a later start rather than failing the
    // recovery beside it.
    if (!(error instanceof TreeFailure)) throw error;
    return { kind: 'failed', reason: error.kind };
  }
}
