/**
 * Reachability of managed media, and its deterministic collection
 * (REQ-STOR-099, REQ-STOR-102, REQ-STOR-106).
 *
 * Media is never removed because a project stopped using it. It is removed only
 * by an explicit purge, in two steps. {@link planCollection} marks every object
 * reachable from the roots the caller gathers (each project's retained states,
 * snapshots, checkpoints, backups and recovery state), and every object a store
 * still holds for an import not yet recorded, and lists the rest with the bytes
 * they would free, sorted by identifier, removing nothing. {@link collect} then
 * removes, once the user has confirmed that plan, exactly the planned objects
 * that are still unreachable against roots gathered afresh, so nothing that
 * became reachable in between is lost.
 *
 * A root is a content identifier: media refers to nothing, so marking goes no
 * deeper than the roots. {@link contentReferencedBy} is the rule for which
 * identifiers a project state refers to.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { compareCodeUnits, type ContentId, type ProjectState } from '@audiogubbins/project-format';

import { refusalsReported } from './media-failures.js';
import { CollectionWarrant, type MediaObjectStore, type StoredObject } from './object-store.js';

/** The identifiers everything retained refers to, gathered by the storage layer. */
export type ContentRoots = Iterable<ContentId> | AsyncIterable<ContentId>;

/** The objects a purge would remove, and what it would free. */
export interface CollectionPlan {
  /** Sorted by identifier. */
  readonly unreachable: readonly StoredObject[];
  readonly reclaimableBytes: number;
}

/**
 * The user's confirmation of a plan: the bytes they were shown would be freed.
 * A confirmation of any other number is of another plan, and is refused.
 */
export interface PurgeConfirmation {
  readonly reclaimableBytes: number;
}

/** What a purge removed, and what it kept of its plan. */
export interface CollectionReport {
  readonly removed: readonly StoredObject[];
  readonly reclaimedBytes: number;

  /** Planned objects kept: reachable again, held by an import, or already gone. */
  readonly kept: readonly ContentId[];
}

/**
 * The managed objects a project state refers to: each managed source's
 * content, and each external source's retained copy. An external file's own
 * content identity is not one; the store need not hold it.
 */
export function* contentReferencedBy(state: ProjectState): Generator<ContentId, void, undefined> {
  for (const { media } of state.sources.values()) {
    if (media.kind === 'managed') yield media.contentId;
    else if (media.retainedCopy !== undefined) yield media.retainedCopy;
  }
}

/** The objects no root reaches and no import holds; nothing is removed. */
export async function planCollection(
  store: MediaObjectStore,
  roots: ContentRoots,
  signal?: AbortSignal,
): Promise<DomainResult<CollectionPlan>> {
  const reachable = await marked(roots, signal);
  return await refusalsReported(async () => {
    const unreachable: StoredObject[] = [];
    for await (const object of store.list(signal)) {
      if (!reachable.has(object.contentId) && !store.isHeld(object.contentId)) {
        unreachable.push(object);
      }
    }
    unreachable.sort((one, other) => compareCodeUnits(one.contentId, other.contentId));
    const reclaimableBytes = unreachable.reduce((sum, object) => sum + object.byteLength, 0);
    return succeed({ unreachable, reclaimableBytes });
  });
}

/**
 * Removes the planned objects that no fresh root reaches and no import holds,
 * once the plan is confirmed. Refuses a confirmation of another plan.
 */
export async function collect(
  store: MediaObjectStore,
  plan: CollectionPlan,
  confirmation: PurgeConfirmation,
  freshRoots: ContentRoots,
  signal?: AbortSignal,
): Promise<DomainResult<CollectionReport>> {
  if (confirmation.reclaimableBytes !== plan.reclaimableBytes) {
    return fail(
      failure(
        'media.purge-unconfirmed',
        FailureKind.Rejected,
        'The confirmation is of another plan than the one given to carry out.',
      ),
    );
  }
  const reachable = await marked(freshRoots, signal);
  const warrant = new CollectionWarrant(
    plan.unreachable.filter((object) => !reachable.has(object.contentId)),
  );
  const removal = await store.remove(warrant, signal);
  if (!removal.ok) return removal;

  const removed = removal.value;
  const removedIds = new Set(removed.map((object) => object.contentId));
  return succeed({
    removed,
    reclaimedBytes: removed.reduce((sum, object) => sum + object.byteLength, 0),
    kept: plan.unreachable
      .map((object) => object.contentId)
      .filter((contentId) => !removedIds.has(contentId)),
  });
}

async function marked(roots: ContentRoots, signal?: AbortSignal): Promise<ReadonlySet<ContentId>> {
  const reachable = new Set<ContentId>();
  for await (const contentId of roots) {
    signal?.throwIfAborted();
    reachable.add(contentId);
  }
  return reachable;
}
