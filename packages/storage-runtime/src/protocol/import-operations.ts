/**
 * What the page asks the storage worker of importing many audio files at once
 * (ADR-0090), and the report the worker sends of each file as the batch goes.
 *
 * The files cross as the page holds them, and the codec worker the page joined
 * to the storage worker analyses and decodes each that needs it, the decoded
 * stream passing from the codec worker to the storage worker over a port of
 * its own.
 * The page names the report the batch is sent on, so it hears the first
 * report; each is the batch's job after one file's event, which the page shows
 * as it is, having no machine of its own to keep in step.
 */

import type { AssetId } from '@audiogubbins/domain';
import type { ImportFileEvent, ImportJob } from '@audiogubbins/import-export';
import type { ImportChoice } from '@audiogubbins/media-store';
import type { ImportedBatch } from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { CrossingFile } from './page-operations.js';
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
   * Joins the storage worker to the codec worker over `port`, transferred,
   * whose other end the page gave the codec worker as a client of its own
   * (ADR-0090): every import of a compressed file is analysed and decoded
   * there. Joined again, the new port takes the place of the old.
   */
  'imports.connectCodecWorker': Operation<{ readonly port: MessagePort }, undefined>;

  /**
   * Imports `files` into the project open under `handle`, one at a time, each
   * copied or linked as `choice` says and decoded by the codec worker where it
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
      readonly report: string;
    },
    ImportedBatch
  >;
};
