/**
 * What the peak worker does, apart from the scope it runs in.
 *
 * Each job is one source: the worker makes it from its description, checks a
 * cache the page sent, and otherwise summarises it a chunk at a time, nearest
 * first to the range a view last showed, sending each finished run as it goes
 * (ADR-0043), in batches at most once a display frame (`run-batches.ts`). It
 * gives the host a turn between chunks, so a view's request, a new focus, a
 * cancel or a close is read within one chunk's work; requests are answered one
 * at a time by `PeakRequests`. Once every chunk is in, it encodes the pyramid
 * for the page to keep, drops its own copy, and keeps the source for the
 * requests that still come. One pyramid is built at a time: the job focused
 * last goes first, which bounds the work in flight to one chunk (G4).
 *
 * Given a port to the preview worker, it reads a racked sound's processed
 * streams from their renders (ADR-0061), so a chunk read out of order never
 * starts a chain again from the stream's start.
 */

import {
  PreviewClient,
  blockView,
  describedSource,
  allocateBlock,
  previewPort,
  ProcessedStart,
  type AudioFrameBlock,
  type CanonicalDsp,
  type ChainProcessing,
  type PcmSource,
  type ToPreview,
} from '@audiogubbins/audio-engine';
import { discreteLayout, sampleCount, type DomainResult } from '@audiogubbins/domain';

import { PeakBuilder } from './peak-builder.js';
import { decodePeaks, encodePeaks } from './peak-codec.js';
import { CHUNK_FRAMES, chunkCount, peakGeometry, type PeakGeometry } from './peak-geometry.js';
import {
  FromPeakWorkerKind,
  ToPeakWorkerKind,
  peakTransferables,
  type FrameRange,
  type FromPeakWorker,
  type ToPeakWorker,
} from './peak-messages.js';
import { readToPeakWorker } from './peak-message-reading.js';
import { PeakRequests } from './peak-requests.js';
import { RunBatches } from './run-batches.js';

/** What the worker's scope gives the core. */
export interface PeakWorkerHost {
  readonly post: (message: FromPeakWorker, transfer: readonly ArrayBuffer[]) => void;
  /** Resolves after the events already queued for the worker have run. */
  readonly yieldToHost: () => Promise<void>;
  readonly dsp: CanonicalDsp;
  /** How the chains an edited source's plan names are run: the effect rack's. */
  readonly processing: ChainProcessing;
  /** Reports a message that could not be read, which the page sent wrongly. */
  readonly reportFault: (error: Error) => void;
  /** Milliseconds from any fixed origin, which spaces the batches of runs. */
  readonly now: () => number;
}

/** One source's job. */
interface Job {
  readonly name: string;
  readonly identity: string;
  readonly revision: string;
  readonly source: PcmSource;
  readonly geometry: PeakGeometry;
  /** What is still being built, until every chunk is in. */
  building:
    | {
        readonly builder: PeakBuilder;
        readonly block: AudioFrameBlock;
        readonly done: Uint8Array;
        remaining: number;
        /** The next chunks to try either side of the focus. */
        left: number;
        right: number;
        readonly refusedCache: string | undefined;
      }
    | undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The peak worker's work, given its scope's parts. */
export class PeakWorkerCore {
  readonly #host: PeakWorkerHost;
  readonly #jobs = new Map<string, Job>();
  /** Jobs still building, the one focused last first. */
  #order: string[] = [];
  #pumping = false;
  readonly #requests: PeakRequests;
  readonly #batches: RunBatches;
  /** The preview worker's renders, once the page has given the port to them. */
  #previews: PreviewClient | undefined;

