/**
 * What the detection worker does, apart from the scope it runs in.
 *
 * The worker's module (`threads/detection-worker.ts`) only connects this to
 * its global scope and gives it the effect rack, the assistants and the
 * processor types, so the whole of its behaviour runs in a test with the
 * page's side played by the test. Its jobs are detections by the assistants,
 * loop analyses (ADR-0103) and loudness measurements. Each reads a target's
 * audio through the engine's own described source, with the chains its plan
 * names run by the rack at the final render's quality from the stream's
 * start, as the render and the peaks read it: never a second reader
 * (ADR-0061). The audio a recommended step learns from, and a loop's region
 * without its crossfade, are read the same way, from the request's own
 * description of them.
 *
 * One job runs at a time, the rest queued in the order asked, which bounds the
 * work in flight to one target's sources (G4). A target has one job of each
 * kind at a time: a request of a kind for a target cancels the one of that
 * kind before it, queued or running, which is answered as cancelled. The core
 * yields to its host between chunks, so a cancellation sent while a chunk is
 * heard is read before the next.
 */

import {
  Cancelled,
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  succeed,
  type CancellationSource,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  PreviewClient,
  previewPort,
  type CanonicalDsp,
  type ChainProcessing,
  type ToPreview,
} from '@audiogubbins/audio-engine';
import type { Assistant, ProcessorType } from '@audiogubbins/processors';

import { readToDetectionWorker } from './detection-message-reading.js';
import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type AnalyseLoopRequest,
  type DetectRequest,
  type FromDetectionWorker,
  type MeasureLoudnessRequest,
  type WorkRequest,
} from './detection-messages.js';
import { runDetection } from './detection-run.js';
import {
  detectionAudio,
  loopAudio,
  loudnessAudio,
  type Opened,
  type SourceOpening,
} from './job-audio.js';
import { runLoopAnalysis } from './loop-run.js';
import { measureLoudness } from './loudness-run.js';

/** What the worker's scope gives the core. */
export interface DetectionWorkerHost {
  readonly post: (message: FromDetectionWorker) => void;
  /** Resolves after the events already queued for the worker have run. */
  readonly yieldToHost: () => Promise<void>;
  readonly dsp: CanonicalDsp;
  /** How the chains an edited source's plan names are run: the effect rack's. */
  readonly processing: ChainProcessing;
  /** The assistants a request may name, by their keys. */
  readonly assistants: readonly Assistant[];
  /** The processor types by key, whose learners learn a recommended step's state. */
  readonly types: ReadonlyMap<string, ProcessorType>;
  /**
   * Raises a fault the core did not expect as an uncaught error of its scope,
   * which the page hears as the worker's `error` event and fails every
   * detection with.
   */
  readonly reportFault: (error: unknown) => void;
}

/** A job asked for, and what cancels it. */
interface Job {
  readonly request: WorkRequest;
  readonly cancellation: CancellationSource;
  /** Why it was stopped, where it was stopped by a failure rather than asked to stop. */
  failedWith: string | undefined;
}

/** What a job's work is given beside its sources: what stops it, and where its progress goes. */
interface WorkTools {
  readonly signal: CancellationSource['signal'];
  readonly yieldToHost: () => Promise<void>;
  readonly onProgress: (framesRead: number, framesTotal: number) => void;
}

/** Whether `request` supersedes `job`: one of its kind for its target, which it cancels. */
function supersedes(request: WorkRequest, job: Job): boolean {
  return job.request.kind === request.kind && job.request.target === request.target;
}

/**
 * Whether a job threw what the engine throws on purpose: a plain `Error`, for
 * a source that cannot be read, or a `RangeError`, an engine out of memory.
 * Anything else is a fault in the code, raised as itself.
 */
function isReadFault(error: unknown): error is Error {
  return (
    error instanceof RangeError ||
    (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype)
  );
}

/** The detection worker's work, given its scope's parts. */
export class DetectionWorkerCore {
  readonly #host: DetectionWorkerHost;
  readonly #queue: Job[] = [];
  #running: Job | undefined;
  /** The preview worker's renders, once the page has given the port to them. */
  #previews: PreviewClient | undefined;

  constructor(host: DetectionWorkerHost) {
    this.#host = host;
  }

