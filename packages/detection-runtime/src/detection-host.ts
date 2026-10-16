/**
 * The page's end of the detection worker: one worker, made with the first job
 * asked for and kept for the rest, and the answers it gave, kept for the
 * operation's life by what the target's audio is made from. Its jobs are
 * detections by the assistants, loop analyses (ADR-0103) and loudness
 * measurements.
 *
 * A job whose subject is as it was when it was last answered is answered from
 * what was kept, and the worker reads nothing (G4): the key is the subject's
 * whole identity (`job-subjects.ts`). The worker's messages are read field by
 * field; one it cannot read, or the worker failing, fails every job waiting
 * with the reason, never silently, and the next is given a new worker. An
 * answer is a value: nothing here changes the project, so a job that fails or
 * is cancelled leaves it as it was.
 */

import type { CancellationSignal } from '@audiogubbins/domain';
import { describedBuffers } from '@audiogubbins/audio-engine';
import type { LoopAnalysis } from '@audiogubbins/loop-analysis';

import { readFromDetectionWorker } from './detection-message-reading.js';
import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type ToDetectionWorker,
} from './detection-messages.js';
import type { DetectionResult } from './detection-result.js';
import {
  detectionKey,
  loopKey,
  loudnessKey,
  type DetectionSubject,
  type LoopSubject,
  type LoudnessSubject,
} from './job-subjects.js';
import type { LoudnessMeasurement } from './loudness-run.js';

/** The page's end of a detection worker. */
export interface DetectionWorkerPort {
  post(message: ToDetectionWorker, transfer: readonly ArrayBuffer[]): void;
  /** Listens for the worker's messages, and for its failing, with the reason. */
  listen(onMessage: (value: unknown) => void, onFault: (reason: string) => void): void;
  terminate(): void;
}

/** How a job ended without an answer. */
export type JobEnded =
  { readonly kind: 'failed'; readonly reason: string } | { readonly kind: 'cancelled' };

/** How a detection ended. */
export type DetectionOutcome =
  | {
      readonly kind: 'done';
      readonly result: DetectionResult;
      /** Whether it was answered from a result kept, with nothing read. */
      readonly kept: boolean;
    }
  | JobEnded;

/** How a loop analysis ended. */
export type LoopOutcome =
  | {
      readonly kind: 'done';
      readonly analysis: LoopAnalysis;
      /** Whether it was answered from an analysis kept, with nothing read. */
      readonly kept: boolean;
    }
  | JobEnded;

/** How a loudness measurement ended. */
export type LoudnessOutcome =
  | {
      readonly kind: 'done';
      readonly measurement: LoudnessMeasurement;
      /** Whether it was answered from a measurement kept, with nothing read. */
      readonly kept: boolean;
    }
  | JobEnded;

/** What a caller watches a job with. */
export interface DetectionWatch {
  /** Stops the job, which then ends as cancelled. */
  readonly signal?: CancellationSignal;
  /** How far it has gone: frames read, or for a loop analysis its work in frames' worth. */
  readonly onProgress?: (framesRead: number, framesTotal: number) => void;
}

/** A job's answer, as the worker gave it. */
type Answer =
  | { readonly kind: typeof FromDetectionWorkerKind.Done; readonly result: DetectionResult }
  | { readonly kind: typeof FromDetectionWorkerKind.LoopAnalysed; readonly analysis: LoopAnalysis }
  | {
      readonly kind: typeof FromDetectionWorkerKind.LoudnessMeasured;
      readonly measurement: LoudnessMeasurement;
    };

/** How a job ended, its answer taken as the caller asked for it. */
type Outcome<TValue> =
  { readonly kind: 'done'; readonly value: TValue; readonly kept: boolean } | JobEnded;

/** A job the worker is running or holds queued. */
interface Waiting {
  readonly key: string;
  readonly watch: DetectionWatch;
  /** Answers the job; false where the answer is not of the kind it asked for, and the job failed. */
  readonly answer: (answer: Answer) => boolean;
  readonly end: (ended: JobEnded) => void;
  readonly stopWatching: () => void;
}

/** A job's message to the worker, and the arrays in memory it transfers. */
interface Posting {
  readonly message: ToDetectionWorker;
  readonly transfer: readonly ArrayBuffer[];
}

/**
 * The most answers kept. An answer is small, findings, metrics and readings,
 * but every edit makes a new identity, and the oldest are the least likely to
 * be asked for again: an undo far back reads again rather than the page
 * holding every version it has seen.
 */
const KEPT_RESULTS = 64;

/** Why a job failed whose answer was of another kind than it asked for. */
const ANSWER_MISMATCHED = 'The detection worker answered a job with an answer of another kind.';

/** Jobs on one worker, and the answers it gave. */
export class DetectionHost {
  readonly #createWorker: () => DetectionWorkerPort;
  readonly #kept = new Map<string, Answer>();
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
  async detect(subject: DetectionSubject, watch: DetectionWatch = {}): Promise<DetectionOutcome> {
    const outcome = await this.#run(
      detectionKey(subject),
      watch,
      (answer) => (answer.kind === FromDetectionWorkerKind.Done ? answer.result : undefined),
      (job) => {
        const description = subject.describe();
        const learning =
          subject.learning === undefined
            ? undefined
            : { channels: subject.learning.channels, description: subject.learning.describe() };
        return {
          message: {
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
          transfer: describedBuffers(
            learning === undefined ? [description] : [description, learning.description],
          ),
        };
      },
    );
    return outcome.kind === 'done'
      ? { kind: 'done', result: outcome.value, kept: outcome.kept }
      : outcome;
  }

