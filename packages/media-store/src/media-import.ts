/**
 * Bringing a file the user chose into a project, by copy or by reference, as
 * they choose (REQ-STOR-025): the asset's media source and its import
 * provenance (REQ-STOR-166).
 *
 * A copy is stored in the shared object store under its content identity, so
 * the same bytes imported twice, into one project or two, are kept once
 * (REQ-STOR-099). A reference leaves the file where it is and records the
 * identity it is recognised by (REQ-STOR-104), with the policy that asks before
 * anything changes (REQ-STOR-053). A reference may keep a protected copy as
 * well: the retained copy that lets a later change be refused and the version
 * the project was made with kept, which the freeze policy needs.
 *
 * Reading the audio's shape is not this module's: that is a codec's, and the
 * caller builds the domain asset from it. The managed object an import stores
 * is held in the store until the caller releases it, once the asset is recorded
 * in a project's state or abandoned, so collection never takes it in between.
 */

import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import {
  DEFAULT_SOURCE_CHANGE_POLICY,
  type AssetProvenance,
  type AssetSource,
  type ContentId,
  type Digest,
  type ExternalSourceIdentity,
} from '@audiogubbins/project-format';

import { checkedFile, type ExternalFile } from './external-file.js';
import { identityOutdated } from './media-failures.js';
import type { MediaObjectStore } from './object-store.js';
import type { PutOptions } from './object-writing.js';
import type { YieldToHost } from './progressive-hashing.js';
import { completeIdentity, observeFile } from './source-observation.js';
import { sampleSource } from './source-sampling.js';

/** How a file is brought in. */
export type ImportChoice =
  { readonly mode: 'copy' } | { readonly mode: 'reference'; readonly keepProtectedCopy: boolean };

/** One file to bring into one project. */
export interface ImportRequest {
  readonly file: ExternalFile;
  readonly choice: ImportChoice;
  readonly projectId: ProjectId;

  /** When the import happens, in whole milliseconds since the epoch. */
  readonly importedAt: number;
}

/** What an import works through. */
export interface ImportServices {
  readonly store: MediaObjectStore;
  readonly digest: Digest;

  /** Lets the host run between the chunks of a linked file's full hash. */
  readonly yieldToHost: YieldToHost;
}

/** A file brought in. */
export interface ImportedMedia {
  readonly source: AssetSource;

  /**
   * The managed object the store holds for this import, where one was stored,
   * which the caller releases through {@link MediaObjectStore.release}.
   */
  readonly held?: ContentId;
}

/**
 * Brings a file in as `request.choice` says. Rejects with the signal's reason
 * on abort, having kept nothing.
 */
export async function importMedia(
  request: ImportRequest,
  services: ImportServices,
  options: PutOptions = {},
): Promise<DomainResult<ImportedMedia>> {
  if (!Number.isSafeInteger(request.importedAt) || request.importedAt < 0) {
    throw new RangeError('An import happens at whole milliseconds since the epoch.');
  }
  return request.choice.mode === 'copy'
    ? await copyIn(request, services, options)
    : await referTo(request, request.choice.keepProtectedCopy, services, options);
}

async function copyIn(
  request: ImportRequest,
  { store }: ImportServices,
  options: PutOptions,
): Promise<DomainResult<ImportedMedia>> {
  const checked = checkedFile(request.file);
  if (!checked.ok) return checked;
  const stored = await store.put(request.file.source, options);
  if (!stored.ok) return stored;

  const { contentId, byteLength } = stored.value;
  const { fileName, mediaType } = checked.value;
  return succeed({
    source: {
      media: { kind: 'managed', contentId, byteLength, mediaType },
      provenance: {
        ...provenanceBase(request, fileName, byteLength, mediaType),
        sourceContentId: contentId,
      },
    },
    held: contentId,
  });
}

async function referTo(
  request: ImportRequest,
  keepProtectedCopy: boolean,
  { store, digest, yieldToHost }: ImportServices,
  options: PutOptions,
): Promise<DomainResult<ImportedMedia>> {
  const { file } = request;
  const observed = await observeFile(file, digest, options.signal);
  if (!observed.ok) return observed;
  if (!keepProtectedCopy) {
    // The full content identity, taken now, is what later tells an edit the
    // samples miss from the file as it was linked.
    const complete = await completeIdentity(
      observed.value,
      file.source,
      { digest, yieldToHost },
      options.signal === undefined ? {} : { signal: options.signal },
    );
    return complete.ok ? succeed({ source: referenceOf(request, complete.value) }) : complete;
  }

  const stored = await store.put(file.source, options);
  if (!stored.ok) return stored;
  const { contentId } = stored.value;
  let handedOver = false;
  try {
    // Sampled again, so the copy kept is of the version the identity describes.
    const again = await sampleSource(file.source, digest, options.signal);
    if (!again.ok) return again;
    if (again.value.fastFingerprint !== observed.value.fastFingerprint) {
      return fail(identityOutdated());
    }
    const identity = { ...observed.value, contentId };
    handedOver = true;
    return succeed({ source: referenceOf(request, identity, contentId), held: contentId });
  } finally {
    if (!handedOver) store.release(contentId);
  }
}

function referenceOf(
  request: ImportRequest,
  identity: ExternalSourceIdentity,
  retainedCopy?: ContentId,
): AssetSource {
  const { byteLength, mediaType, fastFingerprint, contentId } = identity;
  return {
    media: {
      kind: 'external',
      identity,
      policy: DEFAULT_SOURCE_CHANGE_POLICY,
      ...(retainedCopy === undefined ? {} : { retainedCopy }),
    },
    provenance: {
      // The name observing the file checked.
      ...provenanceBase(request, request.file.fileName, byteLength, mediaType),
      sourceFingerprint: fastFingerprint,
      ...(contentId === undefined ? {} : { sourceContentId: contentId }),
    },
  };
}

function provenanceBase(
  request: ImportRequest,
  fileName: string,
  byteLength: number,
  mediaType: string,
): AssetProvenance {
  return {
    originalFileName: fileName,
    importedAt: request.importedAt,
    byteLength,
    mediaType,
    originProjectId: request.projectId,
  };
}
