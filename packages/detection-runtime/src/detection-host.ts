/**
 * The page's end of the detection worker: one worker, made with the first
 * detection asked for and kept for the rest, and the results it answered,
 * kept for the operation's life by what the target's audio is made from.
 *
 * A detection of a target whose audio, quality, range and assistants are all
 * as they were when it was last answered is answered from what was kept, and
 * the worker reads nothing (G4): the key is the subject's whole identity, the
 * canonical text of its plan and of the media that plan reads, never a short
 * fingerprint two versions could share. The worker's messages are read field
 * by field; one it cannot read, or the worker failing, fails every detection
 * waiting with the reason, never silently, and the next is given a new worker.
 */

import type {
  CancellationSignal,
  DetectorValues,
  EditRange,
  QualityMode,
} from '@audiogubbins/domain';
import { describedBuffers, type PcmDescription } from '@audiogubbins/audio-engine';

import { readFromDetectionWorker } from './detection-message-reading.js';
import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type ToDetectionWorker,
} from './detection-messages.js';
import type { DetectionResult } from './detection-result.js';

/** The page's end of a detection worker. */
export interface DetectionWorkerPort {
  post(message: ToDetectionWorker, transfer: readonly ArrayBuffer[]): void;
  /** Listens for the worker's messages, and for its failing, with the reason. */
  listen(onMessage: (value: unknown) => void, onFault: (reason: string) => void): void;
  terminate(): void;
}

/** What a detection is asked for. */
export interface DetectionSubject {
  /** What it analyses, an asset or a region, of which one detection runs at a time. */
  readonly target: string;
  /**
   * What the target's audio is made from, written out whole: two subjects of
   * one identity sound alike, so a result kept for one answers the other.
   */
  readonly identity: string;
  readonly channels: number;
  /** Its audio, described when a detection starts; arrays in memory are transferred. */
  readonly describe: () => PcmDescription;
  /**
   * The audio a recommended step learns its state from, where that is not the
   * audio analysed (`detection-run.ts`), with what it is made from, as
   * {@link identity} says for the audio analysed.
   */
  readonly learning?: {
    readonly identity: string;
    readonly channels: number;
    readonly describe: () => PcmDescription;
  };
  /** The quality an edited sound's chains run at: the final render's. */
  readonly quality: QualityMode;
  /** The frames of the target to read. */
  readonly range: EditRange;
  /** The keys of the assistants to run, in the order their reports are answered. */
  readonly assistants: readonly string[];
  /** What a person set of how their detectors judge, which changes what they find. */
  readonly detectors: DetectorValues;
}

/** How a detection ended. */
export type DetectionOutcome =
  | {
      readonly kind: 'done';
      readonly result: DetectionResult;
      /** Whether it was answered from a result kept, with nothing read. */
      readonly kept: boolean;
    }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'cancelled' };

/** What a caller watches a detection with. */
export interface DetectionWatch {
  /** Stops the detection, which then ends as cancelled. */
  readonly signal?: CancellationSignal;
  readonly onProgress?: (framesRead: number, framesTotal: number) => void;
}

/** A detection the worker is running or holds queued. */
interface Waiting {
  readonly key: string;
  readonly watch: DetectionWatch;
  readonly settle: (outcome: DetectionOutcome) => void;
  readonly stopWatching: () => void;
}

/**
 * The most results kept. A result is small, its findings and learned states,
 * but every edit makes a new identity, and the oldest are the least likely to
 * be asked for again: an undo far back analyses again rather than the page
 * holding every version it has seen.
 */
const KEPT_RESULTS = 64;

/** The key a result is kept under: everything that changes what a detection finds. */
function keyOf(subject: DetectionSubject): string {
  return [
    subject.identity,
    subject.learning?.identity ?? '',
    JSON.stringify(subject.quality.settings),
    String(subject.channels),
    String(subject.range.start),
    String(subject.range.end),
    subject.assistants.join(','),
    valuesKey(subject.detectors),
  ].join('\u0000');
}

