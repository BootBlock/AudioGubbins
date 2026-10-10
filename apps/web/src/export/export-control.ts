/**
 * The page's export (ADR-0092): one batch at a time, each of its files
 * rendered, encoded and staged (`export-runner.ts`), then delivered where the
 * person chose, with the person asked about a taken name where the rules ask.
 *
 * Everything that can refuse an export refuses it before anything renders or
 * is stored (`export-preparation.ts`). The batch's jobs follow
 * `@audiogubbins/import-export`'s state machines, which refuse a report that
 * cannot be so; such a refusal is a defect of this module, and fails the job
 * rather than being dropped.
 *
 * A delivery refused, for permission or a name the person skipped, keeps its
 * file staged: the batch goes on, and once every job has settled the export
 * is held, so the person may retry the delivery, deliver it elsewhere, or
 * cancel, which gives the staged files up, and none of them renders again.
 * Only a whole delivered file is said to be exported (`export-sentences.ts`),
 * and a download's staging is given up once the next export begins, since the
 * browser may still be reading it.
 */

import type { TrustedFolders } from '@audiogubbins/browser-storage';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  nextJobToStart,
  safeFileName,
  type ExportClock,
  type ExportSettings,
} from '@audiogubbins/import-export';
import type { Digest } from '@audiogubbins/project-format';
import type { CollisionReply, ExportOrigin } from '@audiogubbins/storage';
import type {
  DeliveryAnswer,
  ExportsClient,
  RemoteProjectSession,
} from '@audiogubbins/storage-runtime';

import type { CodecServices } from '../codecs/codec-services.js';
import type { AssetCatalogue } from '../state/asset-catalogue.js';
import { observable } from '../state/observable.js';
import { exportOrigin } from './export-origin.js';
import {
  prepareExport,
  roomFor,
  writableDestination,
  type JobParts,
} from './export-preparation.js';
import { exportRefusal, exportStopped } from './export-refusals.js';
import { stageFile, type ExportRunnerParts } from './export-runner.js';
import { ExportRun } from './export-run.js';
import type {
  ExportControl,
  ExportDestinationChoice,
  ExportRunState,
  ExportStart,
} from './export-types.js';
import { pageDestination } from './page-destination.js';

/** What the export works with, each made once by the composition root. */
export interface ExportControlParts {
  readonly runner: Omit<ExportRunnerParts, 'exports' | 'codecs'>;
  readonly codecs: Pick<CodecServices, 'capability' | 'encode'>;
  readonly exports: Pick<ExportsClient, 'stage' | 'deliver' | 'discard'>;

  /** The assets the editor opens, whose audio an export renders as it is heard. */
  readonly assets: AssetCatalogue;

  /** The folders kept trusted, absent where this browser keeps none. */
  readonly trusted: TrustedFolders | undefined;

  /**
   * Whether a handle may be written, asking the person where the browser
   * needs their leave; called first in `start`, `retry` and
   * `deliverElsewhere`, inside the gesture that ran them.
   */
  readonly allowWriting: (handle: FileSystemHandle) => Promise<boolean>;

  /** Hands a delivered download to the person. */
  readonly download: (file: Blob, name: string) => void;

  /** The bytes the storage has free, as its estimate gives it, or nothing where it gives none. */
  readonly room: () => Promise<number | undefined>;

  /** The page's SHA-256, which names the state an export renders. */
  readonly digest: Digest;

  /** The moment an export is asked for, which a file name's `{date}` is filled from. */
  readonly clock: () => ExportClock;
}

/** Why nothing is held, said where only a held export can be acted on. */
const NOT_HELD = exportRefusal('not-held', 'No export is waiting on a file it could not deliver.');

/** Why a second export cannot start beside the first. */
const RUNNING = exportRefusal('busy', 'An export is running; wait for it, or cancel it.');

/** The page's one export at a time (see the module comment). */
export class PageExportControl implements ExportControl {
  readonly #parts: ExportControlParts;
  readonly #state = observable<ExportRunState>({ kind: 'idle' });
  readonly get = this.#state.get;
  readonly subscribe = this.#state.subscribe;
  #run: ExportRun | undefined;
  #jobs = 0;
  /** The staged files handed to the browser as downloads, which it may still be reading. */
  #downloaded: string[] = [];

  constructor(parts: ExportControlParts) {
    this.#parts = parts;
  }

