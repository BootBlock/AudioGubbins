/**
 * What the page asks the storage worker of importing many audio files at once
 * (ADR-0090), and the report the worker sends of each file as the batch goes.
 *
 * The files cross as the page holds them, and the decoder the page lends
 * starts the codec worker decoding each that needs it, the decoded stream
 * passing from the codec worker to the storage worker over a port of its own.
 * The page names the report the batch is sent on, so it hears the first
 * report; each is the batch's job after one file's event, which the page shows
 * as it is, having no machine of its own to keep in step.
 */

import type { AssetId } from '@audiogubbins/domain';
import type { ImportFileEvent, ImportJob } from '@audiogubbins/import-export';
import type { ImportChoice } from '@audiogubbins/media-store';
import type { ImportedBatch } from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { CrossingFile, PagePort } from './page-operations.js';
import type { ProjectHandle } from './project-operations.js';

/** One file of a batch, and the identity its asset takes. */
export interface BatchFileImport {
  readonly file: CrossingFile;
  readonly assetId: AssetId;
}

/** A report of a batch: its job after the event of the file at `index`. */
export interface ImportReport {
  readonly job: ImportJob;
  readonly index: number;
  readonly event: ImportFileEvent;
}

/** The stream a batch's reports are sent on, named by the page. */
export type ImportStream = `import:${string}`;

/** The name of the stream the reports of the batch named `report` are sent on. */
export function importStream(report: string): ImportStream {
  return `import:${report}`;
}

/** The operations of importing many files. */
export type ImportOperations = {
  /**
   * Imports `files` into the project open under `handle`, one at a time, each
   * copied or linked as `choice` says and decoded through `decoder` where it
   * needs it, reporting on the stream `report` names; answers each file's
   * outcome once the batch has ended. Called off, the file under way and
   * every file after it are cancelled, and what was imported before stays.
   */
  'imports.run': Operation<
    {
      readonly handle: ProjectHandle;
      readonly files: readonly BatchFileImport[];
      readonly choice: ImportChoice;
      readonly importedAt: number;
      readonly decoder?: PagePort;
      readonly report: string;
    },
    ImportedBatch
  >;
};
