/**
 * Bringing audio files into the open project as one batch (REQ-STOR-025,
 * REQ-AUDIO-220, ADR-0052, ADR-0090): the files the person chooses, one or
 * several, or every file of a folder, each listed with its format, its size,
 * the stage it is at and how far it has got, and once it ends, what it came
 * to and why where it was refused.
 *
 * The files are asked for first, in the handler of the person's gesture, since
 * a browser opens no chooser outside one, and one dismissed brings nothing and
 * says nothing. The codec worker is made ready next, so a compressed file is
 * decoded there; where it cannot be, the batch runs all the same, since a file
 * read where it lies needs no codec, and the storage refuses each file that
 * needed one. Every file then goes through the storage worker's one batch path,
 * one at a time, as the person's setting for bringing files in says, and the
 * job shown is the job the storage reports, so the page keeps no machine of
 * its own to fall out of step. Quick Edit's file, chosen before its project is
 * made, takes the same path.
 *
 * One batch runs at a time. The person can call it off, which keeps nothing of
 * the file under way and imports none after it, and what was imported before
 * stays; letting the project go calls it off too. An ended batch stays listed
 * until the next begins, the person clears it, or its project is let go.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type IdGenerator,
} from '@audiogubbins/domain';
import { cancelImport, importJob, type ImportJob } from '@audiogubbins/import-export';
import { SourceHandling, type ImportChoice } from '@audiogubbins/media-store';
import type { ImportedBatch } from '@audiogubbins/storage';
import type { ImportsClient, PageFile, RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { TransferFiles } from '../io/transfer-files.js';
import { abandonment, isAbandoned, reasonOf, within } from './abandoning.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';
import type { ProjectPreferencesStore } from './project-preferences-store.js';

/**
 * Whether files are being brought in, and the batch as the storage last
 * reported it; or the batch as it ended, with the reason the codec worker
 * could not be made ready where it could not.
 */
export type ImportBatchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'importing'; readonly job: ImportJob }
  | {
      readonly kind: 'ended';
      readonly batch: ImportedBatch;
      readonly codecsUnready: DomainFailure | undefined;
    };

/** What a batch the person started came to. */
export type ImportBatchOutcome =
  | { readonly kind: 'dismissed' }
  | {
      readonly kind: 'ended';
      readonly batch: ImportedBatch;

      /** Why the codec worker could not be made ready, where it could not. */
      readonly codecsUnready: DomainFailure | undefined;
    };

/**
 * The codecs as an import asks them: made ready, once, so a compressed file is
 * decoded in the codec worker; the page's codec services answer it.
 */
export interface ImportCodecs {
  /** Starts and joins the codec worker, or says why it cannot be. */
  ready(): Promise<DomainResult<void>>;
}

/** How a batch is asked for: the project it goes into, its assets' identities, and the time. */
export interface ImportTarget {
  readonly session: RemoteProjectSession;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

const IDLE: ImportBatchState = { kind: 'idle' };

/** Why a second batch is refused while one is being imported. */
export const ONE_AT_A_TIME = failure(
  'import.one-at-a-time',
  FailureKind.Conflict,
  'Files are being imported already. Wait for them, or cancel the import.',
);

/** The reason an import the person called off is given up with. */
const CANCELLED = abandonment('The import was cancelled.');

/** What the person's setting makes of a file brought in. */
function choiceOf(handling: SourceHandling): ImportChoice {
  return handling === SourceHandling.Link
    ? { mode: SourceHandling.Link, keepProtectedCopy: false }
    : { mode: SourceHandling.Copy };
}

/** The job of `files`, every one queued, as the page lists it before the storage reports. */
function queuedJob(files: readonly PageFile[]): ImportJob {
  return importJob(
    files.map(({ fileName, bytes }) => ({
      name: fileName,
      bytes: bytes.kind === 'file' ? bytes.file.size : bytes.source.size,
    })),
  );
}

/** Brings batches of audio files into the open project, one batch at a time. */
export class ImportBatches implements Observable<ImportBatchState> {
  readonly #imports: Pick<ImportsClient, 'importFiles'>;
  readonly #codecs: ImportCodecs;
  readonly #files: Pick<TransferFiles, 'chooseMediaFiles' | 'chooseMediaFolder'>;
  readonly #project: Pick<OpenProjectStore, 'scope'>;
  readonly #preferences: Pick<ProjectPreferencesStore, 'get'>;
  readonly #state = observable<ImportBatchState>(IDLE);
  #running: AbortController | undefined;
  #forgetEnded: (() => void) | undefined;

  readonly get = this.#state.get;
  readonly subscribe = this.#state.subscribe;

