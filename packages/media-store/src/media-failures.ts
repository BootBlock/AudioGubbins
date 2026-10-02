/**
 * The designed failures of the media store and the import pipeline, one
 * constructor each, so a code means one thing wherever it is raised
 * (REQ-EXEC-136.15).
 *
 * A refusal of the storage tree becomes a failure by its kind: a full store may
 * take the bytes once room is made (REQ-STOR-106), an unreachable one will not,
 * and any other refusal of the platform may pass. Nothing already stored is
 * harmed by any of them: the store's protocol leaves an incomplete change to
 * recovery, never to a reader.
 */

import {
  FailureKind,
  fail,
  failure,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { TreeFailure, TreeFailureKind, type ContentId } from '@audiogubbins/project-format';

/** The failure a refusal of the storage tree is reported as. */
function storageRefused(refusal: TreeFailure): DomainFailure {
  switch (refusal.kind) {
    case TreeFailureKind.Quota:
      return failure(
        'media.storage-full',
        FailureKind.Retryable,
        'The storage is full; the media can be stored once room is made.',
      );
    case TreeFailureKind.Unavailable:
      return failure(
        'media.storage-unavailable',
        FailureKind.Unrecoverable,
        'The storage cannot be reached, so no media can be stored or read.',
      );
    case TreeFailureKind.Io:
      return failure(
        'media.storage-failed',
        FailureKind.Retryable,
        'The storage refused the operation for a reason of its own.',
      );
  }
}

/**
 * The failure of a read that returned other than the bytes asked for: the
 * file changed or vanished while it was read.
 */
export function sourceChanged(offset: number, expected: number, received: number): DomainFailure {
  return failure(
    'media.source-changed',
    FailureKind.Conflict,
    'The file changed while it was read, so what was read is not one version of it.',
    { details: { offset, expected, received } },
  );
}

/** The failure of an identity that no longer describes the file it was taken from. */
export function identityOutdated(): DomainFailure {
  return failure(
    'media.source-changed',
    FailureKind.Conflict,
    'The file is no longer the one its identity was taken from.',
  );
}

/** The failure of asking for an object the store does not hold whole. */
export function objectMissing(contentId: ContentId): DomainFailure {
  return failure(
    'media.object-missing',
    FailureKind.Conflict,
    'The store holds no whole object of this identity.',
    { details: { contentId } },
  );
}

/** The failure of an object whose bytes are not the ones its name promises. */
export function objectDamaged(contentId: ContentId, reason: string): DomainFailure {
  return failure(
    'media.object-damaged',
    FailureKind.IntegrityViolation,
    'The stored bytes are not the ones their identity names.',
    { details: { contentId, reason } },
  );
}

/**
 * The failure of bytes given under a name that are not the media it names, such
 * as a bundle's entry damaged since its manifest was written.
 */
export function notTheNamedMedia(contentId: ContentId): DomainFailure {
  return failure(
    'media.not-as-named',
    FailureKind.IntegrityViolation,
    'The bytes given are not the media they were named as.',
    { details: { contentId } },
  );
}

/** Reports the tree's refusals as designed failures (REQ-EXEC-136.15). */
export async function refusalsReported<TValue>(
  work: () => Promise<DomainResult<TValue>>,
): Promise<DomainResult<TValue>> {
  try {
    return await work();
  } catch (error) {
    // Anything else, an abort among them, is the caller's to hear as thrown.
    if (error instanceof TreeFailure) return fail(storageRefused(error));
    throw error;
  }
}
