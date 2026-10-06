/**
 * Purging media nothing refers to, as a confirmed cleanup's last step
 * (REQ-STOR-102, REQ-STOR-106): only what the plan found unreachable that is
 * still unreachable from roots gathered afresh and read whole, with the
 * storage-wide lock held alone, so no window stores media it has yet to refer
 * to meanwhile. Where anything that could retain media cannot be read, or the
 * lock cannot be had, nothing is purged and the answer says why.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { collect, type CollectionPlan, type MediaObjectStore } from '@audiogubbins/media-store';
import type { ContentId, Digest, StorageTree } from '@audiogubbins/project-format';

import type { MediaRefusal } from './cleanup-plan.js';
import { retainedMedia, type UnreadableRoot } from './media-roots.js';
import { whileAlone } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';

/** What purging works with. */
interface PurgeServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly store: MediaObjectStore;
  readonly coordinator?: LeaseCoordinator;
}

/** What a purge freed, and why it freed nothing where it did not run. */
export interface Purged {
  readonly freed: number;
  readonly refused?: MediaRefusal;
}

/** Purges what `planned` found unreachable and still is (see the module comment). */
export async function purgeMedia(
  planned: CollectionPlan,
  services: PurgeServices,
  signal?: AbortSignal,
): Promise<DomainResult<Purged>> {
  const alone = await whileAlone(
    services.coordinator,
    async () => await collectedUnderLock(planned, services, signal),
    signal,
  );
  switch (alone.kind) {
    case 'done':
      return alone.value;
    case 'busy':
      return succeed({ freed: 0, refused: { kind: 'storing' } });
    case 'unavailable':
      return succeed({ freed: 0, refused: { kind: 'no-coordination' } });
  }
}

/** Collects what is still unreachable, while no window stores media. */
async function collectedUnderLock(
  planned: CollectionPlan,
  services: PurgeServices,
  signal?: AbortSignal,
): Promise<DomainResult<Purged>> {
  const unreadable: UnreadableRoot[] = [];
  const roots: ContentId[] = [];
  for await (const root of retainedMedia(
    services.tree,
    services.digest,
    (problem) => {
      unreadable.push(problem);
    },
    signal,
  )) {
    roots.push(root);
  }
  if (unreadable.length > 0) {
    return succeed({ freed: 0, refused: { kind: 'unreadable', roots: unreadable } });
  }
  const collected = await collect(
    services.store,
    planned,
    { reclaimableBytes: planned.reclaimableBytes },
    roots,
    signal,
  );
  return collected.ok ? succeed({ freed: collected.value.reclaimedBytes }) : collected;
}
