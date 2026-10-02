/**
 * The files linked assets were recorded from, as the page asks the storage
 * worker to look at them again (REQ-STOR-104, REQ-STOR-053).
 */

import type { AssetId, DomainResult } from '@audiogubbins/domain';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { ChangeOutcome, VersionChange } from '@audiogubbins/storage';

import type { LendingCall, PageFile } from './page-ports.js';
import type { RemoteProjectSession } from './remote-project.js';

/** A file to take as a linked asset's new link or new version. */
export interface FileTaken {
  readonly asset: AssetId;
  readonly change: VersionChange;

  /** The file's identity as {@link SourcesClient.examine} gave it. */
  readonly identity: ExternalSourceIdentity;
  readonly file: PageFile;
}

/** Looking at linked files again. */
export interface SourcesClient {
  /**
   * The identity of `file` now, as `examineFile` gives it against `recorded`:
   * read, sampled and, where `recorded` knows the content, hashed whole in the
   * worker.
   */
  examine(
    recorded: ExternalSourceIdentity,
    file: PageFile,
    signal?: AbortSignal,
  ): Promise<DomainResult<ExternalSourceIdentity>>;

  /**
   * Links an asset of the project `session` writes to another file, or takes
   * the new version of its file, as one change undo reverses; where the asset
   * keeps a protected copy of its file, one is kept of this file too, read in
   * the worker.
   */
  takeVersion(
    session: RemoteProjectSession,
    taken: FileTaken,
    signal?: AbortSignal,
  ): Promise<DomainResult<ChangeOutcome>>;
}

/** Looking at linked files again, over calls that lend the page's ports. */
export function sourcesClient(call: LendingCall): SourcesClient {
  return {
    examine: (recorded, file, signal) =>
      call('sources.examine', (lend) => ({ recorded, file: lend.file(file) }), signal),
    takeVersion: (session, { asset, change, identity, file }, signal) =>
      call(
        'sources.takeVersion',
        (lend) => ({ handle: session.handle, asset, change, identity, file: lend.file(file) }),
        signal,
      ),
  };
}