  async start(session: RemoteProjectSession, start: ExportStart): Promise<DomainResult<string>> {
    if (this.#busy()) {
      return fail(
        this.#state.get().kind === 'held'
          ? exportRefusal(
              'busy',
              'An export is waiting on a file it could not deliver; retry it, deliver it elsewhere, or cancel it first.',
            )
          : RUNNING,
      );
    }
    const { trusted, allowWriting } = this.#parts;
    const writable = await writableDestination(start.destination, trusted, allowWriting);
    if (!writable.ok) return writable;
    const prepared = prepareExport(this.#parts, session, start);
    if (!prepared.ok) return prepared;
    const roomy = await roomFor(prepared.value, this.#parts.room);
    if (!roomy.ok) return roomy;
    const { snapshot, target, jobs } = prepared.value;
    const origin = await exportOrigin(snapshot, start.settings, target, this.#parts.digest);
    await this.#forgetDownloads();
    // Asked again after the last await before it begins, so a second start
    // asked for meanwhile cannot run beside this one.
    if (this.#busy()) return fail(RUNNING);
    const run = this.#begin(session, start.settings, jobs, origin);
    await this.#runJobs(run);
    return succeed(this.#settle(run));
  }

  cancel(): boolean {
    const run = this.#run;
    if (run === undefined) return false;
    run.cancel.abort(exportRefusal('cancelled', 'The export was cancelled.'));
    run.answer(undefined);
    if (this.#state.get().kind === 'held') void this.#giveUp(run);
    return true;
  }

  answerCollision(reply: CollisionReply | undefined): boolean {
    return this.#run?.answer(reply) ?? false;
  }

  async retry(session: RemoteProjectSession, job: string): Promise<DomainResult<string>> {
    return await this.#redeliver(session, job, undefined);
  }

  async deliverElsewhere(
    session: RemoteProjectSession,
    job: string,
    destination: ExportDestinationChoice,
  ): Promise<DomainResult<string>> {
    return await this.#redeliver(session, job, destination);
  }

  /** Whether a batch is running or held, read afresh after each await. */
  #busy(): boolean {
    return this.#run !== undefined;
  }

  /** The batch of `jobs`, running. */
  #begin(
    session: RemoteProjectSession,
    settings: ExportSettings,
    jobs: readonly JobParts[],
    origin: ExportOrigin,
  ): ExportRun {
    const byId = new Map<string, JobParts>();
    for (const job of jobs) {
      this.#jobs += 1;
      byId.set(`export-${String(this.#jobs)}`, job);
    }
    const run: ExportRun = new ExportRun({ session, settings, origin, jobs: byId }, (state) => {
      // A batch is shown only while it is the page's, never after it ended.
      if (this.#run === run) this.#state.set(state);
    });
    this.#run = run;
    run.show();
    return run;
  }

  /** Runs every job of the batch in turn, until each has settled or the batch is cancelled. */
  async #runJobs(run: ExportRun): Promise<void> {
    for (
      let next = nextJobToStart(run.batch);
      next !== undefined && !run.cancel.signal.aborted;
      next = nextJobToStart(run.batch)
    ) {
      const parts = run.jobs.get(next.id);
      if (parts === undefined) break;
      await this.#runJob(run, next.id, parts);
    }
    if (run.cancel.signal.aborted) await this.#giveUp(run);
  }

  /** Stages one job's file and delivers it. */
  async #runJob(run: ExportRun, id: string, parts: JobParts): Promise<void> {
    const { signal } = run.cancel;
    const { file } = parts;
    run.report(id, { kind: 'render-started' });
    const staged = await stageFile(
      { ...this.#parts.runner, codecs: this.#parts.codecs, exports: this.#parts.exports },
      run.session,
      {
        file,
        source: parts.source,
        encode: {
          target: file.target,
          encoding: run.settings,
          sampleRate: file.render.sampleRate,
          layout: file.render.layout,
          metadata: parts.metadata,
          dither: { settings: run.settings.dither, key: file.ditherKey },
        },
        origin: run.origin,
      },
      (framesRendered, bytesStaged) => {
        run.report(id, { kind: 'progress', framesRendered, bytesStaged });
      },
      signal,
    );
    if (staged.ok) parts.staged = staged.value;
    if (signal.aborted) return;
    if (!staged.ok) {
      run.report(id, { kind: 'failed', failure: staged.failures[0] });
      return;
    }
    run.report(id, { kind: 'render-finished' });
    run.report(id, { kind: 'staged', staged: staged.value.staged });
    await this.#deliver(run, id, parts);
  }

  /** Delivers a staged job's file to its destination, as its rules and the person decide. */
  async #deliver(run: ExportRun, id: string, parts: JobParts): Promise<void> {
    const { staged, file } = parts;
    if (staged === undefined) return;
    run.report(id, {
      kind: 'delivery-started',
      target: { kind: parts.destination.kind, name: safeFileName(file.name) },
    });
    const destination = pageDestination(parts.destination, file, {
      remembered: run.batch.remembered,
      prompt: (name, signal) => run.ask(name, signal),
      trusted: this.#parts.trusted,
    });
    if (!destination.ok) {
      run.report(id, { kind: 'delivery-refused', failure: destination.failures[0] });
      return;
    }
    let answer: DomainResult<DeliveryAnswer>;
    try {
      answer = await this.#parts.exports.deliver(
        run.session,
        staged.token,
        staged.encoder,
        destination.value,
        run.cancel.signal,
      );
    } catch (error) {
      // A delivery called off rejects with why, and the batch is given up
      // after; any other is the storage worker gone from under it, which
      // fails this file and leaves the batch to go on or end.
      if (!run.cancel.signal.aborted) {
        run.report(id, { kind: 'failed', failure: exportStopped('delivery', error) });
      }
      return;
    }
    this.#answered(run, id, parts, answer);
  }

  /** What a delivery came to, reported as the job's step. */
  #answered(
    run: ExportRun,
    id: string,
    parts: JobParts,
    answer: DomainResult<DeliveryAnswer>,
  ): void {
    const { staged } = parts;
    if (staged === undefined) return;
    if (!answer.ok) {
      run.report(id, { kind: 'failed', failure: answer.failures[0] });
      return;
    }
    const delivered = answer.value;
    if (delivered.kind === 'refused') {
      run.remember(delivered.remembered);
      run.report(id, { kind: 'delivery-refused', failure: delivered.failure });
      return;
    }
    parts.staged = undefined;
    if (delivered.kind === 'delivered') {
      run.remember(delivered.remembered);
      run.delivered(id, staged.staged.bytes, delivered.name);
      return;
    }
    // The browser reads a download from the staging after this returns, so
    // it is given up only when the next export begins, or at start.
    this.#downloaded.push(staged.token);
    const name = safeFileName(parts.file.name);
    try {
      this.#parts.download(delivered.file, name);
    } catch (error) {
      // A browser that refuses downloads, as a locked-down one may.
      run.report(id, { kind: 'failed', failure: exportStopped('download', error) });
      return;
    }
    run.delivered(id, staged.staged.bytes, name);
  }

  /** Delivers a held job's file again, to where it was refused or to `elsewhere`. */
  async #redeliver(
    session: RemoteProjectSession,
    id: string,
    elsewhere: ExportDestinationChoice | undefined,
  ): Promise<DomainResult<string>> {
    const run = this.#run;
    if (run === undefined || this.#state.get().kind !== 'held') return fail(NOT_HELD);
    if (session.project !== run.session.project) {
      return fail(
        exportRefusal(
          'other-project',
          'That export was made from another project; open it to deliver the file.',
        ),
      );
    }
    const parts = run.jobs.get(id);
    const job = run.batch.jobs.find((one) => one.id === id);
    if (parts?.staged === undefined || job?.state.kind !== 'staged') {
      return fail(exportRefusal('not-waiting', 'That file is not waiting to be delivered.'));
    }
    // Running from here, so a second retry asked for while this one asks
    // for leave finds the export no longer held.
    run.show();
    const { trusted, allowWriting } = this.#parts;
    const writable = await writableDestination(
      elsewhere ?? parts.destination,
      trusted,
      allowWriting,
    );
    if (!writable.ok) {
      this.#settle(run);
      return writable;
    }
    if (elsewhere !== undefined) parts.destination = elsewhere;
    await this.#deliver(run, id, parts);
    if (run.cancel.signal.aborted) await this.#giveUp(run);
    return succeed(this.#settle(run));
  }

  /** Gives up the staging of the downloads an earlier export handed over, which the browser has read. */
  async #forgetDownloads(): Promise<void> {
    const tokens = this.#downloaded;
    this.#downloaded = [];
    for (const token of tokens) await this.#parts.exports.discard(token);
  }

  /** Gives up every staged file of a cancelled batch, and cancels every job not yet ended. */
  async #giveUp(run: ExportRun): Promise<void> {
    // One at a time: each is a call to the storage worker, which serves them in turn anyway.
    for (const token of run.givenUp()) await this.#parts.exports.discard(token);
    if (this.#run === run) this.#settle(run);
  }

  /** Shows the batch held or ended, as it settled, and answers what is said of it. */
  #settle(run: ExportRun): string {
    const { state, said } = run.settled();
    if (state.kind === 'ended' && this.#run === run) this.#run = undefined;
    this.#state.set(state);
    return said;
  }
}
