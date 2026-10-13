/**
 * What the page asks the storage worker of audio files (ADR-0052): a stored
 * object's file, which the page hands the audio threads to read in ranges, and
 * a paste of what was copied, with the media it brings. Files are brought in
 * by the import operations (`import-operations.ts`).
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { ContentId } from '@audiogubbins/project-format';
import type { AudioPaste, ChangeOutcome } from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { PagePort } from './page-operations.js';
import type { ProjectHandle } from './project-operations.js';

/** The operations of audio files. */
export type MediaOperations = {
  /**
   * The file of a stored object, sealed and whole: a snapshot that reads the
   * bytes it was made over and never writes.
   */
  'media.file': Operation<ContentId, DomainResult<Blob>>;

  /**
   * Runs a paste the clipboard planned in the project open under `handle`, as
   * one change: the media of each record it brings shown to be there first,
   * each linked file found through the search the page lent as `locate`.
   */
  'media.paste': Operation<
    { readonly handle: ProjectHandle; readonly paste: AudioPaste; readonly locate: PagePort },
    DomainResult<ChangeOutcome>
  >;
};
