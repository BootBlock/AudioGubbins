/**
 * One render job's conversation with its worker, from the `render` message
 * to the worker's termination.
 *
 * The main thread's part of each chunk is writing it to its sink, as the
 * worker posted it, and answering `chunk-taken` once the write settles, so
 * the worker's window of chunks in flight is held by how fast the sink
 * writes. The chunks are written in the order they arrived, one at a time.
 *
 * The worker is terminated once the job ends, however it ends, so a failed or
 * cancelled render leaves no thread or DSP memory behind. A cancelled render
 * is asked to stop, and is terminated anyway if it has not answered within
 * {@link CANCEL_GRACE_MILLISECONDS}: a worker stuck in one long chunk would
 * otherwise hold its slot of the scheduler for as long as the chunk took.
 */

import {
  FailureKind,
  cancellationReason,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import { frameBlock, type RenderSink } from '@audiogubbins/audio-engine';

import {
  FromRenderWorkerKind,
  ToRenderWorkerKind,
  readFromRenderWorker,
  type FromRenderWorker,
  type ToRenderWorker,
} from '../protocol/render-messages.js';
import { deliveredAs, type CompiledDspModule, type DspDelivery } from '../dsp/dsp-delivery.js';
import { sourceTransferables } from '../protocol/source-descriptions.js';
import type { RenderRequest, RenderRunOptions, WorkerRenderSummary } from './render-request.js';
import type { Schedule } from '../schedule.js';

/** How long a cancelled render's worker has to answer before it is terminated. */
const CANCEL_GRACE_MILLISECONDS = 2_000;

/** The events a render worker raises that the host listens for, by type. */
export interface RenderWorkerEvents {
  readonly message: MessageEvent;
  /** A message from the worker that could not be deserialised. */
  readonly messageerror: MessageEvent;
  /** An error the worker's script threw and did not catch. */
  readonly error: ErrorEvent;
}

/**
 * The part of a `Worker` the host uses, so a test can play the worker where
 * the test environment has none.
 */
export interface RenderWorkerPort {
  postMessage(message: ToRenderWorker, transfer: Transferable[]): void;
  addEventListener<TType extends keyof RenderWorkerEvents>(
    type: TType,
    listener: (event: RenderWorkerEvents[TType]) => void,
  ): void;
  removeEventListener<TType extends keyof RenderWorkerEvents>(
    type: TType,
    listener: (event: RenderWorkerEvents[TType]) => void,
  ): void;
  terminate(): void;
}

/** A sink the caller bound, with the layout its chunks arrive in. */
export interface BoundSink {
  readonly sink: RenderSink;
  readonly layout: ChannelLayout;
}

/** Everything one job's conversation needs. */
export interface WorkerRenderJob {
  readonly jobId: string;
  readonly request: RenderRequest;
  readonly options: RenderRunOptions;
  readonly sinks: ReadonlyMap<NodeId, BoundSink>;
  /** The scheduler's cancellation of the job. */
  readonly signal: CancellationSignal;
  readonly schedule: Schedule;
  readonly dsp: DspDelivery<CompiledDspModule>;
}

type Reply<TKind extends FromRenderWorker['kind']> = Extract<
  FromRenderWorker,
  { readonly kind: TKind }
>;

/**
 * A fault in the conversation with the worker rather than in the render: the
 * worker threw, or sent what could not be received or read.
 */
function workerFailed(summary: string, cause?: DomainFailure): DomainResult<never> {
  return fail(
    failure(
      'render.worker-failed',
      FailureKind.Unrecoverable,
      summary,
      cause === undefined ? undefined : { cause },
    ),
  );
}

class WorkerRender {
  readonly #worker: RenderWorkerPort;
  readonly #job: WorkerRenderJob;
  readonly #resolve: (result: DomainResult<WorkerRenderSummary>) => void;
  readonly #reject: (reason: unknown) => void;
  #settled = false;
  #cancelGrace: (() => void) | undefined;

  /** The chunks being written, in order; the worker's window bounds how many. */
  #writing: Promise<void> = Promise.resolve();

  constructor(
    worker: RenderWorkerPort,
    job: WorkerRenderJob,
    resolve: (result: DomainResult<WorkerRenderSummary>) => void,
    reject: (reason: unknown) => void,
  ) {
    this.#worker = worker;
    this.#job = job;
    this.#resolve = resolve;
    this.#reject = reject;
  }

  start(): void {
    const { jobId, request, dsp, signal } = this.#job;
    this.#worker.addEventListener('message', this.#onMessage);
    this.#worker.addEventListener('messageerror', this.#onMessageError);
    this.#worker.addEventListener('error', this.#onError);
    signal.addEventListener('abort', this.#onAbort, { once: true });
    this.#worker.postMessage(
      {
        kind: ToRenderWorkerKind.Render,
        jobId,
        graph: request.graph,
        sampleRate: request.sampleRate,
        range: request.range,
        chunkFrames: request.chunkFrames,
        resamplingQuality: request.quality.resampling,
        sources: request.sources,
        coefficientBudgetBytes: request.coefficientBudgetBytes,
        dsp: deliveredAs(dsp, (module) => module.module),
      },
      sourceTransferables(request.sources),
    );
  }

  /** Ends the job once: stops listening, terminates the worker, then settles. */
  #finish(settle: () => void): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#worker.removeEventListener('message', this.#onMessage);
    this.#worker.removeEventListener('messageerror', this.#onMessageError);
    this.#worker.removeEventListener('error', this.#onError);
    this.#job.signal.removeEventListener('abort', this.#onAbort);
    this.#cancelGrace?.();
    this.#worker.terminate();
    settle();
  }

  #end(result: DomainResult<WorkerRenderSummary>): void {
    this.#finish(() => {
      this.#resolve(result);
    });
  }

  #cancelled(): void {
    this.#finish(() => {
      this.#reject(cancellationReason(this.#job.signal));
    });
  }

  readonly #onAbort = (): void => {
    this.#worker.postMessage({ kind: ToRenderWorkerKind.Cancel, jobId: this.#job.jobId }, []);
    this.#cancelGrace = this.#job.schedule(() => {
      this.#cancelled();
    }, CANCEL_GRACE_MILLISECONDS);
  };

  readonly #onError = (event: ErrorEvent): void => {
    // The page is told of an error in the worker too; this job has handled it.
    event.preventDefault();
    const described = event.message === '' ? 'an error it did not describe' : event.message;
    this.#end(workerFailed(`The render worker stopped: ${described}`));
  };

  readonly #onMessageError = (): void => {
    this.#end(workerFailed('A message from the render worker could not be received.'));
  };

  readonly #onMessage = (event: MessageEvent): void => {
    const read = readFromRenderWorker(event.data);
    if (!read.ok) {
      this.#end(
        workerFailed('The render worker sent a reply that cannot be read.', read.failures[0]),
      );
      return;
    }
    const reply = read.value;
    if (reply.kind === FromRenderWorkerKind.Refused) {
      this.#end(fail(...reply.failures));
    } else if (reply.jobId !== this.#job.jobId) {
      this.#end(
        workerFailed(`The render worker answered for ${reply.jobId}, not ${this.#job.jobId}.`),
      );
    } else {
      this.#act(reply);
    }
  };

  #act(reply: Exclude<FromRenderWorker, Reply<typeof FromRenderWorkerKind.Refused>>): void {
    switch (reply.kind) {
      case FromRenderWorkerKind.Progress:
        this.#job.options.onProgress?.({
          framesRendered: reply.framesRendered,
          framesTotal: reply.framesTotal,
        });
        return;
      case FromRenderWorkerKind.Chunk:
        this.#write(reply);
        return;
      case FromRenderWorkerKind.Done:
        this.#done(reply);
        return;
      case FromRenderWorkerKind.Failed:
        this.#end(fail(...reply.failures));
        return;
      case FromRenderWorkerKind.Cancelled:
        this.#cancelled();
        return;
    }
  }

  /** Writes a chunk after those before it, then tells the worker it may send another. */
  #write(reply: Reply<typeof FromRenderWorkerKind.Chunk>): void {
    const bound = this.#job.sinks.get(reply.node);
    if (bound === undefined) {
      this.#end(workerFailed(`The render worker sent audio for ${reply.node}, which has no sink.`));
      return;
    }
    const block = frameBlock(bound.layout, this.#job.request.sampleRate, reply.channels);
    if (!block.ok) {
      this.#end(block);
      return;
    }
    this.#writing = this.#writing
      .then(async () => {
        if (this.#settled) return;
        await bound.sink.write(block.value, this.#job.signal);
        this.#taken();
      })
      .catch((error: unknown) => {
        // The caller's sink refused the audio, as a full disk would: the
        // render cannot go on, and the caller hears the sink's own error.
        this.#finish(() => {
          this.#reject(error);
        });
      });
  }

  #taken(): void {
    // A job that ended while its chunk was being written has no worker left.
    if (this.#settled) return;
    this.#worker.postMessage({ kind: ToRenderWorkerKind.ChunkTaken, jobId: this.#job.jobId }, []);
  }

  #done(reply: Reply<typeof FromRenderWorkerKind.Done>): void {
    // The worker is done before the last chunks are written; the render is not.
    void this.#writing.then(() => {
      this.#end(
        succeed({
          frames: reply.frames,
          latencyTrimmed: new Map(reply.latencyTrimmed),
          conversions: reply.conversions,
          dsp: reply.dsp,
          dspFallbackReason: reply.dspFallbackReason,
        }),
      );
    });
  }
}

/**
 * Runs a job on `worker`, settling as the job ends: with the summary or the
 * failure, or rejecting when it is cancelled or a sink refuses a chunk.
 */
export function renderOnWorker(
  worker: RenderWorkerPort,
  job: WorkerRenderJob,
): Promise<DomainResult<WorkerRenderSummary>> {
  return new Promise((resolve, reject) => {
    new WorkerRender(worker, job, resolve, reject).start();
  });
}
