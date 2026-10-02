/**
 * The protected copy of a linked file a project keeps beside its link: the
 * retained copy that lets the version the project was made with be kept
 * playing when the file changes, which the freeze policy needs (REQ-STOR-053,
 * REQ-STOR-104).
 *
 * A copy is stored under its content identity, then the file is sampled again,
 * so the copy kept is of the version its identity describes and never of one
 * the file became while it was read. The identity given back names the content
 * the copy holds, which is what tells the copy and the link apart from any
 * other version later. The stored object is held in the store until the caller
 * releases it, once storage holds the change that refers to it or the change is
 * abandoned, so collection never takes it in between.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { ContentId, Digest, ExternalSourceIdentity } from '@audiogubbins/project-format';

import type { ExternalFile } from './external-file.js';
import { identityOutdated } from './media-failures.js';
import type { MediaObjectStore } from './object-store.js';
import type { PutOptions } from './object-writing.js';
import { sampleSource } from './source-sampling.js';

/** A protected copy kept of a linked file, and the file's identity naming it. */
export interface RetainedCopy {
  readonly identity: ExternalSourceIdentity;

  /** The object the store holds for the copy, which the caller releases. */
  readonly contentId: ContentId;
}

/**
 * Stores a protected copy of `file`, whose identity is `identity`, refused as
 * outdated where the file is no longer that version: sampled otherwise once
 * stored, or of other content than the identity knows. Keeps nothing where it
 * is refused.
 */
export async function keepRetainedCopy(
  file: ExternalFile,
  identity: ExternalSourceIdentity,
  services: { readonly store: MediaObjectStore; readonly digest: Digest },
  options: PutOptions = {},
): Promise<DomainResult<RetainedCopy>> {
  const { store, digest } = services;
  const stored = await store.put(file.source, options);
  if (!stored.ok) return stored;
  const { contentId } = stored.value;
  let handedOver = false;
  try {
    const again = await sampleSource(file.source, digest, options.signal);
    if (!again.ok) return again;
    const known = identity.contentId;
    if (
      again.value.fastFingerprint !== identity.fastFingerprint ||
      (known !== undefined && known !== contentId)
    ) {
      return fail(identityOutdated());
    }
    handedOver = true;
    return succeed({ identity: { ...identity, contentId }, contentId });
  } finally {
    if (!handedOver) store.release(contentId);
  }
}
