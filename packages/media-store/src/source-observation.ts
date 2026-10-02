/**
 * Taking the identity of an external file: every quick signal at once, and the
 * full content identity later, in the background (REQ-STOR-104).
 *
 * The one home of an {@link ExternalSourceIdentity}'s making, so the identity
 * recorded when a file is linked and the one observed when it is looked at
 * again are made alike and compare signal for signal
 * (`source-classification.ts`).
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type {
  ByteSource,
  Digest,
  ExternalSourceIdentity,
  HashingOptions,
  YieldToHost,
} from '@audiogubbins/project-format';

import { checkedFile, type ExternalFile } from './external-file.js';
import { identityOutdated } from './media-failures.js';
import { hashProgressively } from './progressive-hashing.js';
import { sampleSource } from './source-sampling.js';

/** What completing an identity needs from the host. */
export interface CompletionServices {
  readonly digest: Digest;
  readonly yieldToHost: YieldToHost;
}

/**
 * The identity of a file from its quick signals, without its full content
 * identity. Fails where what the file says about itself cannot be recorded, or
 * where it changes while it is sampled.
 */
export async function observeFile(
  file: ExternalFile,
  digest: Digest,
  signal?: AbortSignal,
): Promise<DomainResult<ExternalSourceIdentity>> {
  const checked = checkedFile(file);
  if (!checked.ok) return checked;
  const sample = await sampleSource(file.source, digest, signal);
  if (!sample.ok) return sample;
  return succeed({ ...checked.value, byteLength: file.source.size, ...sample.value });
}

/**
 * The identity of a file found where a source was recorded, or offered in its
 * place, made to compare with the recorded one: its quick signals, and its full
 * content identity as well where the recorded identity carries one and the
 * samples match a file modified since, which the samples alone cannot clear.
 */
export async function examineFile(
  recorded: ExternalSourceIdentity,
  file: ExternalFile,
  services: CompletionServices,
  signal?: AbortSignal,
): Promise<DomainResult<ExternalSourceIdentity>> {
  const observed = await observeFile(file, services.digest, signal);
  if (!observed.ok || recorded.contentId === undefined) return observed;
  const found = observed.value;
  const sampledAlike =
    found.byteLength === recorded.byteLength && found.fastFingerprint === recorded.fastFingerprint;
  if (!sampledAlike || found.lastModified === recorded.lastModified) return observed;
  return await completeIdentity(
    found,
    file.source,
    services,
    signal === undefined ? {} : { signal },
  );
}

/**
 * The identity with its full content identity, hashed progressively from the
 * file it was taken from.
 *
 * The file is sampled again after hashing, so an identity is never completed
 * with the content of another version: `media.source-changed` where its length,
 * fast fingerprint or signature is no longer the identity's. A change during
 * hashing that keeps the length and every sampled byte cannot be seen.
 */
export async function completeIdentity(
  identity: ExternalSourceIdentity,
  source: ByteSource,
  services: CompletionServices,
  options: HashingOptions = {},
): Promise<DomainResult<ExternalSourceIdentity>> {
  if (source.size !== identity.byteLength) return fail(identityOutdated());
  const { digest, yieldToHost } = services;
  const hashed = await hashProgressively(source, digest, yieldToHost, options);
  if (!hashed.ok) return hashed;
  const after = await sampleSource(source, digest, options.signal);
  if (!after.ok) return after;
  if (
    after.value.fastFingerprint !== identity.fastFingerprint ||
    after.value.signature !== identity.signature
  ) {
    return fail(identityOutdated());
  }
  return succeed({ ...identity, contentId: hashed.value.contentId });
}
