/**
 * Bringing a file the user chose into a project, by copy or by link, as they
 * choose (REQ-STOR-025): the asset's media source and its import provenance
 * (REQ-STOR-166). The person's setting for how files are brought in holds one
 * of the {@link SourceHandling} choices an import takes, so the setting and the
 * import speak of one choice.
 *
 * A copy is stored in the shared object store under its content identity, so
 * the same bytes imported twice, into one project or two, are kept once
 * (REQ-STOR-099). A link leaves the file where it is and records the identity
 * it is recognised by (REQ-STOR-104), with the policy for what happens when it
 * changes that the person chose for it, or the one that asks before anything
 * changes (REQ-STOR-053). A link may keep a protected copy as well: the
 * retained copy that lets a later change be refused and the version the project
 * was made with kept, which the freeze policy needs, so a link without one
 * cannot be given that policy.
 *
 * Reading the audio's shape is not this module's: that is a codec's, and the
 * caller builds the domain asset from it. The managed object an import stores
 * is held in the store until the caller releases it, once the asset is recorded
 * in a project's state or abandoned, so collection never takes it in between.
 */

import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import {
  DEFAULT_SOURCE_CHANGE_POLICY,
  type SourceChangePolicy,
  type AssetProvenance,
  type AssetSource,
  type ContentId,
  type Digest,
  type ExternalSourceIdentity,
  type YieldToHost,
} from '@audiogubbins/project-format';

import { checkedFile, type ExternalFile } from './external-file.js';
import type { MediaObjectStore } from './object-store.js';
import type { PutOptions } from './object-writing.js';
import { keepRetainedCopy } from './retained-copies.js';
import { completeIdentity, observeFile } from './source-observation.js';

/** How a file is brought into a project, as the person's setting holds it. */
export const SourceHandling = {
  /** A copy kept in the project, which nothing outside can change or take away. */
  Copy: 'copy',

  /** A link to the file where it lies, which takes no room and follows its changes. */
  Link: 'link',
} as const;

/** How a file is brought into a project. */
export type SourceHandling = (typeof SourceHandling)[keyof typeof SourceHandling];

/**
 * How a file is brought in: copied, or linked, with what happens when it
 * changes where the person chose it, and a protected copy where they keep one.
 */
export type ImportChoice =
  | { readonly mode: typeof SourceHandling.Copy }
  | {
      readonly mode: typeof SourceHandling.Link;
      readonly keepProtectedCopy: true;
      readonly policy?: SourceChangePolicy;
    }
  | {
      readonly mode: typeof SourceHandling.Link;
      readonly keepProtectedCopy: false;

      /** Keeping the version the project was made with needs the protected copy. */
      readonly policy?: Exclude<SourceChangePolicy, 'freeze'>;
    };

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
  return request.choice.mode === SourceHandling.Copy
    ? await copyIn(request, services, options)
    : await linkTo(request, request.choice, services, options);
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

async function linkTo(
  request: ImportRequest,
  choice: Extract<ImportChoice, { readonly mode: typeof SourceHandling.Link }>,
  { store, digest, yieldToHost }: ImportServices,
  options: PutOptions,
): Promise<DomainResult<ImportedMedia>> {
  const { file } = request;
  const policy = choice.policy ?? DEFAULT_SOURCE_CHANGE_POLICY;
  const observed = await observeFile(file, digest, options.signal);
  if (!observed.ok) return observed;
  if (!choice.keepProtectedCopy) {
    // The full content identity, taken now, is what later tells an edit the
    // samples miss from the file as it was linked.
    const complete = await completeIdentity(
      observed.value,
      file.source,
      { digest, yieldToHost },
      options.signal === undefined ? {} : { signal: options.signal },
    );
    return complete.ok ? succeed({ source: linkOf(request, policy, complete.value) }) : complete;
  }

  const kept = await keepRetainedCopy(file, observed.value, { store, digest }, options);
  if (!kept.ok) return kept;
  const { identity, contentId } = kept.value;
  return succeed({ source: linkOf(request, policy, identity, contentId), held: contentId });
}

function linkOf(
  request: ImportRequest,
  policy: SourceChangePolicy,
  identity: ExternalSourceIdentity,
  retainedCopy?: ContentId,
): AssetSource {
  const { byteLength, mediaType, fastFingerprint, contentId } = identity;
  return {
    media: {
      kind: 'external',
      identity,
      policy,
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
