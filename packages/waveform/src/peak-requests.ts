/**
 * The peak worker's answers to a view's requests: the samples or the detail
 * buckets of a window, and the zero crossing nearest a position.
 *
 * Requests are served one at a time in the order they came, between the chunks
 * the worker summarises, so what is in flight is one request's reads (G4). A
 * window is read a chunk at a time with a turn to the worker's host between
 * chunks, so a cancel the page sends for a window it has moved past is read
 * before the next chunk and the rest is never read; one still waiting is
 * dropped unread. A window is answered in the arrays it was read into, which
 * are transferred, not copied.
 */

import {
  Cancelled,
  allocateBlock,
  blockView,
  createCancellationSource,
  throwIfCancelled,
  type AudioFrameBlock,
  type CancellationSource,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import { sampleCount } from '@audiogubbins/domain';

import { summariseBucket } from './bucket-summary.js';
import { CHUNK_FRAMES, DETAIL_BUCKET_FRAMES, DetailKind, largestWindow } from './peak-geometry.js';
import {
  FromPeakWorkerKind,
  ToPeakWorkerKind,
  type FrameRange,
  type FromPeakWorker,
  type ToPeakWorker,
} from './peak-messages.js';
import { packedChannels, type PeakChannel } from './peak-pyramid.js';
import { nearestZeroCrossing } from './zero-crossings.js';

/** A request a view makes of a job's source. */
export type PeakRequest = Extract<
  ToPeakWorker,
  {
    kind:
      | typeof ToPeakWorkerKind.Samples
      | typeof ToPeakWorkerKind.Buckets
      | typeof ToPeakWorkerKind.ZeroCrossing;
  }
>;

/** What the requests are answered with: the worker's jobs' sources and its host. */
export interface RequestHost {
  /** The source of job `job`, or `undefined` once it is closed. */
  readonly source: (job: string) => PcmSource | undefined;
  readonly post: (message: FromPeakWorker) => void;
  readonly yieldToHost: () => Promise<void>;
  /** Ends job `job`, whose source could not be read, with `reason`. */
  readonly fail: (job: string, reason: string) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The frames of `range` a window of `kind` is answered with, within a source of `length`. */
function windowOf(
  range: FrameRange,
  length: number,
  kind: typeof DetailKind.Samples | typeof DetailKind.Buckets,
): FrameRange {
  const start = Math.min(range.start, length);
  return { start, end: Math.min(range.end, length, start + largestWindow(kind)) };
}

/** Serves requests one at a time. */
export class PeakRequests {
  readonly #host: RequestHost;
  #waiting: PeakRequest[] = [];
  #serving: { readonly request: PeakRequest; readonly cancel: CancellationSource } | undefined;

  constructor(host: RequestHost) {
    this.#host = host;
  }

  /** Queues a request, to be answered after those before it. */
  add(request: PeakRequest): void {
    this.#waiting.push(request);
    void this.#serve();
  }

  /** Drops request `request` of job `job`, or stops it where it is being read. */
  cancel(job: string, request: number): void {
    this.#waiting = this.#waiting.filter((each) => each.job !== job || each.request !== request);
    const serving = this.#serving;
    if (serving?.request.job === job && serving.request.request === request) {
      serving.cancel.cancel(new Cancelled('The page no longer waits on this request.'));
    }
  }

  /** Drops every request of job `job`, which has closed. */
  forget(job: string): void {
    this.#waiting = this.#waiting.filter((each) => each.job !== job);
    if (this.#serving?.request.job === job) this.#serving.cancel.cancel(new Cancelled());
  }

  async #serve(): Promise<void> {
    if (this.#serving !== undefined) return;
    for (let next = this.#waiting.shift(); next !== undefined; next = this.#waiting.shift()) {
      const cancel = createCancellationSource();
      this.#serving = { request: next, cancel };
      try {
        await this.#answer(next, cancel);
      } catch (error) {
        // A cancelled request is answered with nothing: the page stopped
        // waiting for it when it sent the cancel.
        if (!cancel.signal.aborted && this.#host.source(next.job) !== undefined) {
          this.#host.fail(next.job, `The audio could not be read: ${messageOf(error)}`);
        }
      } finally {
        this.#serving = undefined;
      }
    }
  }

  async #answer(request: PeakRequest, cancel: CancellationSource): Promise<void> {
    const source = this.#host.source(request.job);
    if (source === undefined) return;
    switch (request.kind) {
      case ToPeakWorkerKind.Samples: {
        const range = windowOf(request.range, source.length ?? 0, DetailKind.Samples);
        const channels = await this.#samples(source, range, cancel);
        this.#host.post({
          kind: FromPeakWorkerKind.Samples,
          job: request.job,
          request: request.request,
          start: range.start,
          channels,
        });
        return;
      }
      case ToPeakWorkerKind.Buckets: {
        const range = windowOf(request.range, source.length ?? 0, DetailKind.Buckets);
        const channels = await this.#buckets(source, range, cancel);
        this.#host.post({
          kind: FromPeakWorkerKind.Buckets,
          job: request.job,
          request: request.request,
          start: range.start,
          frames: range.end - range.start,
          bucketFrames: DETAIL_BUCKET_FRAMES,
          channels,
        });
        return;
      }
      case ToPeakWorkerKind.ZeroCrossing: {
        const count = source.layout.roles.length;
        const position = await nearestZeroCrossing(
          source,
          request.position,
          request.within,
          request.channels.filter((channel) => channel < count),
          cancel.signal,
        );
        this.#host.post({
          kind: FromPeakWorkerKind.ZeroCrossing,
          job: request.job,
          request: request.request,
          position,
        });
        return;
      }
    }
  }

  /**
   * Reads `range` of `source` a chunk at a time, each into the block `place`
   * gives for its offset and length, calling `each` with every chunk read, with
   * a turn to the host between chunks.
   */
  async #read(
    source: PcmSource,
    range: FrameRange,
    cancel: CancellationSource,
    place: (offset: number, frames: number) => AudioFrameBlock,
    each: (chunk: AudioFrameBlock, offset: number) => void,
  ): Promise<void> {
    for (let offset = 0; range.start + offset < range.end; offset += CHUNK_FRAMES) {
      const at = sampleCount(range.start + offset);
      if (!at.ok) throw new RangeError(at.failures[0].summary);
      const chunk = place(offset, Math.min(CHUNK_FRAMES, range.end - range.start - offset));
      await source.read(at.value, chunk, cancel.signal);
      each(chunk, offset);
      await this.#host.yieldToHost();
      throwIfCancelled(cancel.signal);
    }
  }

  async #samples(
    source: PcmSource,
    range: FrameRange,
    cancel: CancellationSource,
  ): Promise<readonly Float32Array[]> {
    const block = allocateBlock(source.layout, source.sampleRate, range.end - range.start);
    await this.#read(
      source,
      range,
      cancel,
      (offset, frames) => blockView(block, offset, frames),
      () => undefined,
    );
    return block.channels;
  }

  async #buckets(
    source: PcmSource,
    range: FrameRange,
    cancel: CancellationSource,
  ): Promise<readonly PeakChannel[]> {
    const frames = range.end - range.start;
    const channels = packedChannels(
      source.layout.roles.length,
      Math.ceil(frames / DETAIL_BUCKET_FRAMES),
    );
    const block = allocateBlock(source.layout, source.sampleRate, Math.min(CHUNK_FRAMES, frames));
    const place = (_offset: number, count: number): AudioFrameBlock => blockView(block, 0, count);
    await this.#read(source, range, cancel, place, (chunk, offset) => {
      chunk.channels.forEach((samples, channel) => {
        const into = channels[channel];
        if (into === undefined) return;
        for (let from = 0; from < chunk.frames; from += DETAIL_BUCKET_FRAMES) {
          const count = Math.min(DETAIL_BUCKET_FRAMES, chunk.frames - from);
          summariseBucket(samples, from, count, into, (offset + from) / DETAIL_BUCKET_FRAMES);
        }
      });
    });
    return channels;
  }
}
