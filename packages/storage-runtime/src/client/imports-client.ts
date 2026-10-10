/**
 * Importing many audio files at once, as the page asks the storage worker for
 * it (ADR-0090): a multiple choice or a folder's files, run one at a time in
 * the worker, each reported as it goes.
 */

import type { AssetId } from '@audiogubbins/domain';
import type { ImportChoice } from '@audiogubbins/media-store';
import type { ImportedBatch } from '@audiogubbins/storage';

import { importStream, type ImportReport } from '../protocol/import-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import type { LendingCall, PageDecoding, PageFile } from './page-ports.js';
import type { RemoteProjectSession } from './remote-project.js';

/** A batch of files to bring into a project. */
export interface FilesImport {
  /** The files, in the order they are imported, each with the identity its asset takes. */
  readonly files: readonly { readonly file: PageFile; readonly assetId: AssetId }[];

  /** Copied or linked, as the person's setting for bringing files in says. */
  readonly choice: ImportChoice;

  /** When the import happens, in whole milliseconds since the epoch. */
  readonly importedAt: number;

  /**
   * Starts the codec worker decoding a file by its index among `files`;
   * absent where the page has no codec worker, when a file needing one is
   * refused with why.
   */
  readonly decoding?: PageDecoding;
}

/** Importing many files. */
export interface ImportsClient {
  /**
   * Imports `request.files` into the project `session` writes, one at a time,
   * telling `report` of each file's event and the job after it, and answers
   * each file's outcome once the batch has ended. Called off, the file under
   * way and every file after it are cancelled; what was imported stays.
   */
  importFiles(
    session: RemoteProjectSession,
    request: FilesImport,
    report: (report: ImportReport) => void,
    signal?: AbortSignal,
  ): Promise<ImportedBatch>;
}

/** Importing many files, over calls that lend the page's files and decoder. */
export function importsClient(channel: ClientChannel, call: LendingCall): ImportsClient {
  let batches = 0;
  return {
    importFiles: async (session, { files, decoding, ...request }, report, signal) => {
      batches += 1;
      // Heard before the call is made, so no report of the batch is missed.
      const name = `batch-${String(batches)}`;
      const stop = channel.listen(importStream(name), report);
      try {
        return await call(
          'imports.run',
          (lend) => ({
            handle: session.handle,
            files: files.map(({ file, assetId }) => ({ file: lend.file(file), assetId })),
            ...(decoding === undefined ? {} : { decoder: lend.decoder(decoding) }),
            report: name,
            ...request,
          }),
          signal,
        );
      } finally {
        stop();
      }
    },
  };
}