  /**
   * Measures the loop `subject` names, and searches for better boundaries
   * where its request asks. It applies nothing: the region's loop is moved
   * only by a command the person runs. An analysis of the same region still
   * running ends as cancelled.
   */
  async analyseLoop(subject: LoopSubject, watch: DetectionWatch = {}): Promise<LoopOutcome> {
    const outcome = await this.#run(
      loopKey(subject),
      watch,
      (answer) =>
        answer.kind === FromDetectionWorkerKind.LoopAnalysed ? answer.analysis : undefined,
      (job) => {
        const { heard, plain } = subject.describe();
        return {
          message: {
            kind: ToDetectionWorkerKind.AnalyseLoop,
            job,
            target: subject.target,
            channels: subject.channels,
            heard,
            plain,
            quality: subject.quality,
            request: subject.request,
          },
          transfer: describedBuffers([heard, plain]),
        };
      },
    );
    return outcome.kind === 'done'
      ? { kind: 'done', analysis: outcome.value, kept: outcome.kept }
      : outcome;
  }

  /**
   * Measures the integrated loudness, loudness range and true peak of
   * `subject`. A measurement of the same target still running ends as
   * cancelled.
   */
  async measureLoudness(
    subject: LoudnessSubject,
    watch: DetectionWatch = {},
  ): Promise<LoudnessOutcome> {
    const outcome = await this.#run(
      loudnessKey(subject),
      watch,
      (answer) =>
        answer.kind === FromDetectionWorkerKind.LoudnessMeasured ? answer.measurement : undefined,
      (job) => {
        const description = subject.describe();
        return {
          message: {
            kind: ToDetectionWorkerKind.MeasureLoudness,
            job,
            target: subject.target,
            channels: subject.channels,
            description,
            quality: subject.quality,
            range: subject.range,
          },
          transfer: describedBuffers([description]),
        };
      },
    );
    return outcome.kind === 'done'
      ? { kind: 'done', measurement: outcome.value, kept: outcome.kept }
      : outcome;
  }

  /** Ends every job waiting as cancelled, and the worker with them. */
  dispose(): void {
    for (const job of [...this.#waiting.keys()]) this.#end(job, { kind: 'cancelled' });
    this.#worker?.terminate();
    this.#worker = undefined;
  }

  /**
   * Answers the job kept under `key` from what was kept, or posts the one
   * `posting` makes for a new job's name, and answers what the worker does,
   * `take` reading the answer as the caller asked for it.
   */
  #run<TValue>(
    key: string,
    watch: DetectionWatch,
    take: (answer: Answer) => TValue | undefined,
    posting: (job: string) => Posting,
  ): Promise<Outcome<TValue>> {
    const kept = this.#kept.get(key);
    const keptValue = kept === undefined ? undefined : take(kept);
    if (kept !== undefined && keptValue !== undefined) {
      // Taken out and put back, so the order of the map is the order of use.
      this.#kept.delete(key);
      this.#kept.set(key, kept);
      return Promise.resolve({ kind: 'done', value: keptValue, kept: true });
    }
    if (watch.signal?.aborted === true) return Promise.resolve({ kind: 'cancelled' });
    this.#jobs += 1;
    const job = `detection-${String(this.#jobs)}`;
    return new Promise((resolve) => {
      const stop = (): void => {
        this.#workerPort().post({ kind: ToDetectionWorkerKind.Cancel, job }, []);
        this.#end(job, { kind: 'cancelled' });
      };
      watch.signal?.addEventListener('abort', stop, { once: true });
      this.#waiting.set(job, {
        key,
        watch,
        answer: (answer) => {
          const value = take(answer);
          resolve(
            value === undefined
              ? { kind: 'failed', reason: ANSWER_MISMATCHED }
              : { kind: 'done', value, kept: false },
          );
          return value !== undefined;
        },
        end: resolve,
        stopWatching: () => watch.signal?.removeEventListener('abort', stop),
      });
      const { message, transfer } = posting(job);
      this.#workerPort().post(message, transfer);
    });
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
      case FromDetectionWorkerKind.Done:
      case FromDetectionWorkerKind.LoopAnalysed:
      case FromDetectionWorkerKind.LoudnessMeasured:
        this.#answer(message.job, message);
        return;
      case FromDetectionWorkerKind.Failed:
        this.#end(message.job, { kind: 'failed', reason: message.reason });
        return;
      case FromDetectionWorkerKind.Cancelled:
        this.#end(message.job, { kind: 'cancelled' });
        return;
    }
  }

  /** Answers a waiting job, once, keeping the answer where it is the kind the job asked for. */
  #answer(job: string, answer: Answer): void {
    const waiting = this.#take(job);
    if (waiting === undefined) return;
    if (waiting.answer(answer)) this.#keep(waiting.key, answer);
  }

  /** Ends a waiting job without an answer, once; an end for one already ended is dropped. */
  #end(job: string, ended: JobEnded): void {
    this.#take(job)?.end(ended);
  }

  /** The job waiting under `job`, no longer waiting or watched, if it still was. */
  #take(job: string): Waiting | undefined {
    const waiting = this.#waiting.get(job);
    if (waiting === undefined) return undefined;
    this.#waiting.delete(job);
    waiting.stopWatching();
    return waiting;
  }

  #keep(key: string, answer: Answer): void {
    this.#kept.delete(key);
    this.#kept.set(key, answer);
    for (const oldest of this.#kept.keys()) {
      if (this.#kept.size <= KEPT_RESULTS) break;
      this.#kept.delete(oldest);
    }
  }

  /** Fails every job waiting on `worker`, which is let go, so the next has a new one. */
  #failAll(worker: DetectionWorkerPort, reason: string): void {
    if (this.#worker !== worker) return;
    this.#worker = undefined;
    worker.terminate();
    for (const job of [...this.#waiting.keys()]) this.#end(job, { kind: 'failed', reason });
  }
}
