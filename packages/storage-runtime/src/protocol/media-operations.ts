/**
 * What the page asks the storage worker of audio files (ADR-0052): bringing
 * one into an open project, read and refused in the worker before anything is
 * stored, and a stored object's file, which the page hands the audio threads to
 * read in ranges.
 */

import type { AssetId, DomainResult } from '@audiogubbins/domain';
import type { ImportChoice } from '@audiogubbins/media-store';
import type { ContentId } from '@audiogubbins/project-format';
import type { ImportedAudio } from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { CrossingFile } from './page-operations.js';
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
};
