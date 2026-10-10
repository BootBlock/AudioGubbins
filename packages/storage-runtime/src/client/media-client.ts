/**
 * Audio files, as the page asks the storage worker for them (ADR-0052): the
 * file of a stored object for the audio threads to read in ranges, and running
 * a planned paste. Files are imported as a batch (`imports-client.ts`), one
 * file or many alike.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { ContentId } from '@audiogubbins/project-format';
import type { AudioPaste, ChangeOutcome } from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';
import type { LendingCall, PageLocate } from './page-ports.js';
import type { RemoteProjectSession } from './remote-project.js';

/** Reading stored audio files, and pasting what the clipboard planned. */
export interface MediaClient {
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
    file: (contentId, signal) => channel.call('media.file', contentId, { signal }),
    paste: (session, paste, locate, signal) =>
      call(
        'media.paste',
        (lend) => ({ handle: session.handle, paste, locate: lend.locate(locate) }),
        signal,
      ),
  };
}
