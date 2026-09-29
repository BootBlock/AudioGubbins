/**
 * One source's peaks on the page: its pyramid as it fills, its status, and the
 * requests its views make of the worker.
 *
 * The host shares one job among every view of a source identity and revision
 * (`peak-host.ts`). The job reads the kept cache first and sends it to the
 * worker, which checks it; the answer is either the cache, adopted whole, or
 * runs of buckets as the worker makes them, then the bytes to keep. A request
 * for a window or a zero crossing is answered by number, and one the view
 * abandons is cancelled in the worker too, so it reads no more of it; a window
 * already fetched is answered again from the few kept, so a view that redraws
 * in place asks the worker nothing (the packet's "without rebuilding peaks from
 * raw PCM per frame").
 */

import { Cancelled, cancellationReason, type CancellationSignal } from '@audiogubbins/audio-engine';

import { decodePeaks } from './peak-codec.js';
import { peakGeometry } from './peak-geometry.js';
import {
  FromPeakWorkerKind,
  ToPeakWorkerKind,
  type FrameRange,
  type FromPeakWorker,
  type ToPeakWorker,
} from './peak-messages.js';
import { WaveformPeakPyramid } from './peak-pyramid.js';
import type { BucketWindow, SampleWindow } from './peak-columns.js';
import type { PeakSubject } from './peak-subject.js';

/** Where a source's peaks are. */
export type PeakStatus =
  | { readonly kind: 'reading-cache' }
  | { readonly kind: 'generating'; readonly progress: number }
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly reason: string };

/** What a job tells whoever keeps a record of it. */
export type PeakEvent =
  | { readonly kind: 'cache-refused'; readonly identity: string; readonly reason: string }
  | { readonly kind: 'cache-unreadable'; readonly identity: string; readonly reason: string }
  | { readonly kind: 'cache-unwritten'; readonly identity: string; readonly reason: string }
  | { readonly kind: 'failed'; readonly identity: string; readonly reason: string };

/** How many windows of each kind a job keeps, for a second view of the source. */
const KEPT_WINDOWS = 2;

/** The frames a window holds. */
interface HeldWindow {
  readonly start: number;
  readonly frames: number;
}

function holds(held: HeldWindow, range: FrameRange): boolean {
  return held.start <= range.start && held.start + held.frames >= range.end;
}

interface Pending<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One source's peaks on the page. */
export class PeakJob {
  readonly subject: PeakSubject;
  readonly #name: string;
  readonly #post: (message: ToPeakWorker) => void;
  readonly #report: (event: PeakEvent) => void;
  readonly #keep: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  readonly #listeners = new Set<() => void>();
  #pyramid: WaveformPeakPyramid;
  #status: PeakStatus = { kind: 'reading-cache' };
  #focus: FrameRange | undefined;
  #requests = 0;
  readonly #samples = new Map<number, Pending<SampleWindow>>();
  readonly #buckets = new Map<number, Pending<BucketWindow>>();
  readonly #crossings = new Map<number, Pending<number | undefined>>();
  #sampleWindows: (SampleWindow & HeldWindow)[] = [];
  #bucketWindows: BucketWindow[] = [];
  #closed = false;
  /** Whether the worker was told of the job, and must be told when it closes. */
  #started = false;
  /** Requests made before the job was opened in the worker, sent after it. */
  #queued: ToPeakWorker[] = [];