  constructor(host: PeakWorkerHost) {
    this.#host = host;
    this.#requests = new PeakRequests({
      source: (job) => this.#jobs.get(job)?.source,
      post: (message) => {
        this.#post(message);
      },
      yieldToHost: host.yieldToHost,
      fail: (job, reason) => {
        this.#fail(job, reason);
      },
    });
    this.#batches = new RunBatches((job, runs) => {
      this.#post({ kind: FromPeakWorkerKind.Runs, job, runs });
    }, host.now);
  }

  /** Handles one message from the page. */
  receive(value: unknown): void {
    const read = readToPeakWorker(value);
    if (!read.ok) {
      this.#host.reportFault(new Error(read.failures[0].summary));
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case ToPeakWorkerKind.Open:
        this.#open(message);
        break;
      case ToPeakWorkerKind.Focus:
        this.#focus(message.job, message.range);
        break;
      case ToPeakWorkerKind.Samples:
      case ToPeakWorkerKind.Buckets:
      case ToPeakWorkerKind.ZeroCrossing:
        if (this.#jobs.has(message.job)) this.#requests.add(message);
        break;
      case ToPeakWorkerKind.Cancel:
        this.#requests.cancel(message.job, message.request);
        break;
      case ToPeakWorkerKind.Close:
        this.#close(message.job);
        break;
      case ToPeakWorkerKind.Previews:
        this.#previews = new PreviewClient(previewPort<ToPreview>(message.port));
        break;
    }
  }

  /**
   * A message from the page could not be deserialised, so which job it was for
   * is unknown: every job fails with the reason, rather than one leaving the
   * page waiting on an answer for ever.
   */
  messageFailed(): void {
    for (const name of [...this.#jobs.keys()]) {
      this.#fail(name, 'A message to the peak worker could not be read.');
    }
  }

  #post(message: FromPeakWorker): void {
    this.#host.post(message, peakTransferables(message));
  }

  #fail(job: string, reason: string): void {
    this.#close(job);
    this.#post({ kind: FromPeakWorkerKind.Failed, job, reason });
  }

  #open(message: Extract<ToPeakWorker, { kind: typeof ToPeakWorkerKind.Open }>): void {
    if (this.#jobs.has(message.job)) this.#close(message.job);
    const layout = discreteLayout(message.channels);
    const source = layout.ok
      ? describedSource(message.description, layout.value, this.#host.dsp, {
          processing: this.#host.processing,
          quality: message.quality.settings,
          start: ProcessedStart.Canonical,
          ...(this.#previews === undefined ? {} : { cached: this.#previews }),
        })
      : layout;
    if (!source.ok) {
      this.#post({
        kind: FromPeakWorkerKind.Failed,
        job: message.job,
        reason: source.failures[0].summary,
      });
      return;
    }
    const job: Job = {
      name: message.job,
      identity: message.identity,
      revision: message.revision,
      source: source.value,
      geometry: peakGeometry(source.value.length ?? 0, message.channels),
      building: undefined,
    };
    this.#jobs.set(message.job, job);
    const cached = message.cached === undefined ? undefined : this.#checked(job, message.cached);
    if (cached?.ok === true && message.cached !== undefined) {
      this.#post({ kind: FromPeakWorkerKind.Adopted, job: message.job, bytes: message.cached });
      return;
    }
    this.#build(job, cached?.ok === false ? cached.failures[0].summary : undefined, message.focus);
  }

  /** The cache the page sent, checked against the job's source. */
  #checked(job: Job, bytes: Uint8Array<ArrayBuffer>): DomainResult<unknown> {
    return decodePeaks(
      bytes,
      {
        identity: job.identity,
        revision: job.revision,
        sampleRate: job.source.sampleRate,
        frames: job.geometry.frames,
        channels: job.geometry.channels,
      },
      true,
    );
  }

  /** Starts summarising a job's source, around `focus` first. */
  #build(job: Job, refusedCache: string | undefined, focus: FrameRange | undefined): void {
    const chunks = chunkCount(job.geometry);
    const builder = new PeakBuilder(job.geometry);
    job.building = {
      builder,
      block: allocateBlock(job.source.layout, job.source.sampleRate, CHUNK_FRAMES),
      done: new Uint8Array(chunks),
      remaining: chunks,
      left: -1,
      right: 0,
      refusedCache,
    };
    if (chunks === 0) {
      this.#finish(job, builder, refusedCache);
      return;
    }
    this.#order = [job.name, ...this.#order.filter((name) => name !== job.name)];
    if (focus !== undefined) this.#focus(job.name, focus);
    void this.#pump();
  }

  #focus(name: string, range: FrameRange): void {
    const building = this.#jobs.get(name)?.building;
    if (building === undefined) return;
    const middle = Math.floor((range.start + range.end) / 2 / CHUNK_FRAMES);
    building.right = Math.min(Math.max(0, middle), building.done.length);
    building.left = building.right - 1;
    this.#order = [name, ...this.#order.filter((each) => each !== name)];
  }

  /** The next chunk of a job to summarise: the nearer of the first not done either side of its focus. */
  #nextChunk(job: Job): number | undefined {
    const building = job.building;
    if (building === undefined || building.remaining === 0) return undefined;
    while (building.left >= 0 && building.done[building.left] === 1) building.left -= 1;
    while (building.right < building.done.length && building.done[building.right] === 1)
      building.right += 1;
    const middle = (building.left + building.right) / 2;
    const leftDistance = building.left >= 0 ? middle - building.left : Infinity;
    const rightDistance =
      building.right < building.done.length ? building.right - middle : Infinity;
    if (leftDistance === Infinity && rightDistance === Infinity) {
      // Every chunk between the cursors' ends is done, and some before the
      // focus's last move are not: start again from the first.
      building.left = -1;
      building.right = building.done.indexOf(0);
      return building.right < 0 ? undefined : building.right;
    }
    return rightDistance <= leftDistance ? building.right : building.left;
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      for (;;) {
        const job = this.#order
          .map((name) => this.#jobs.get(name))
          .find((one) => one?.building !== undefined);
        if (job === undefined) return;
        await this.#summariseNext(job);
        await this.#host.yieldToHost();
      }
    } finally {
      this.#pumping = false;
      this.#batches.flushAll();
    }
  }

  async #summariseNext(job: Job): Promise<void> {
    const building = job.building;
    const chunk = this.#nextChunk(job);
    if (building === undefined || chunk === undefined) return;
    const start = chunk * CHUNK_FRAMES;
    const frames = Math.min(CHUNK_FRAMES, job.geometry.frames - start);
    const position = sampleCount(start);
    try {
      if (!position.ok) throw new RangeError(position.failures[0].summary);
      const block = frames === CHUNK_FRAMES ? building.block : blockView(building.block, 0, frames);
      const read = await job.source.read(position.value, block);
      if (this.#jobs.get(job.name) !== job) return;
      building.done[chunk] = 1;
      building.remaining -= 1;
      this.#batches.add(job.name, building.builder.addChunk(chunk, block, read));
      if (building.remaining === 0) this.#finish(job, building.builder, building.refusedCache);
    } catch (error) {
      if (this.#jobs.get(job.name) === job)
        this.#fail(job.name, `The audio could not be read: ${messageOf(error)}`);
    }
  }

  #finish(job: Job, builder: PeakBuilder, refusedCache: string | undefined): void {
    const bytes = encodePeaks(builder.geometry, builder.levels, {
      identity: job.identity,
      revision: job.revision,
      sampleRate: job.source.sampleRate,
    });
    job.building = undefined;
    this.#order = this.#order.filter((name) => name !== job.name);
    this.#batches.flush(job.name);
    this.#post({ kind: FromPeakWorkerKind.Complete, job: job.name, bytes, refusedCache });
  }

  #close(name: string): void {
    const job = this.#jobs.get(name);
    if (job === undefined) return;
    this.#jobs.delete(name);
    this.#order = this.#order.filter((each) => each !== name);
    this.#requests.forget(name);
    this.#batches.drop(name);
    job.source.release();
  }
}
