/**
 * The page's export (ADR-0092): one batch at a time, each of its files
 * rendered, encoded and staged (`export-runner.ts`), then delivered where the
 * person chose, with the person asked about a taken name where the rules ask.
 *
 * Everything that can refuse an export refuses it before anything renders or
 * is stored: settings that cannot be planned, a destination that holds one
 * file for a batch of several, a codec this browser cannot write with (naming
 * the codecs that serve instead), and storage with too little room for the
 * staged files at their largest (`staged-size.ts`), naming the room needed and
 * the room free. The batch's jobs follow `@audiogubbins/import-export`'s
 * state machines, which refuse a report that cannot be so; such a refusal is
 * a defect of this module, and fails the job rather than being dropped.
 *
 * A delivery refused, for permission or a name the person skipped, keeps its
 * file staged: the batch goes on, and once every job has settled the export
 * is held, so the person may retry the delivery, deliver it elsewhere, or
 * cancel, which gives the staged files up, and none of them renders again.
 * Only a whole delivered file is said to be exported, and a download is
 * given up from the staging once the browser has taken it.
 */

import { codecDescriptor, type MetadataMap } from '@audiogubbins/codecs';
import type { TrustedFolders } from '@audiogubbins/browser-storage';
import type { PcmDescription } from '@audiogubbins/audio-engine';
import {
  FailureKind,
  combine,
  fail,
  failure,
  flatMapResult,
  mapResult,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { ContainerId } from '@audiogubbins/codecs';
import {
  cancelExportBatch,
  exportBatch,
  nextExportBatch,
  nextJobToStart,
  plannedExport,
  planExport,
  safeFileName,
  type ExportBatch,
  type ExportClock,
  type ExportJob,
  type ExportJobEvent,
  type ExportSettings,
  type ExportTarget,
  type PlannedFile,
} from '@audiogubbins/import-export';
import type { Digest, KeptMetadata } from '@audiogubbins/project-format';
import type { CollisionReply, ExportOrigin, ProjectSnapshot } from '@audiogubbins/storage';
import type {
  DeliveryAnswer,
  ExportsClient,
  PageDestination,
  RemoteProjectSession,
} from '@audiogubbins/storage-runtime';
import { counted, quoted } from '@audiogubbins/text';

import type { EditorAsset } from '../assets/editor-asset.js';
import { assetEntryId, regionEntryId } from '../assets/project-entry.js';
import type { CodecServices } from '../codecs/codec-services.js';
import { exportContextOf } from '../export/export-context.js';
import { exportOrigin } from '../export/export-origin.js';
import { stageFile, type ExportRunnerParts, type StagedRun } from '../export/export-runner.js';
import type {
  ExportControl,
  ExportDestinationChoice,
  ExportRunState,
  ExportStart,
} from '../export/export-types.js';
import { fileMetadata } from '../export/file-metadata.js';
import { stagedSizeBound } from '../export/staged-size.js';
import { describeBytes } from '../wording.js';
import type { AssetCatalogue } from './asset-catalogue.js';
import { observable } from './observable.js';

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

/** The media type a download of each container is offered as. */
const MEDIA_TYPES: Readonly<Record<ContainerId, string>> = {
  wav: 'audio/wav',
  rf64: 'audio/wav',
  bw64: 'audio/wav',
  aiff: 'audio/aiff',
  aifc: 'audio/aiff',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  mp4: 'audio/mp4',
  adts: 'audio/aac',
  webm: 'audio/webm',
  matroska: 'audio/x-matroska',
};

/** Why an export cannot start or go on. */
function refusal(code: string, summary: string, details?: DomainFailure['details']): DomainFailure {
  return failure(
    `export.${code}`,
    FailureKind.Rejected,
    summary,
    details === undefined ? {} : { details },
  );
}

/** The words for a codec, as the person knows it. */
function codecName(codec: Parameters<typeof codecDescriptor>[0]): string {
  return codecDescriptor(codec).name;
}

/** A file of a running batch, with everything it needs to be staged and delivered. */
interface JobParts {
  readonly file: PlannedFile;
  readonly source: PcmDescription;
  readonly metadata: MetadataMap;
  readonly bound: number;

  /** Where it goes, which a delivery elsewhere changes. */
  destination: ExportDestinationChoice;

  /** The file staged, once it is. */
  staged: StagedRun | undefined;
}

/** An export planned and checked, before its origin is taken and it begins. */
interface Prepared {
  readonly jobs: readonly JobParts[];
  readonly snapshot: ProjectSnapshot;
  readonly target: ExportTarget;
}

/** A batch the page is running or holding. */
interface Run {
  readonly session: RemoteProjectSession;
  readonly settings: ExportSettings;
  readonly origin: ExportOrigin;
  readonly jobs: ReadonlyMap<string, JobParts>;
  readonly files: ReadonlyMap<string, PlannedFile>;
  batch: ExportBatch;

  /** The name each delivered file was written under, which a rename may have changed from the one wanted. */
  readonly names: Map<string, string>;

  /** Calls off the work of the batch, a render or a delivery under way. */
  readonly cancel: AbortController;

  /** The question waiting for the person, and how it is answered. */
  asking:
    | { readonly name: string; readonly answer: (reply: CollisionReply | undefined) => void }
    | undefined;
}

/** What was said of the batch once every job ended, from what became of each. */
function endedSentence(batch: ExportBatch, names: ReadonlyMap<string, string>): string {
  const delivered = batch.jobs.filter((job) => job.state.kind === 'delivered');
  const failed = batch.jobs.filter(
    (job): job is ExportJob & { state: { kind: 'failed' } } => job.state.kind === 'failed',
  );
  const cancelled = batch.jobs.filter((job) => job.state.kind === 'cancelled').length;
  const parts: string[] = [];
  const [only] = delivered;
  const name = only === undefined ? undefined : names.get(only.id);
  if (delivered.length === 1 && name !== undefined) {
    parts.push(`${quoted(name)} is exported.`);
  } else if (delivered.length > 1) {
    parts.push(`${counted(delivered.length, 'file is', 'files are')} exported.`);
  }
  const [firstFailure] = failed;
  if (firstFailure !== undefined) {
    parts.push(
      `${counted(failed.length, 'file', 'files')} could not be exported: ${firstFailure.state.failure.summary}`,
    );
  }
  if (cancelled > 0) {
    parts.push(
      `${counted(cancelled, 'file was', 'files were')} cancelled, and nothing of ${cancelled === 1 ? 'it' : 'them'} was kept.`,
    );
  }
  return parts.length === 0 ? 'Nothing was exported.' : parts.join(' ');
}

/** What is said of a held batch: the files that wait, and why the first was refused. */
function heldSentence(batch: ExportBatch, files: ReadonlyMap<string, PlannedFile>): string {
  const waiting = batch.jobs.filter((job) => job.state.kind === 'staged');
  const [first] = waiting;
  const reason = first?.state.kind === 'staged' ? first.state.refused?.summary : undefined;
  const name = first === undefined ? undefined : files.get(first.id)?.name;
  const which =
    waiting.length === 1 && name !== undefined
      ? quoted(safeFileName(name))
      : counted(waiting.length, 'file', 'files');
  return `${which} could not be delivered${reason === undefined ? '' : `: ${reason}`} It is kept, so you can retry, choose another destination, or cancel the export, with no new render.`;
}

/** The page's one export at a time (see the module comment). */
export class PageExportControl implements ExportControl {
  readonly #parts: ExportControlParts;
  readonly #state = observable<ExportRunState>({ kind: 'idle' });
  readonly get = this.#state.get;
  readonly subscribe = this.#state.subscribe;
  #run: Run | undefined;
  #jobs = 0;
  /** The staged files handed to the browser as downloads, which it may still be reading. */
  #downloaded: string[] = [];

  constructor(parts: ExportControlParts) {
    this.#parts = parts;
  }

  async start(session: RemoteProjectSession, start: ExportStart): Promise<DomainResult<string>> {
    if (this.#run !== undefined) {
      return fail(
        refusal(
          'busy',
          this.#state.get().kind === 'held'
            ? 'An export is waiting on a file it could not deliver; retry it, deliver it elsewhere, or cancel it first.'
            : 'An export is running; wait for it, or cancel it.',
        ),
      );
    }
    const writable = await this.#writable(start.destination);
    if (!writable.ok) return writable;
    const prepared = this.#prepared(session, start);
    if (!prepared.ok) return prepared;
    const roomy = await this.#roomFor(prepared.value);
    if (!roomy.ok) return roomy;
    const { snapshot, target, jobs } = prepared.value;
    const origin = await exportOrigin(snapshot, start.settings, target, this.#parts.digest);
    // Made only now, after the last await before it begins, so a second start
    // asked for meanwhile cannot run beside this one.
    if (this.#run !== undefined)
      return fail(refusal('busy', 'An export is running; wait for it, or cancel it.'));
    await this.#forgetDownloads();
    const run = this.#begin(session, start.settings, { jobs, origin });
    await this.#runJobs(run);
    return succeed(this.#settle(run));
  }

  cancel(): boolean {
    const run = this.#run;
    if (run === undefined) return false;
    run.cancel.abort(refusal('cancelled', 'The export was cancelled.'));
    run.asking?.answer(undefined);
    if (this.#state.get().kind === 'held') {
      void this.#giveUp(run);
    }
    return true;
  }

  answerCollision(reply: CollisionReply | undefined): boolean {
    const asking = this.#run?.asking;
    if (asking === undefined) return false;
    asking.answer(reply);
    return true;
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

  /**
   * Whether `destination` may be written, asked of the person where the
   * browser needs their leave: before anything renders, or a held file is
   * delivered again, since the delivery itself may only check.
   */
  async #writable(destination: ExportDestinationChoice): Promise<DomainResult<void>> {
    let handle: FileSystemHandle;
    switch (destination.kind) {
      case 'download':
        return succeed(undefined);
      case 'file':
      case 'folder':
        handle = destination.handle;
        break;
      case 'trusted-folder': {
        const kept = await this.#parts.trusted?.find(destination.key);
        if (kept === undefined) {
          return fail(
            refusal(
              'trusted-folder-missing',
              'That trusted folder is no longer kept; choose it again, or another destination.',
            ),
          );
        }
        handle = kept.folder;
        break;
      }
    }
    if (await this.#parts.allowWriting(handle)) return succeed(undefined);
    return fail(
      refusal(
        'permission-refused',
        `AudioGubbins was not given leave to write to ${quoted(handle.name)}, so nothing was written there.`,
      ),
    );
  }

  /** Every file `start` makes, ready to stage, or every reason it cannot start. */
  #prepared(session: RemoteProjectSession, start: ExportStart): DomainResult<Prepared> {
    const { assets, codecs } = this.#parts;
    const asset = assets.find(assetEntryId(start.asset));
    if (asset === undefined) {
      const unopened = assets.get().unopened.get(assetEntryId(start.asset));
      return fail(
        refusal(
          'asset-unopened',
          unopened?.reason ?? 'That asset is not in the project open here.',
        ),
      );
    }
    const { settings, destination } = start;
    const snapshot = session.getSnapshot();
    return flatMapResult(exportContextOf(asset, snapshot.model.state), (context) =>
      flatMapResult(planExport(settings, context, this.#parts.clock()), (files) => {
        const [first] = files;
        if (first === undefined) return fail(refusal('nothing', 'The export makes no file.'));
        if (files.length > 1 && destination.kind === 'file') {
          return fail(
            refusal(
              'one-file-destination',
              `The export makes ${counted(files.length, 'file', 'files')}, and a save dialog gives one; choose a folder for them.`,
            ),
          );
        }
        const capability = codecs.capability(first.target.codec, 'write');
        if (capability.kind === 'unavailable') {
          const instead = capability.alternatives.map(codecName);
          return fail(
            refusal(
              'codec-unavailable',
              instead.length === 0
                ? capability.reason
                : `${capability.reason} ${instead.join(', ')} can be exported here instead.`,
            ),
          );
        }
        const kept = snapshot.model.state.sources.get(start.asset)?.provenance?.metadata;
        return mapResult(
          combine(files.map((file) => this.#jobOf(asset, file, settings, kept, destination))),
          (jobs) => ({ jobs, snapshot, target: first.target }),
        );
      }),
    );
  }

  /** One file's parts: its audio, its metadata and its staged size at most. */
  #jobOf(
    asset: EditorAsset,
    file: PlannedFile,
    settings: ExportSettings,
    kept: KeptMetadata | undefined,
    destination: ExportDestinationChoice,
  ): DomainResult<JobParts> {
    const regionId = file.span.region?.id;
    const region =
      regionId === undefined ? undefined : this.#parts.assets.find(regionEntryId(regionId));
    if (regionId !== undefined && region === undefined) {
      const unopened = this.#parts.assets.get().unopened.get(regionEntryId(regionId));
      return fail(
        refusal(
          'region-unopened',
          unopened?.reason ??
            `The region ${quoted(file.span.region?.name ?? '')} cannot be heard yet.`,
        ),
      );
    }
    return mapResult(fileMetadata(file, settings, { asset, region, kept }), (metadata) => ({
      file,
      source: (region ?? asset).describe(),
      metadata,
      bound: stagedSizeBound(settings, file.render.range.length, file.render.layout, metadata),
      destination,
      staged: undefined,
    }));
  }

  /**
   * Whether the storage has room for every file of the batch at its largest:
   * a delivery refused keeps its file staged beside the next, so the batch's
   * files may all be held at once. Allowed where the estimate gives nothing.
   */
  async #roomFor(prepared: { readonly jobs: readonly JobParts[] }): Promise<DomainResult<void>> {
    const needed = prepared.jobs.reduce((sum, job) => sum + job.bound, 0);
    const free = await this.#parts.room();
    if (free === undefined || needed <= free) return succeed(undefined);
    return fail(
      refusal(
        'no-room',
        `The export needs up to ${describeBytes(needed)} of storage while it is made, and ${describeBytes(free)} is free, so nothing was rendered. Make room in Storage, or export less at once.`,
        { needed, free },
      ),
    );
  }

  /** The batch of `prepared`, running. */
  #begin(
    session: RemoteProjectSession,
    settings: ExportSettings,
    prepared: { readonly jobs: readonly JobParts[]; readonly origin: ExportOrigin },
  ): Run {
    const jobs = new Map<string, JobParts>();
    const planned: ExportJob[] = [];
    for (const job of prepared.jobs) {
      this.#jobs += 1;
      const id = `export-${String(this.#jobs)}`;
      jobs.set(id, job);
      planned.push(plannedExport(id, job.file.render.range.length));
    }
    const run: Run = {
      session,
      settings,
      origin: prepared.origin,
      jobs,
      files: new Map([...jobs].map(([id, job]) => [id, job.file])),
      names: new Map(),
      batch: exportBatch(planned),
      cancel: new AbortController(),
      asking: undefined,
    };
    this.#run = run;
    this.#publish(run);
    return run;
  }

  /** Runs every job of the batch in turn, until each has settled or the batch is cancelled. */
  async #runJobs(run: Run): Promise<void> {
    for (
      let next = nextJobToStart(run.batch);
      next !== undefined;
      next = nextJobToStart(run.batch)
    ) {
      if (run.cancel.signal.aborted) break;
      const parts = run.jobs.get(next.id);
      if (parts === undefined) break;
      await this.#runJob(run, next.id, parts);
    }
    if (run.cancel.signal.aborted) await this.#giveUp(run);
  }

  /** Stages one job's file and delivers it. */
  async #runJob(run: Run, id: string, parts: JobParts): Promise<void> {
    const { signal } = run.cancel;
    this.#report(run, id, { kind: 'render-started' });
    const staged = await stageFile(
      { ...this.#parts.runner, codecs: this.#parts.codecs, exports: this.#parts.exports },
      run.session,
      {
        file: parts.file,
        source: parts.source,
        encode: {
          target: parts.file.target,
          encoding: run.settings,
          sampleRate: parts.file.render.sampleRate,
          layout: parts.file.render.layout,
          metadata: parts.metadata,
          dither: { settings: run.settings.dither, key: parts.file.ditherKey },
        },
        origin: run.origin,
      },
      (framesRendered, bytesStaged) => {
        this.#report(run, id, { kind: 'progress', framesRendered, bytesStaged });
      },
      signal,
    );
    if (staged.ok) parts.staged = staged.value;
    if (signal.aborted) return;
    if (!staged.ok) {
      this.#report(run, id, { kind: 'failed', failure: staged.failures[0] });
      return;
    }
    this.#report(run, id, { kind: 'render-finished' });
    this.#report(run, id, { kind: 'staged', staged: staged.value.staged });
    await this.#deliver(run, id, parts);
  }

  /** Delivers a staged job's file to its destination, as its rules and the person decide. */
  async #deliver(run: Run, id: string, parts: JobParts): Promise<void> {
    const { staged } = parts;
    if (staged === undefined) return;
    const destination = this.#pageDestination(run, parts);
    this.#report(run, id, {
      kind: 'delivery-started',
      target: { kind: parts.destination.kind, name: safeFileName(parts.file.name) },
    });
    let answer: DomainResult<DeliveryAnswer>;
    try {
      answer = await this.#parts.exports.deliver(
        run.session,
        staged.token,
        staged.encoder,
        destination,
        run.cancel.signal,
      );
    } catch (error) {
      // A delivery called off rejects with why; the batch is given up after.
      if (run.cancel.signal.aborted) return;
      throw error;
    }
    if (!answer.ok) {
      this.#report(run, id, { kind: 'failed', failure: answer.failures[0] });
      return;
    }
    const delivered = answer.value;
    switch (delivered.kind) {
      case 'refused':
        run.batch = { ...run.batch, remembered: delivered.remembered };
        this.#report(run, id, { kind: 'delivery-refused', failure: delivered.failure });
        return;
      case 'download':
        this.#parts.download(delivered.file, safeFileName(parts.file.name));
        // The browser reads the download from the staging after this returns,
        // so it is given up only when the next export begins, or at start.
        this.#downloaded.push(staged.token);
        parts.staged = undefined;
        this.#delivered(run, id, staged, safeFileName(parts.file.name));
        return;
      case 'delivered':
        run.batch = { ...run.batch, remembered: delivered.remembered };
        parts.staged = undefined;
        this.#delivered(run, id, staged, delivered.name);
        return;
    }
  }

  /** Reports a whole file delivered, under the name it was written as. */
  #delivered(run: Run, id: string, staged: StagedRun, name: string): void {
    run.names.set(id, name);
    this.#report(run, id, { kind: 'delivery-progress', bytesDelivered: staged.staged.bytes });
    this.#report(run, id, { kind: 'delivered' });
  }

  /** The destination a job's file is delivered to, as the storage client takes it. */
  #pageDestination(run: Run, parts: JobParts): PageDestination {
    const { destination, file } = parts;
    const prompt = (name: string, signal?: AbortSignal): Promise<CollisionReply | undefined> =>
      this.#ask(run, name, signal);
    switch (destination.kind) {
      case 'file':
        return { kind: 'file', handle: destination.handle };
      case 'download':
        return {
          kind: 'download',
          name: safeFileName(file.name),
          mediaType: MEDIA_TYPES[file.target.container],
        };
      case 'folder':
        return {
          kind: 'folder',
          handle: destination.handle,
          wanted: file.name,
          policy: destination.policy,
          remembered: run.batch.remembered,
          prompt,
        };
      case 'trusted-folder': {
        const folders = this.#parts.trusted;
        if (folders === undefined) {
          // Refused before the batch started, so a folder kept trusted has its store.
          throw new Error('A trusted folder was chosen where none can be kept.');
        }
        return {
          kind: 'trusted-folder',
          folders,
          key: destination.key,
          wanted: file.name,
          policy: destination.policy,
          remembered: run.batch.remembered,
          prompt,
        };
      }
    }
  }

  /** Asks the person about the taken name `name`, until they answer, dismiss it, or the batch is cancelled. */
  #ask(
    run: Run,
    name: string,
    signal: AbortSignal | undefined,
  ): Promise<CollisionReply | undefined> {
    return new Promise((resolve) => {
      const answer = (reply: CollisionReply | undefined): void => {
        signal?.removeEventListener('abort', dismissed);
        run.asking = undefined;
        this.#publish(run);
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
      run.asking = { name, answer };
      this.#publish(run);
    });
  }

  /** Delivers a held job's file again, to where it was refused or to `elsewhere`. */
  async #redeliver(
    session: RemoteProjectSession,
    id: string,
    elsewhere: ExportDestinationChoice | undefined,
  ): Promise<DomainResult<string>> {
    const run = this.#run;
    if (run === undefined || this.#state.get().kind !== 'held') {
      return fail(refusal('not-held', 'No export is waiting on a file it could not deliver.'));
    }
    if (session.project !== run.session.project) {
      return fail(
        refusal(
          'other-project',
          'That export was made from another project; open it to deliver the file.',
        ),
      );
    }
    const parts = run.jobs.get(id);
    const job = run.batch.jobs.find((one) => one.id === id);
    if (parts?.staged === undefined || job?.state.kind !== 'staged') {
      return fail(refusal('not-waiting', 'That file is not waiting to be delivered.'));
    }
    // Running from here, so a second retry asked for while this one asks
    // for leave finds the export no longer held.
    this.#publish(run);
    const writable = await this.#writable(elsewhere ?? parts.destination);
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
  async #giveUp(run: Run): Promise<void> {
    run.batch = cancelExportBatch(run.batch);
    const tokens = [...run.jobs.values()].flatMap((job) =>
      job.staged === undefined ? [] : [job.staged.token],
    );
    for (const job of run.jobs.values()) job.staged = undefined;
    // One at a time: each is a call to the storage worker, which serves them in turn anyway.
    for (const token of tokens) await this.#parts.exports.discard(token);
    if (this.#run === run) this.#settle(run);
  }

  /** The batch's state once every job has settled: held where a file waits, else ended. */
  #settle(run: Run): string {
    const waiting = run.batch.jobs.some((job) => job.state.kind === 'staged');
    if (waiting && !run.cancel.signal.aborted) {
      this.#state.set({ kind: 'held', batch: run.batch, files: run.files });
      return heldSentence(run.batch, run.files);
    }
    const said = endedSentence(run.batch, run.names);
    if (this.#run === run) this.#run = undefined;
    this.#state.set({ kind: 'ended', batch: run.batch, files: run.files, said });
    return said;
  }

  /** Moves a job by `event`; a step its state machine refuses fails the job, as a defect here. */
  #report(run: Run, id: string, event: ExportJobEvent): void {
    const next = nextExportBatch(run.batch, id, event);
    if (next.ok) run.batch = next.value;
    else {
      const failed = nextExportBatch(run.batch, id, { kind: 'failed', failure: next.failures[0] });
      if (failed.ok) run.batch = failed.value;
    }
    this.#publish(run);
  }

  #publish(run: Run): void {
    if (this.#run !== run || this.#state.get().kind === 'ended') return;
    this.#state.set({
      kind: 'running',
      batch: run.batch,
      files: run.files,
      asking: run.asking?.name,
    });
  }
}
