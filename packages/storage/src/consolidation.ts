/**
 * Consolidating a project: copying every asset linked to a file outside the
 * storage into the media store, so the project is self-contained (REQ-STOR-099,
 * REQ-STOR-053, REQ-STOR-104).
 *
 * Each asset is changed by one command through the open session, so each is in
 * the history and undone like any change. What is copied is the version the
 * project uses, never a newer one: an asset frozen on its retained copy takes
 * that copy, and one that follows its file takes the file only where it is
 * unchanged, told by the media store's own classification and, where the
 * identity knows its content, by the content itself. A file that cannot be
 * read falls back to a retained copy of the same content; one that changed is
 * passed over and reported, so the person decides, as the source change policy
 * has them do, and one that cannot be read and has no such copy is passed over
 * with the reason, so one that wants the person's leave is told from one that
 * has gone. The commands are the project commands', which the storage does not
 * depend on, so the caller gives their builder of the invocation that sets an
 * asset's media. What is copied is held in the media store, keeping every
 * window's purge off it, until storage holds the change that refers to it.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import { succeed, type AssetId, type DomainFailure, type DomainResult } from '@audiogubbins/domain';
import {
  classifySource,
  examineFile,
  type AbsenceReason,
  type ExternalFile,
  type MediaObjectStore,
  type YieldToHost,
} from '@audiogubbins/media-store';
import {
  SourceChangePolicy,
  type ContentId,
  type Digest,
  type ExternalMedia,
  type ExternalSourceIdentity,
  type ManagedMedia,
  type MediaSource,
} from '@audiogubbins/project-format';

import type { ProjectSession } from './project-session.js';

/** What consolidating works with, each made once by the composition root. */
export interface ConsolidationServices {
  readonly store: MediaObjectStore;
  readonly digest: Digest;

  /** Lets the host run between the chunks of a linked file's full hash. */
  readonly yieldToHost: YieldToHost;

  /** The file an asset is linked to, or why the platform cannot reach it now. */
  readonly locate: (
    asset: AssetId,
    identity: ExternalSourceIdentity,
    signal?: AbortSignal,
  ) => Promise<LocatedFile>;

  /**
   * The invocation that sets where an asset's bytes are kept: the project
   * commands' `setAssetMediaInvocation`, which the storage does not depend on.
   */
  readonly setMedia: (asset: AssetId, media: MediaSource) => CommandInvocation;
}

/** The file an asset is linked to, where it can be read, or why it cannot. */
export type LocatedFile =
  | { readonly kind: 'found'; readonly file: ExternalFile }
  | { readonly kind: 'absent'; readonly reason: AbsenceReason };

/**
 * Why a linked asset was not copied: its file changed, or it could not be read
 * and no copy of its content was retained. An asset kept on a retained copy
 * that is gone is `not-found`.
 */
export type PassedOverReason = 'changed' | AbsenceReason;

/** What became of one linked asset. */
export type AssetConsolidation =
  | { readonly asset: AssetId; readonly kind: 'consolidated'; readonly contentId: ContentId }
  | {
      readonly asset: AssetId;
      readonly kind: 'passed-over';
      readonly reason: PassedOverReason;
    }
  | { readonly asset: AssetId; readonly kind: 'failed'; readonly failure: DomainFailure };

/** Consolidates every linked asset of an open project (see the module comment). */
export async function consolidate(
  session: ProjectSession,
  services: ConsolidationServices,
  signal?: AbortSignal,
): Promise<DomainResult<readonly AssetConsolidation[]>> {
  const outcomes: AssetConsolidation[] = [];
  const { sources } = session.getSnapshot().model.state;
  for (const [asset, { media }] of sources) {
    signal?.throwIfAborted();
    if (media.kind !== 'external') continue;
    const copied = await copyOf(asset, media, services, signal);
    if (!copied.ok) return copied;
    if (copied.value.kind !== 'copied') {
      outcomes.push({ asset, kind: 'passed-over', reason: copied.value.reason });
      continue;
    }
    const { contentId, byteLength, held } = copied.value;
    const managed: ManagedMedia = {
      kind: 'managed',
      contentId,
      byteLength,
      mediaType: media.identity.mediaType,
    };
    const release = (): void => {
      if (held) services.store.release(contentId);
    };
    let ran: Awaited<ReturnType<ProjectSession['run']>> | undefined;
    try {
      ran = await session.run(services.setMedia(asset, managed));
    } finally {
      // The hold is let go once storage holds the change that refers to the
      // object, or at once where there is none; until then a purge in any
      // window would find nothing retaining it.
      if (ran?.ok === true) releaseOnceSaved(session, release);
      else release();
    }
    outcomes.push(
      ran.ok
        ? { asset, kind: 'consolidated', contentId }
        : { asset, kind: 'failed', failure: ran.failures[0] },
    );
  }
  return succeed(outcomes);
}

/** The managed copy of the version an asset uses, or why there is none to take. */
type Copy =
  | {
      readonly kind: 'copied';
      readonly contentId: ContentId;
      readonly byteLength: number;
      readonly held: boolean;
    }
  | { readonly kind: 'passed-over'; readonly reason: PassedOverReason };

const CHANGED: Copy = { kind: 'passed-over', reason: 'changed' };

async function copyOf(
  asset: AssetId,
  media: ExternalMedia,
  services: ConsolidationServices,
  signal?: AbortSignal,
): Promise<DomainResult<Copy>> {
  const { identity, retainedCopy } = media;
  const retained = async (reason: AbsenceReason): Promise<DomainResult<Copy>> => {
    const gone: Copy = { kind: 'passed-over', reason };
    if (retainedCopy === undefined) return succeed(gone);
    const found = await services.store.find(retainedCopy);
    if (!found.ok) return found;
    return succeed(
      found.value === undefined ? gone : { kind: 'copied', ...found.value, held: false },
    );
  };
  if (media.policy === SourceChangePolicy.Freeze) return await retained('not-found');
  const located = await services.locate(asset, identity, signal);
  if (located.kind === 'absent') {
    return identity.contentId !== undefined && identity.contentId === retainedCopy
      ? await retained(located.reason)
      : succeed({ kind: 'passed-over', reason: located.reason });
  }
  const { file } = located;
  const observed = await examineFile(identity, file, services, signal);
  if (!observed.ok) return observed;
  const classified = classifySource(identity, { kind: 'present', file: observed.value });
  if (classified.kind !== 'unchanged') return succeed(CHANGED);
  const stored = await services.store.put(file.source, signal === undefined ? {} : { signal });
  if (!stored.ok) return stored;
  const { contentId, byteLength } = stored.value;
  if (identity.contentId !== undefined && identity.contentId !== contentId) {
    services.store.release(contentId);
    return succeed(CHANGED);
  }
  return succeed({ kind: 'copied', contentId, byteLength, held: true });
}

/**
 * Calls `release` once the session has written everything it holds, or has
 * stopped writing, after which nothing it holds will reach storage.
 */
function releaseOnceSaved(session: ProjectSession, release: () => void): void {
  const settled = (): boolean => {
    const { save } = session.getSnapshot();
    return save.kind === 'saved' || save.kind === 'stopped';
  };
  if (settled()) {
    release();
    return;
  }
  const stop = session.subscribe(() => {
    if (!settled()) return;
    stop();
    release();
  });
}
