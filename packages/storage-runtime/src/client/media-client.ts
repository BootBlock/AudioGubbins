/**
 * Audio files, as the page asks the storage worker for them (ADR-0052):
 * importing one into the project a session writes, the file of a stored object
 * for the audio threads to read in ranges, and running a planned paste.
 */

import type { AssetId, DomainResult } from '@audiogubbins/domain';
import type { ImportChoice } from '@audiogubbins/media-store';
import type { ContentId } from '@audiogubbins/project-format';
import type { AudioPaste, ChangeOutcome, ImportedAudio } from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';
import type { LendingCall, PageFile, PageLocate } from './page-ports.js';
import type { RemoteProjectSession } from './remote-project.js';

/** One audio file to bring into a project. */
export interface AudioFileImport {
  readonly file: PageFile;

  /** Copied or linked, as the person's setting for bringing files in says. */
  readonly choice: ImportChoice;

  /** The identity the new asset takes. */
  readonly assetId: AssetId;

  /** When the import happens, in whole milliseconds since the epoch. */
  readonly importedAt: number;
}

/** Importing audio files and reading stored ones. */
export interface MediaClient {
  /**
   * Imports a file into the project `session` writes, as one change undo
   * reverses: opened in the worker and refused, naming what it is, before
   * anything is stored. Called off, it keeps nothing.
   */
  importFile(
    session: RemoteProjectSession,
    request: AudioFileImport,
    signal?: AbortSignal,
  ): Promise<DomainResult<ImportedAudio>>;

  /** A stored object's file, sealed and whole, which never changes. */
  file(contentId: ContentId, signal?: AbortSignal): Promise<DomainResult<Blob>>;

  /**
   * Runs a paste the clipboard planned in the project `session` writes, as one
   * change: the media each record brings is shown to be there first, linked
   * files found by `locate`, and a missing or changed one refuses the paste.
   */
  paste(
    session: RemoteProjectSession,
    paste: AudioPaste,
    locate: PageLocate,
    signal?: AbortSignal,
  ): Promise<DomainResult<ChangeOutcome>>;
}

/** Audio files, over calls to the worker and calls that lend the page's ports. */
export function mediaClient(channel: ClientChannel, call: LendingCall): MediaClient {
  return {
    importFile: (session, { file, ...request }, signal) =>
      call(
        'media.import',
        (lend) => ({ handle: session.handle, file: lend.file(file), ...request }),
        signal,
      ),
    file: (contentId, signal) => channel.call('media.file', contentId, { signal }),
    paste: (session, paste, locate, signal) =>
      call(
        'media.paste',
        (lend) => ({ handle: session.handle, paste, locate: lend.locate(locate) }),
        signal,
      ),
  };
}
