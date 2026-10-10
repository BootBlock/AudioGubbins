/**
 * Importing many files, from a multiple choice or a folder, as one job
 * (ADR-0090, REQ-ARCH-153): `@audiogubbins/import-export`'s `ImportJob`, run
 * one file at a time by the storage, with the codec worker decoding ahead by
 * at most one.
 *
 * A file is prepared (analysed, kept and decoded) while the one before it is
 * added to the project, and added only once that one has been, so the files
 * arrive in the project in the order they were chosen and no more than two are
 * under way. Each file's outcome is its own: one refused, with its reason,
 * stops nothing else. Cancelling stops the file being prepared, which keeps
 * nothing, and every file after it; a file already being added is added, and
 * what was imported before stays. Every stage and every report of progress is
 * taken by the job's machine as it happens, so the job the person is shown is
 * the job the storage ran, and a report the machine refuses is a defect.
 */

import type { AssetId, DomainFailure, DomainResult } from '@audiogubbins/domain';
import {
  cancelImport,
  importJob,
  nextImportJob,
  type ImportFileEvent,
  type ImportJob,
} from '@audiogubbins/import-export';
import type { ExternalFile, ImportChoice } from '@audiogubbins/media-store';

import { addPrepared, prepareImport } from './audio-import.js';
import type { StreamDecoding } from './decoded-stream.js';
import type { AudioImportServices, ImportedAudio, PreparedImport } from './import-contracts.js';
import type { ProjectSession } from './project-session.js';

/** One file of a batch. */
export interface BatchFile {
  readonly file: ExternalFile;

  /** The identity its asset takes, made by the page's generator. */
  readonly assetId: AssetId;

  /** Starts the codec worker decoding it, where it is decoded into a rendition. */
  readonly decode: StreamDecoding;
}

/** A batch of files, each brought in as `choice` says, at `importedAt`. */
export interface ImportBatch {
  readonly files: readonly BatchFile[];
  readonly choice: ImportChoice;
  readonly importedAt: number;
}

/** How one file of a batch ended. */
export type BatchOutcome =
  | { readonly kind: 'imported'; readonly imported: ImportedAudio }
  | { readonly kind: 'refused'; readonly failure: DomainFailure }
  | { readonly kind: 'cancelled' };

/** A batch run: the job as it ended, and each file's outcome, in order. */
export interface ImportedBatch {
  readonly job: ImportJob;
  readonly outcomes: readonly BatchOutcome[];
}

/** What a batch reports as it goes: the job after each file's event. */
export type BatchObserver = (job: ImportJob, index: number, event: ImportFileEvent) => void;

/** Runs a batch into the session's project (see the module comment). */
export async function importBatch(
  session: ProjectSession,
  batch: ImportBatch,
  services: AudioImportServices,
  observe: BatchObserver,
  signal?: AbortSignal,
): Promise<ImportedBatch> {
  const run = new BatchRun(batch, observe);
  let adding: Promise<void> = Promise.resolve();
  for (const [index, entry] of batch.files.entries()) {
    if (signal?.aborted === true) break;
    const prepared = await run.prepare(
      () =>
        prepareImport(
          session,
          { ...entry, choice: batch.choice, importedAt: batch.importedAt },
          services,
          (event) => {
            run.take(index, event);
          },
          signal,
        ),
      signal,
    );
    // The file before is added before this one, so files arrive in order.
    await adding;
    if (prepared === undefined) break;
    if (!prepared.ok) {
      run.refuse(index, prepared.failures[0]);
      continue;
    }
    run.take(index, { kind: 'add' });
    adding = run.add(index, () => addPrepared(session, prepared.value, services.commands));
  }
  await adding;
  return run.ended();
}

/** One batch as it runs: its job, and each file's outcome. */
class BatchRun {
  #job: ImportJob;
  readonly #outcomes: (BatchOutcome | undefined)[];
  readonly #observe: BatchObserver;

  constructor(batch: ImportBatch, observe: BatchObserver) {
    this.#job = importJob(
      batch.files.map(({ file }) => ({ name: file.fileName, bytes: file.source.size })),
    );
    this.#outcomes = batch.files.map(() => undefined);
    this.#observe = observe;
  }

  /** Takes a file's event into the job, which a report out of turn is a defect against. */
  take(index: number, event: ImportFileEvent): void {
    const next = nextImportJob(this.#job, index, event);
    if (!next.ok) throw new Error(next.failures[0].summary);
    this.#job = next.value;
    this.#observe(this.#job, index, event);
  }

  /**
   * Prepares a file, answering nothing where the batch was cancelled while it
   * was, which keeps nothing of it.
   */
  async prepare(
    work: () => Promise<DomainResult<PreparedImport>>,
    signal: AbortSignal | undefined,
  ): Promise<DomainResult<PreparedImport> | undefined> {
    try {
      return await work();
    } catch (error) {
      // A preparation rejects with its signal's reason where it is cancelled,
      // and otherwise only for a defect.
      if (signal?.aborted !== true) throw error;
      return undefined;
    }
  }

  /** Adds a prepared file, taking its outcome into the job. */
  async add(index: number, work: () => Promise<DomainResult<ImportedAudio>>): Promise<void> {
    const added = await work();
    if (!added.ok) {
      this.refuse(index, added.failures[0]);
      return;
    }
    this.#outcomes[index] = { kind: 'imported', imported: added.value };
    this.take(index, { kind: 'imported' });
  }

  refuse(index: number, failure: DomainFailure): void {
    this.#outcomes[index] = { kind: 'refused', failure };
    this.take(index, { kind: 'refused', failure });
  }

  /** The job as it ended, every file not yet ended cancelled. */
  ended(): ImportedBatch {
    this.#job = cancelImport(this.#job);
    return {
      job: this.#job,
      outcomes: this.#outcomes.map((outcome) => outcome ?? { kind: 'cancelled' }),
    };
  }
}