/** `values` as text, the same however their keys were ordered. */
function valuesKey(values: DetectorValues): string {
  const sorted = <T>(record: Readonly<Record<string, T>>): [string, T][] =>
    Object.entries(record).toSorted(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
  return JSON.stringify(sorted(values).map(([detector, set]) => [detector, sorted(set)]));
}

/** Detections on one worker, and the results it answered. */
export class DetectionHost {
  readonly #createWorker: () => DetectionWorkerPort;
  readonly #kept = new Map<string, DetectionResult>();
  readonly #waiting = new Map<string, Waiting>();
  #worker: DetectionWorkerPort | undefined;
  #jobs = 0;

  constructor(options: { readonly createWorker: () => DetectionWorkerPort }) {
    this.#createWorker = options.createWorker;
  }

  /**
   * Finds what `subject`'s assistants find and recommend. A detection of the
   * same target still running ends as cancelled, as the worker cancels it.
   */
  detect(subject: DetectionSubject, watch: DetectionWatch = {}): Promise<DetectionOutcome> {
    const key = keyOf(subject);
    const kept = this.#kept.get(key);
    if (kept !== undefined) {
      // Taken out and put back, so the order of the map is the order of use.
      this.#kept.delete(key);
      this.#kept.set(key, kept);
      return Promise.resolve({ kind: 'done', result: kept, kept: true });
    }
    if (watch.signal?.aborted === true) return Promise.resolve({ kind: 'cancelled' });
    this.#jobs += 1;
    const job = `detection-${String(this.#jobs)}`;
    return new Promise((resolve) => {
      const stop = (): void => {
        this.#workerPort().post({ kind: ToDetectionWorkerKind.Cancel, job }, []);
        this.#settle(job, { kind: 'cancelled' });
      };
      watch.signal?.addEventListener('abort', stop, { once: true });
      this.#waiting.set(job, {
        key,
        watch,
        settle: resolve,
        stopWatching: () => watch.signal?.removeEventListener('abort', stop),
      });
      const description = subject.describe();
      const learning =
        subject.learning === undefined
          ? undefined
          : { channels: subject.learning.channels, description: subject.learning.describe() };
      this.#workerPort().post(
        {
          kind: ToDetectionWorkerKind.Detect,
          job,
          target: subject.target,
          channels: subject.channels,
          description,
          ...(learning === undefined ? {} : { learning }),
          quality: subject.quality,
          range: subject.range,
          assistants: subject.assistants,
          detectors: subject.detectors,
        },
        describedBuffers(
          learning === undefined ? [description] : [description, learning.description],
        ),
      );
    });
  }

  /** Ends every detection waiting as cancelled, and the worker with them. */
  dispose(): void {
    for (const job of [...this.#waiting.keys()]) this.#settle(job, { kind: 'cancelled' });
    this.#worker?.terminate();
    this.#worker = undefined;
  }

  #workerPort(): DetectionWorkerPort {
    if (this.#worker !== undefined) return this.#worker;
    const worker = this.#createWorker();
    this.#worker = worker;
    worker.listen(
      (value) => {
        this.#receive(value);
      },
      (reason) => {
        this.#failAll(worker, `The detection worker stopped: ${reason}`);
      },
    );
    return worker;
  }

  #receive(value: unknown): void {
    const read = readFromDetectionWorker(value);
    if (!read.ok) {
      if (this.#worker !== undefined) this.#failAll(this.#worker, read.failures[0].summary);
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case FromDetectionWorkerKind.Refused:
        if (this.#worker !== undefined) this.#failAll(this.#worker, message.reason);
        return;
      case FromDetectionWorkerKind.Progress:
        this.#waiting.get(message.job)?.watch.onProgress?.(message.framesRead, message.framesTotal);
        return;
      case FromDetectionWorkerKind.Done: {
        const waiting = this.#waiting.get(message.job);
        if (waiting !== undefined) this.#keep(waiting.key, message.result);
        this.#settle(message.job, { kind: 'done', result: message.result, kept: false });
        return;
      }
      case FromDetectionWorkerKind.Failed:
        this.#settle(message.job, { kind: 'failed', reason: message.reason });
        return;
      case FromDetectionWorkerKind.Cancelled:
        this.#settle(message.job, { kind: 'cancelled' });
        return;
    }
  }

  #keep(key: string, result: DetectionResult): void {
    this.#kept.delete(key);
    this.#kept.set(key, result);
    for (const oldest of this.#kept.keys()) {
      if (this.#kept.size <= KEPT_RESULTS) break;
      this.#kept.delete(oldest);
    }
  }

  /** Answers a waiting detection, once; an answer for one already answered is dropped. */
  #settle(job: string, outcome: DetectionOutcome): void {
    const waiting = this.#waiting.get(job);
    if (waiting === undefined) return;
    this.#waiting.delete(job);
    waiting.stopWatching();
    waiting.settle(outcome);
  }

  /** Fails every detection waiting on `worker`, which is let go, so the next has a new one. */
  #failAll(worker: DetectionWorkerPort, reason: string): void {
    if (this.#worker !== worker) return;
    this.#worker = undefined;
    worker.terminate();
    for (const job of [...this.#waiting.keys()]) this.#settle(job, { kind: 'failed', reason });
  }
}