  constructor(options: {
    readonly name: string;
    readonly subject: PeakSubject;
    readonly post: (message: ToPeakWorker) => void;
    /** Keeps the bytes of a finished pyramid, for the next time the source is opened. */
    readonly keep: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
    readonly report: (event: PeakEvent) => void;
  }) {
    this.#keep = options.keep;
    this.#name = options.name;
    this.subject = options.subject;
    this.#post = options.post;
    this.#report = options.report;
    this.#pyramid = new WaveformPeakPyramid(
      peakGeometry(options.subject.frames, options.subject.channels),
    );
  }

  get pyramid(): WaveformPeakPyramid {
    return this.#pyramid;
  }

  get status(): PeakStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /** Starts the job with the kept cache's bytes, if any were read. */
  start(cached: Uint8Array<ArrayBuffer> | undefined): void {
    if (this.#closed) return;
    this.#started = true;
    this.#status = { kind: 'generating', progress: 0 };
    this.#post({
      kind: ToPeakWorkerKind.Open,
      job: this.#name,
      identity: this.subject.identity,
      revision: this.subject.revision,
      channels: this.subject.channels,
      description: this.subject.describe(),
      cached,
      focus: this.#focus,
    });
    for (const request of this.#queued) this.#post(request);
    this.#queued = [];
    this.#changed();
  }

  /** Summarises the chunks around `range` first. */
  focus(range: FrameRange): void {
    this.#focus = range;
    if (this.#status.kind === 'generating')
      this.#post({ kind: ToPeakWorkerKind.Focus, job: this.#name, range });
  }

  /** The samples of `range`, from a window kept or from the worker. */
  samples(range: FrameRange, signal?: CancellationSignal): Promise<SampleWindow> {
    const kept = this.#sampleWindows.find((held) => holds(held, range));
    if (kept !== undefined) return Promise.resolve(kept);
    return this.#ask(this.#samples, signal, (request) => ({
      kind: ToPeakWorkerKind.Samples,
      job: this.#name,
      request,
      range,
    }));
  }

  /** The detail buckets of `range`, from a window kept or from the worker. */
  buckets(range: FrameRange, signal?: CancellationSignal): Promise<BucketWindow> {
    const kept = this.#bucketWindows.find((held) => holds(held, range));
    if (kept !== undefined) return Promise.resolve(kept);
    return this.#ask(this.#buckets, signal, (request) => ({
      kind: ToPeakWorkerKind.Buckets,
      job: this.#name,
      request,
      range,
    }));
  }

  /** The zero crossing nearest `position`, asked of the worker. */
  nearestZeroCrossing(
    position: number,
    within: number,
    channels: readonly number[],
    signal?: CancellationSignal,
  ): Promise<number | undefined> {
    return this.#ask(this.#crossings, signal, (request) => ({
      kind: ToPeakWorkerKind.ZeroCrossing,
      job: this.#name,
      request,
      position,
      within,
      channels,
    }));
  }

  #ask<T>(
    pending: Map<number, Pending<T>>,
    signal: CancellationSignal | undefined,
    message: (request: number) => ToPeakWorker,
  ): Promise<T> {
    if (signal?.aborted === true) return Promise.reject(cancellationReason(signal));
    if (this.#closed) return Promise.reject(new Cancelled('The peaks were closed.'));
    if (this.#status.kind === 'failed') return Promise.reject(new Error(this.#status.reason));
    this.#requests += 1;
    const request = this.#requests;
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        pending.delete(request);
        this.#send({ kind: ToPeakWorkerKind.Cancel, job: this.#name, request });
        if (signal !== undefined) reject(cancellationReason(signal));
      };
      signal?.addEventListener('abort', abort, { once: true });
      pending.set(request, {
        resolve: (value) => {
          signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
      });
      this.#send(message(request));
    });
  }

  /**
   * Sends a request, or holds it until the worker has been told of the job; a
   * cancel of one still held removes it instead.
   */
  #send(message: ToPeakWorker): void {
    if (this.#started) {
      this.#post(message);
    } else if (message.kind === ToPeakWorkerKind.Cancel) {
      this.#queued = this.#queued.filter(
        (each) => !('request' in each) || each.request !== message.request,
      );
    } else {
      this.#queued.push(message);
    }
  }

  /** Handles a message from the worker for this job. */
  receive(message: FromPeakWorker): void {
    if (this.#closed) return;
    switch (message.kind) {
      case FromPeakWorkerKind.Adopted:
        this.#adopt(message.bytes);
        break;
      case FromPeakWorkerKind.Runs:
        for (const run of message.runs) this.#pyramid.apply(run);
        this.#status = { kind: 'generating', progress: this.#pyramid.progress };
        this.#changed();
        break;
      case FromPeakWorkerKind.Complete:
        this.#complete(message.bytes, message.refusedCache);
        break;
      case FromPeakWorkerKind.Samples: {
        const held = {
          start: message.start,
          frames: message.channels[0]?.length ?? 0,
          channels: message.channels,
        };
        this.#sampleWindows = [held, ...this.#sampleWindows].slice(0, KEPT_WINDOWS);
        this.#samples.get(message.request)?.resolve(held);
        this.#samples.delete(message.request);
        break;
      }
      case FromPeakWorkerKind.Buckets: {
        const { start, frames, bucketFrames, channels } = message;
        const held: BucketWindow = { start, frames, bucketFrames, channels };
        this.#bucketWindows = [held, ...this.#bucketWindows].slice(0, KEPT_WINDOWS);
        this.#buckets.get(message.request)?.resolve(held);
        this.#buckets.delete(message.request);
        break;
      }
      case FromPeakWorkerKind.ZeroCrossing:
        this.#crossings.get(message.request)?.resolve(message.position);
        this.#crossings.delete(message.request);
        break;
      case FromPeakWorkerKind.Failed:
        this.fail(message.reason);
        break;
    }
  }

  #adopt(bytes: Uint8Array<ArrayBuffer>): void {
    const decoded = decodePeaks(bytes, { ...this.subject }, false);
    if (!decoded.ok) {
      this.fail(`The kept peaks could not be read: ${decoded.failures[0].summary}`);
      return;
    }
    this.#pyramid = new WaveformPeakPyramid(decoded.value.geometry, decoded.value.levels);
    this.#status = { kind: 'complete' };
    this.#changed();
  }

  #complete(bytes: Uint8Array<ArrayBuffer>, refusedCache: string | undefined): void {
    if (refusedCache !== undefined) {
      this.#report({
        kind: 'cache-refused',
        identity: this.subject.identity,
        reason: refusedCache,
      });
    }
    this.#status = { kind: 'complete' };
    this.#changed();
    this.#keep(bytes).catch((error: unknown) => {
      this.#report({
        kind: 'cache-unwritten',
        identity: this.subject.identity,
        reason: messageOf(error),
      });
    });
  }

  /** Ends the job with `reason`, refusing every request still waiting. */
  fail(reason: string): void {
    if (this.#closed || this.#status.kind === 'failed') return;
    this.#status = { kind: 'failed', reason };
    this.#rejectAll(new Error(reason));
    this.#report({ kind: 'failed', identity: this.subject.identity, reason });
    this.#changed();
  }

  #rejectAll(error: Error): void {
    for (const pending of [
      ...this.#samples.values(),
      ...this.#buckets.values(),
      ...this.#crossings.values(),
    ])
      pending.reject(error);
    this.#samples.clear();
    this.#buckets.clear();
    this.#crossings.clear();
  }

  /** Closes the job: the worker releases the source, and every request waiting is cancelled. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#started) this.#post({ kind: ToPeakWorkerKind.Close, job: this.#name });
    this.#rejectAll(new Cancelled('The peaks were closed.'));
    this.#queued = [];
    this.#sampleWindows = [];
    this.#bucketWindows = [];
    this.#listeners.clear();
  }
}