  constructor(
    imports: Pick<ImportsClient, 'importFiles'>,
    codecs: ImportCodecs,
    files: Pick<TransferFiles, 'chooseMediaFiles' | 'chooseMediaFolder'>,
    project: Pick<OpenProjectStore, 'scope'>,
    preferences: Pick<ProjectPreferencesStore, 'get'>,
  ) {
    this.#imports = imports;
    this.#codecs = codecs;
    this.#files = files;
    this.#project = project;
    this.#preferences = preferences;
  }

  /** Asks for audio files, one or several, and brings them into `target`'s project. */
  readonly importFiles = async (target: ImportTarget): Promise<DomainResult<ImportBatchOutcome>> =>
    await this.#chooseAndImport(target, () => this.#files.chooseMediaFiles());

  /** Asks for a folder, and brings every file of it into `target`'s project. */
  readonly importFolder = async (target: ImportTarget): Promise<DomainResult<ImportBatchOutcome>> =>
    await this.#chooseAndImport(target, () => this.#files.chooseMediaFolder());

  /**
   * Brings `files`, which the person chose already, into `target`'s project:
   * the path Quick Edit takes, which chooses its file before it makes the
   * project.
   */
  readonly importChosen = async (
    target: ImportTarget,
    files: readonly PageFile[],
  ): Promise<DomainResult<Extract<ImportBatchOutcome, { readonly kind: 'ended' }>>> => {
    if (this.#running !== undefined) return fail(ONE_AT_A_TIME);
    const controller = new AbortController();
    const scope = this.#project.scope();
    const unfollow = within(controller, scope);
    this.#running = controller;
    this.#forgetEnded?.();
    this.#state.set({ kind: 'importing', job: queuedJob(files) });
    try {
      const ended = await this.#run(target, files, controller.signal);
      this.#state.set({ kind: 'ended', ...ended });
      this.#forgetWhenLetGo(scope);
      return succeed({ kind: 'ended', ...ended });
    } catch (error) {
      // Given up with the project, the rejection stands, as every abandoned
      // call's does, and nothing is left listed for a project let go.
      if (isAbandoned(error)) this.#state.set(IDLE);
      throw error;
    } finally {
      unfollow();
      this.#running = undefined;
    }
  };

  /** Calls off the batch running, where one is; answers whether one was. */
  readonly cancel = (): boolean => {
    if (this.#running === undefined) return false;
    this.#running.abort(CANCELLED);
    return true;
  };

  /** Stops listing the batch that ended; answers whether one was listed. */
  readonly clear = (): boolean => {
    if (this.#state.get().kind !== 'ended') return false;
    this.#forgetEnded?.();
    this.#state.set(IDLE);
    return true;
  };

  async #chooseAndImport(
    target: ImportTarget,
    choose: () => Promise<readonly PageFile[]>,
  ): Promise<DomainResult<ImportBatchOutcome>> {
    // Refused before the chooser opens, so no file is asked for in vain. A
    // chooser the person leaves open blocks nothing, since one the browser
    // never settles must not stop every later import.
    if (this.#running !== undefined) return fail(ONE_AT_A_TIME);
    const files = await choose();
    if (files.length === 0) return succeed({ kind: 'dismissed' });
    return await this.importChosen(target, files);
  }

  /** Makes the codec worker ready, then runs the batch in the storage worker. */
  async #run(
    { session, ids, clock }: ImportTarget,
    files: readonly PageFile[],
    signal: AbortSignal,
  ): Promise<{ readonly batch: ImportedBatch; readonly codecsUnready: DomainFailure | undefined }> {
    const ready = await this.#codecs.ready();
    const codecsUnready = ready.ok ? undefined : ready.failures[0];
    if (signal.aborted) {
      // Called off while the codec worker started, before the storage was
      // asked for anything: nothing was kept, and every file is cancelled.
      if (signal.reason !== CANCELLED) throw reasonOf(signal);
      const job = cancelImport(queuedJob(files));
      return {
        batch: { job, outcomes: files.map(() => ({ kind: 'cancelled' })) },
        codecsUnready,
      };
    }
    const batch = await this.#imports.importFiles(
      session,
      {
        files: files.map((file) => ({ file, assetId: ids.next<'AssetId'>() })),
        choice: choiceOf(this.#preferences.get().sourceHandling),
        importedAt: clock.now(),
      },
      ({ job }) => {
        this.#state.set({ kind: 'importing', job });
      },
      signal,
    );
    return { batch, codecsUnready };
  }

  /** Stops listing the ended batch once the project it went into is let go. */
  #forgetWhenLetGo(scope: AbortSignal): void {
    const forget = (): void => {
      this.#forgetEnded = undefined;
      this.#state.set(IDLE);
    };
    if (scope.aborted) {
      forget();
      return;
    }
    scope.addEventListener('abort', forget, { once: true });
    this.#forgetEnded = () => {
      scope.removeEventListener('abort', forget);
      this.#forgetEnded = undefined;
    };
  }
}
