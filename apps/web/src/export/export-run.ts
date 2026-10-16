/**
 * One batch of the page's export as it runs or is held (ADR-0092): its jobs
 * through `@audiogubbins/import-export`'s state machines, the question about
 * a taken name waiting for the person, the name each file was delivered
 * under, and what the batch is shown as.
 *
 * A step a job's state machine refuses is a defect of whoever reported it,
 * and fails the job rather than being dropped. The batch is shown running
 * while it is the page's, held once every job has settled with a file kept
 * after a refused delivery, and ended otherwise, with what is said of it.
 */

import {
  cancelExportBatch,
  exportBatch,
  nextExportBatch,
  plannedExport,
  type ExportBatch,
  type ExportJobEvent,
  type ExportSettings,
  type PlannedFile,
} from '@audiogubbins/import-export';
import type { CollisionReply } from '@audiogubbins/storage';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { JobParts } from './export-preparation.js';
import { endedSentence, heldSentence } from './export-sentences.js';
import type { ExportDestinationChoice, ExportRunState } from './export-types.js';

/** What a batch was made from: the project, and the jobs by their ids, each with its settings and origin. */
export interface RunOf {
  readonly session: RemoteProjectSession;
  readonly jobs: ReadonlyMap<string, JobParts>;
}

/** A batch running or held (see the module comment). */
export class ExportRun {
  readonly session: RemoteProjectSession;
  readonly jobs: ReadonlyMap<string, JobParts>;
  readonly files: ReadonlyMap<string, PlannedFile>;

  /** The settings each job's file is made by. */
  readonly settings: ReadonlyMap<string, ExportSettings>;

  /** Where each job's file goes, made afresh only when a delivery elsewhere changes one. */
  #destinations: ReadonlyMap<string, ExportDestinationChoice>;

  /** Calls off the work of the batch, a render or a delivery under way. */
  readonly cancel = new AbortController();
  #batch: ExportBatch;

  /** The name each delivered file was written under, which a rename may have changed. */
  #names: ReadonlyMap<string, string> = new Map();
  #asking:
    | { readonly name: string; readonly answer: (reply: CollisionReply | undefined) => void }
    | undefined;
  readonly #shown: (state: ExportRunState) => void;

  /** A batch of `of`'s jobs, shown through `shown` from its first `show`. */
  constructor(of: RunOf, shown: (state: ExportRunState) => void) {
    this.session = of.session;
    this.jobs = of.jobs;
    this.files = new Map([...of.jobs].map(([id, job]) => [id, job.file]));
    this.settings = new Map([...of.jobs].map(([id, job]) => [id, job.settings]));
    this.#destinations = new Map([...of.jobs].map(([id, job]) => [id, job.destination]));
    this.#batch = exportBatch(
      [...of.jobs].map(([id, job]) => plannedExport(id, job.file.render.range.length)),
    );
    this.#shown = shown;
  }

  get batch(): ExportBatch {
    return this.#batch;
  }

  /** Moves a job by `event`; a step its state machine refuses fails the job. */
  report(id: string, event: ExportJobEvent): void {
    const next = nextExportBatch(this.#batch, id, event);
    if (next.ok) this.#batch = next.value;
    else {
      const failed = nextExportBatch(this.#batch, id, {
        kind: 'failed',
        failure: next.failures[0],
      });
      if (failed.ok) this.#batch = failed.value;
    }
    this.show();
  }

  /** Sends the file of job `id` to `destination` from now on, where the person asked it delivered elsewhere. */
  redirect(id: string, destination: ExportDestinationChoice): void {
    const parts = this.jobs.get(id);
    if (parts === undefined) return;
    parts.destination = destination;
    this.#destinations = new Map([...this.#destinations, [id, destination]]);
  }

  /** What every shown state of the batch carries. */
  #shownRun(): Pick<
    ExportRunState & { kind: 'held' },
    'batch' | 'files' | 'settings' | 'destinations' | 'names'
  > {
    return {
      batch: this.#batch,
      files: this.files,
      settings: this.settings,
      destinations: this.#destinations,
      names: this.#names,
    };
  }

  /** Holds `answer` for the rest of the batch, where the person gave one. */
  remember(answer: ExportBatch['remembered']): void {
    this.#batch = { ...this.#batch, remembered: answer };
  }

  /** Reports a whole file of `bytes` delivered, under the name it was written as. */
  delivered(id: string, bytes: number, name: string): void {
    this.#names = new Map([...this.#names, [id, name]]);
    this.report(id, { kind: 'delivery-progress', bytesDelivered: bytes });
    this.report(id, { kind: 'delivered' });
  }

  /** Asks the person about the taken name `name`, until they answer, dismiss it, or `signal` aborts. */
  ask(name: string, signal: AbortSignal | undefined): Promise<CollisionReply | undefined> {
    return new Promise((resolve) => {
      const answer = (reply: CollisionReply | undefined): void => {
        signal?.removeEventListener('abort', dismissed);
        this.#asking = undefined;
        this.show();
        resolve(reply);
      };
      const dismissed = (): void => {
        answer(undefined);
      };
      if (signal?.aborted === true) {
        resolve(undefined);
        return;
      }
      signal?.addEventListener('abort', dismissed, { once: true });
      this.#asking = { name, answer };
      this.show();
    });
  }

  /** Answers the question waiting, answering whether one was. */
  answer(reply: CollisionReply | undefined): boolean {
    const asking = this.#asking;
    asking?.answer(reply);
    return asking !== undefined;
  }

  /** Cancels every job not yet ended, answering the tokens of the files they staged, now given up. */
  givenUp(): readonly string[] {
    this.#batch = cancelExportBatch(this.#batch);
    const tokens = [...this.jobs.values()].flatMap((job) =>
      job.staged === undefined ? [] : [job.staged.token],
    );
    for (const job of this.jobs.values()) job.staged = undefined;
    return tokens;
  }

  /** Shows the batch as running. */
  show(): void {
    this.#shown({ ...this.#shownRun(), kind: 'running', asking: this.#asking?.name });
  }

  /**
   * What the batch comes to once every job has settled: held where a file
   * waits and the batch was not cancelled, else ended, with the sentence said
   * of it.
   */
  settled(): { readonly state: ExportRunState; readonly said: string } {
    const waiting = this.#batch.jobs.some((job) => job.state.kind === 'staged');
    if (waiting && !this.cancel.signal.aborted) {
      return {
        state: { ...this.#shownRun(), kind: 'held' },
        said: heldSentence(this.#batch, this.files),
      };
    }
    const said = endedSentence(this.#batch, this.#names);
    return { state: { ...this.#shownRun(), kind: 'ended', said }, said };
  }
}