  /** Acts on a message from the page. */
  receive(data: unknown): void {
    const read = readToDetectionWorker(data);
    if (!read.ok) {
      this.#host.post({ kind: FromDetectionWorkerKind.Refused, reason: read.failures[0].summary });
      return;
    }
    const message = read.value;
    if (message.kind === ToDetectionWorkerKind.Previews) {
      this.#previews = new PreviewClient(previewPort<ToPreview>(message.port));
      return;
    }
    if (message.kind === ToDetectionWorkerKind.Cancel) {
      this.#cancel((job) => job.request.job === message.job);
      return;
    }
    this.#cancel((job) => supersedes(message, job));
    this.#queue.push({
      request: message,
      cancellation: createCancellationSource(),
      failedWith: undefined,
    });
    void this.#pump();
  }

  /**
   * Says that a message arrived and could not be received, which names no job:
   * every job fails with the reason, rather than one leaving the page waiting
   * on an answer for ever.
   */
  messageFailed(): void {
    const reason = 'A message to the detection worker could not be read.';
    for (const job of this.#queue.splice(0)) {
      this.#host.post({ kind: FromDetectionWorkerKind.Failed, job: job.request.job, reason });
    }
    const running = this.#running;
    if (running === undefined) return;
    running.failedWith = reason;
    running.cancellation.cancel(new Cancelled(reason));
  }

  /** Cancels every job `matches`: a queued one at once, the running one at its next turn. */
  #cancel(matches: (job: Job) => boolean): void {
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const job = this.#queue[index];
      if (job === undefined || !matches(job)) continue;
      this.#queue.splice(index, 1);
      this.#host.post({ kind: FromDetectionWorkerKind.Cancelled, job: job.request.job });
    }
    const running = this.#running;
    if (running !== undefined && matches(running)) running.cancellation.cancel(new Cancelled());
  }

  async #pump(): Promise<void> {
    if (this.#running !== undefined) return;
    for (let job = this.#queue.shift(); job !== undefined; job = this.#queue.shift()) {
      this.#running = job;
      try {
        await this.#run(job);
      } catch (error) {
        this.#host.reportFault(error);
      } finally {
        this.#running = undefined;
      }
    }
  }

  async #run(job: Job): Promise<void> {
    const { request } = job;
    switch (request.kind) {
      case ToDetectionWorkerKind.Detect:
        await this.#detect(job, request);
        return;
      case ToDetectionWorkerKind.AnalyseLoop:
        await this.#analyseLoop(job, request);
        return;
      case ToDetectionWorkerKind.MeasureLoudness:
        await this.#measureLoudness(job, request);
        return;
    }
  }

  async #detect(job: Job, request: DetectRequest): Promise<void> {
    const assistants = this.#assistantsOf(request);
    if (!assistants.ok) {
      this.#postFailed(job, assistants.failures[0].summary);
      return;
    }
    await this.#answer(
      job,
      detectionAudio(this.#opening(), request),
      (audio, tools) =>
        runDetection(audio, request.range, assistants.value, request.detectors, {
          ...tools,
          dsp: this.#host.dsp,
          types: this.#host.types,
        }),
      (result) => ({ kind: FromDetectionWorkerKind.Done, job: request.job, result }),
    );
  }

  async #analyseLoop(job: Job, request: AnalyseLoopRequest): Promise<void> {
    await this.#answer(
      job,
      loopAudio(this.#opening(), request),
      (audio, tools) => runLoopAnalysis(audio, request.request, { ...tools, dsp: this.#host.dsp }),
      (analysis) => ({ kind: FromDetectionWorkerKind.LoopAnalysed, job: request.job, analysis }),
    );
  }

  async #measureLoudness(job: Job, request: MeasureLoudnessRequest): Promise<void> {
    await this.#answer(
      job,
      loudnessAudio(this.#opening(), request),
      (source, tools) => measureLoudness(source, request.range, { ...tools, dsp: this.#host.dsp }),
      (measurement) => ({
        kind: FromDetectionWorkerKind.LoudnessMeasured,
        job: request.job,
        measurement,
      }),
    );
  }

  /**
   * Runs `work` over the audio `opened`, or says why it could not be opened,
   * and posts its answer as `done` makes it, or why there is none; every source
   * opened is released on every path.
   */
  async #answer<TAudio, TValue>(
    job: Job,
    opened: DomainResult<Opened<TAudio>>,
    work: (audio: TAudio, tools: WorkTools) => Promise<DomainResult<TValue>>,
    done: (value: TValue) => FromDetectionWorker,
  ): Promise<void> {
    if (!opened.ok) {
      this.#postFailed(job, opened.failures[0].summary);
      return;
    }
    const name = job.request.job;
    try {
      const answer = await work(opened.value.audio, {
        signal: job.cancellation.signal,
        yieldToHost: this.#host.yieldToHost,
        onProgress: (framesRead, framesTotal) => {
          this.#host.post({
            kind: FromDetectionWorkerKind.Progress,
            job: name,
            framesRead,
            framesTotal,
          });
        },
      });
      if (answer.ok) this.#host.post(done(answer.value));
      else this.#postFailed(job, answer.failures[0].summary);
    } catch (error) {
      this.#postStopped(job, error);
    } finally {
      for (const source of opened.value.sources) source.release();
    }
  }

  /**
   * Says how a job that threw ended: cancelled, or failed as it was stopped or
   * because its audio could not be read. Anything else is a fault in the code,
   * raised as itself.
   */
  #postStopped(job: Job, error: unknown): void {
    const { signal } = job.cancellation;
    if (signal.aborted && error === signal.reason) {
      if (job.failedWith === undefined) {
        this.#host.post({ kind: FromDetectionWorkerKind.Cancelled, job: job.request.job });
      } else {
        this.#postFailed(job, job.failedWith);
      }
      return;
    }
    if (!isReadFault(error)) throw error;
    this.#postFailed(job, `The audio could not be read: ${error.message}`);
  }

  /** Posts why a job has no answer. */
  #postFailed(job: Job, reason: string): void {
    this.#host.post({ kind: FromDetectionWorkerKind.Failed, job: job.request.job, reason });
  }

  /** What a job's sources are opened with: the rack, and the preview worker's renders where given. */
  #opening(): SourceOpening {
    return {
      dsp: this.#host.dsp,
      processing: this.#host.processing,
      previews: this.#previews,
    };
  }

  /** The assistants a request names, in its order, or the first key this build lacks. */
  #assistantsOf(request: DetectRequest): DomainResult<readonly Assistant[]> {
    const found: Assistant[] = [];
    for (const key of request.assistants) {
      const assistant = this.#host.assistants.find((one) => one.key === key);
      if (assistant === undefined) {
        return fail(
          failure(
            'detection.assistant-unknown',
            FailureKind.Rejected,
            `This build has no assistant "${key}" to analyse the audio with.`,
          ),
        );
      }
      found.push(assistant);
    }
    return succeed(found);
  }
}
