/**
 * Taking another version of a linked asset's file: linking it to another file,
 * or adopting the new version of the same one, through the open session as one
 * change undo reverses (REQ-STOR-053, REQ-STOR-104).
 *
 * An asset that keeps a protected copy of its file keeps one of the version it
 * takes too, since that copy is what lets the person keep the version playing
 * later, by freezing it, when the file changes again. The copy is stored and
 * checked against the identity before the change is run, and held in the media
 * store, keeping every window's purge off it, until storage holds the change
 * that refers to it. An asset that keeps no copy is relinked or moved on with
 * none. The commands are the project commands', which the storage does not
 * depend on, so the caller gives their builders.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { AssetId, DomainResult } from '@audiogubbins/domain';
import {
  keepRetainedCopy,
  type ExternalFile,
  type MediaObjectStore,
} from '@audiogubbins/media-store';
import type { ContentId, Digest, ExternalSourceIdentity } from '@audiogubbins/project-format';

import { releaseOnceSaved } from './media-holds.js';
import type { ProjectSession } from './project-session.js';
import type { ChangeOutcome } from './session-contracts.js';

/** Which way a version is taken: as another file, or as the same file changed. */
export type VersionChange = 'relink' | 'adopt';

/** The version of a linked asset's file to take. */
export interface SourceVersion {
  readonly asset: AssetId;
  readonly change: VersionChange;

  /** The file's identity as it was examined. */
  readonly identity: ExternalSourceIdentity;
  readonly file: ExternalFile;
}

/** What taking a version works with, each made once by the composition root. */
export interface SourceVersionServices {
  readonly store: MediaObjectStore;
  readonly digest: Digest;

  /**
   * The invocation of each change: the project commands'
   * `relinkSourceInvocation` and `adoptSourceVersionInvocation`.
   */
  readonly invocation: Readonly<
    Record<
      VersionChange,
      (
        asset: AssetId,
        identity: ExternalSourceIdentity,
        retainedCopy?: ContentId,
      ) => CommandInvocation
    >
  >;
}

/** Takes a version of a linked asset's file (see the module comment). */
export async function takeSourceVersion(
  session: ProjectSession,
  version: SourceVersion,
  services: SourceVersionServices,
  signal?: AbortSignal,
): Promise<DomainResult<ChangeOutcome>> {
  const { asset, change } = version;
  const build = services.invocation[change];
  // An asset that is not linked, or not there, is the command's to refuse.
  const media = session.getSnapshot().model.state.sources.get(asset)?.media;
  if (media?.kind !== 'external' || media.retainedCopy === undefined) {
    return await session.run(build(asset, version.identity));
  }
  const kept = await keepRetainedCopy(
    version.file,
    version.identity,
    services,
    signal === undefined ? {} : { signal },
  );
  if (!kept.ok) return kept;
  const { identity, contentId } = kept.value;
  const release = (): void => {
    services.store.release(contentId);
  };
  let ran: DomainResult<ChangeOutcome> | undefined;
  try {
    ran = await session.run(build(asset, identity, contentId));
    return ran;
  } finally {
    if (ran?.ok === true && ran.value.kind === 'applied') releaseOnceSaved(session, release);
    else release();
  }
}
