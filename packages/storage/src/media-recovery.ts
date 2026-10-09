/**
 * The media store's recovery of what a crash left unfinished, as the storage
 * worker runs it when it starts (ADR-0071, REQ-STOR-101).
 *
 * An object another window is storing looks, until its seal is written,
 * exactly like one a crash left, so the recovery runs with the storage-wide
 * lock held alone (`storage-sharing.ts`): where another window holds the lock
 * something is being stored, and nothing is undone this time, and where the
 * platform cannot coordinate windows nothing is undone at all, since nothing
 * could tell the two apart. What it undoes is the store's own: its incoming
 * files and the objects its intents name. A recording session's chunks and
 * manifest lie under the project, so the store's recovery never runs over
 * them, and a recording cut short while its file was being stored keeps its
 * session, to be recovered as the file it was.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { MediaObjectStore, RecoveryReport } from '@audiogubbins/media-store';

import { whileAlone, type Alone } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';

/** Runs the media store's recovery with the storage-wide lock held alone, or says why it did not. */
export async function recoverMediaStore(
  store: MediaObjectStore,
  coordinator: LeaseCoordinator | undefined,
): Promise<Alone<DomainResult<RecoveryReport>>> {
  return await whileAlone(coordinator, async () => await store.recoverIncomplete());
}
