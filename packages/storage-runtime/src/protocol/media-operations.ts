/**
 * What the page asks the storage worker of audio files (ADR-0052): bringing
 * one into an open project, read and refused in the worker before anything is
 * stored, a stored object's file, which the page hands the audio threads to
 * read in ranges, and a paste of what was copied, with the media it brings.
 */

import type { AssetId, DomainResult } from '@audiogubbins/domain';
import type { ImportChoice } from '@audiogubbins/media-store';
import type { ContentId } from '@audiogubbins/project-format';
import type { AudioPaste, ChangeOutcome, ImportedAudio } from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { CrossingFile, PagePort } from './page-operations.js';
import type { ProjectHandle } from './project-operations.js';

/** The operations of audio files. */
export type MediaOperations = {
  /**
   * Imports the file into the project open under `handle` as the asset
   * `assetId`, by copy or link as `choice` says, in one change undo reverses.
   */
  'media.import': Operation<
    {
      readonly handle: ProjectHandle;
      readonly file: CrossingFile;
      readonly choice: ImportChoice;
      readonly assetId: AssetId;
      readonly importedAt: number;
    },
    DomainResult<ImportedAudio>
  >;

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
