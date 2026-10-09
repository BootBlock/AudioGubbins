/**
 * What the detection worker does, apart from the scope it runs in.
 *
 * The worker's module (`threads/detection-worker.ts`) only connects this to
 * its global scope and gives it the effect rack, the assistants and the
 * processor types, so the whole of its behaviour runs in a test with the
 * page's side played by the test. It reads a target's audio through the
 * engine's own described source, with the chains its plan names run by the
 * rack at the final render's quality from the stream's start, as the render
 * and the peaks read it: never a second reader (ADR-0061). The audio a
 * recommended step learns from is read the same way, from the request's own
 * description of it where it differs from the audio analysed.
 *
 * One detection runs at a time, the rest queued in the order asked, which
 * bounds the work in flight to one source (G4). A target has one detection
 * at a time: a request for a target cancels the one before it, queued or
 * running, which is answered as cancelled. The core yields to its host
 * between chunks, so a cancellation sent while a chunk is heard is read
 * before the next.
 */

import {
  Cancelled,
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  mapResult,
  succeed,
  discreteLayout,
  type CancellationSource,
  type DomainResult,
  type QualityMode,
} from '@audiogubbins/domain';
import {
  PreviewClient,
  ProcessedStart,
  describedSource,
  previewPort,
  type CanonicalDsp,
  type ChainProcessing,
  type PcmSource,
  type ToPreview,
} from '@audiogubbins/audio-engine';
import type { Assistant, ProcessorType } from '@audiogubbins/processors';

import { readToDetectionWorker } from './detection-message-reading.js';
import {
  FromDetectionWorkerKind,
  ToDetectionWorkerKind,
  type DetectRequest,
  type FromDetectionWorker,
  type DescribedAudio,
} from './detection-messages.js';
import type { DetectionResult } from './detection-result.js';
import { runDetection, type DetectionAudio } from './detection-run.js';

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

/** A detection asked for, and what cancels it. */
interface Job {
  readonly request: DetectRequest;
  readonly cancellation: CancellationSource;
  /** Why it was stopped, where it was stopped by a failure rather than asked to stop. */
  failedWith: string | undefined;
}

/**
 * Whether a detection threw what the engine throws on purpose: a plain
 * `Error`, for a source that cannot be read, or a `RangeError`, an engine out
 * of memory. Anything else is a fault in the code, raised as itself.
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
    this.#cancel((job) => job.request.target === message.target);
    this.#queue.push({
      request: message,
      cancellation: createCancellationSource(),
      failedWith: undefined,
    });
    void this.#pump();
  }

  /**
   * Says that a message arrived and could not be received, which names no job:
   * every detection fails with the reason, rather than one leaving the page
   * waiting on an answer for ever.
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

  /** Cancels every detection `matches`: a queued one at once, the running one at its next turn. */
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
    const { request, cancellation } = job;
    const name = request.job;
    const { signal } = cancellation;
    const assistants = this.#assistantsOf(request);
    if (!assistants.ok) {
      this.#post(name, assistants);
      return;
    }
    const audio = this.#audioOf(request);
    if (!audio.ok) {
      this.#post(name, audio);
      return;
    }
    try {
      const result = await runDetection(
        audio.value,
        request.range,
        assistants.value,
        request.detectors,
        {
          dsp: this.#host.dsp,
          types: this.#host.types,
          signal,
          yieldToHost: this.#host.yieldToHost,
          onProgress: (framesRead, framesTotal) => {
            this.#host.post({
              kind: FromDetectionWorkerKind.Progress,
              job: name,
              framesRead,
              framesTotal,
            });
          },
        },
      );
      this.#post(name, result);
    } catch (error) {
      this.#postStopped(job, error);
    } finally {
      audio.value.heard.release();
      if (audio.value.learning !== audio.value.heard) audio.value.learning.release();
    }
  }

  /**
   * Says how a detection that threw ended: cancelled, or failed as it was
   * stopped or because its audio could not be read. Anything else is a fault
   * in the code, raised as itself.
   */
  #postStopped(job: Job, error: unknown): void {
    const name = job.request.job;
    const { signal } = job.cancellation;
    if (signal.aborted && error === signal.reason) {
      this.#host.post(
        job.failedWith === undefined
          ? { kind: FromDetectionWorkerKind.Cancelled, job: name }
          : { kind: FromDetectionWorkerKind.Failed, job: name, reason: job.failedWith },
      );
      return;
    }
    if (!isReadFault(error)) throw error;
    this.#host.post({
      kind: FromDetectionWorkerKind.Failed,
      job: name,
      reason: `The audio could not be read: ${error.message}`,
    });
  }

  /** Posts a detection's answer, or why there is none. */
  #post(job: string, answer: DomainResult<DetectionResult>): void {
    this.#host.post(
      answer.ok
        ? { kind: FromDetectionWorkerKind.Done, job, result: answer.value }
        : { kind: FromDetectionWorkerKind.Failed, job, reason: answer.failures[0].summary },
    );
  }

  /**
   * The audio a request reads, heard and learned from, one source where they
   * are the same, or why it cannot be read. The caller releases it.
   */
  #audioOf(request: DetectRequest): DomainResult<DetectionAudio> {
    const heard = this.#sourceOf(request, request.quality);
    if (!heard.ok || request.learning === undefined) {
      return mapResult(heard, (source) => ({ heard: source, learning: source }));
    }
    const learning = this.#sourceOf(request.learning, request.quality);
    if (!learning.ok) heard.value.release();
    return mapResult(learning, (source) => ({ heard: heard.value, learning: source }));
  }

  /** The source of described audio, read as the render reads it, or why it cannot be. */
  #sourceOf(audio: DescribedAudio, quality: QualityMode): DomainResult<PcmSource> {
    const layout = discreteLayout(audio.channels);
    if (!layout.ok) return layout;
    return describedSource(audio.description, layout.value, this.#host.dsp, {
      processing: this.#host.processing,
      quality: quality.settings,
      start: ProcessedStart.Canonical,
      ...(this.#previews === undefined ? {} : { cached: this.#previews }),
    });
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
