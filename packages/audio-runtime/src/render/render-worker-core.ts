/**
 * What a render worker does with the messages it is sent.
 *
 * The worker's module (`threads/render-worker.ts`) only connects this to its
 * global scope, so the whole of the worker's behaviour runs in a Node test
 * with the host's side played by the test. A worker renders one job at a
 * time: the main thread starts a worker for each job it runs, so the
 * scheduler's bound on concurrent jobs is the bound on workers.
 *
 * The render is the engine's own offline render, on the DSP the main thread
 * sent or on the reference path with the reason it could not be used. The
 * worker yields to its host between chunks, so a `cancel` or a `chunk-taken`
 * sent while it renders is read before the next chunk rather than after the
 * last one.
 */

import {
  Cancelled,
  FailureKind,
  createCancellationSource,
  failure,
  type CancellationSource,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  ProcessedStart,
  renderOffline,
  type ChainProcessing,
  type PcmSource,
  type RenderJob,
  type RenderOptions,
  type RenderSink,
  type RenderSummary,
} from '@audiogubbins/audio-engine';

import { scopeDsp, type DspChooser, type ScopeDsp } from '../dsp/dsp-instance.js';
import {
  FromRenderWorkerKind,
  ToRenderWorkerKind,
  readToRenderWorker,
  type FromRenderWorker,
  type RenderFailures,
  type ToRenderWorker,
} from '../protocol/render-messages.js';
import { ChunkWindow } from './chunk-window.js';
import { postingSink, type PostToHost } from './posting-sink.js';
import { renderEndpoints } from './render-endpoints.js';
import { makeSources } from './render-sources.js';

/** The worker's global scope, as the core uses it. */
export interface RenderWorkerHost {
  readonly post: PostToHost;
  /** Resolves once the scope has read the messages that arrived while it rendered. */
  readonly yieldToHost: () => Promise<void>;
  /**
   * Raises a fault the worker did not expect as an uncaught error of its
   * scope, which the main thread hears as the worker's `error` event and fails
   * the job with. `reportError` in the worker: a rejected promise nobody
   * awaits would reach no one, and the main thread would wait on the job.
   */
  readonly reportFault: (error: unknown) => void;
  /** How the chains an edited source's plan names are run: the effect rack's. */
  readonly processing: ChainProcessing;
}

/**
 * Whether a render threw what the engine and the DSP throw on purpose: a
 * plain `Error`, as the engine throws for a source that cannot be read or a
 * call the DSP module refuses; a `RangeError`, an engine out of memory; or a
 * trap in the DSP module. Anything else, a `TypeError` above all, is a fault
 * in the code, which is raised as itself rather than dressed as a failed
 * render.
 */
function isRenderFault(error: unknown): error is Error {
  return (
    error instanceof RangeError ||
    error instanceof WebAssembly.RuntimeError ||
    (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype)
  );
}

type RenderMessage = Extract<ToRenderWorker, { readonly kind: typeof ToRenderWorkerKind.Render }>;

interface RunningJob {
  readonly jobId: string;
  readonly cancellation: CancellationSource;
  readonly window: ChunkWindow;
}

/**
 * Each conversion's share of what the conversions' tables may hold together:
 * an equal part for each source at another rate than the render's, since the
 * engine gives each conversion the budget it is handed.
 */
function budgetPerConversion(message: RenderMessage): number | undefined {
  const total = message.coefficientBudgetBytes;
  if (total === undefined) return undefined;
  const converted = message.sources.filter((one) => one.sampleRate !== message.sampleRate).length;
  return converted === 0 ? total : Math.floor(total / converted);
}

/** The engine's job for a render message, with the sources and sinks made for it. */
function renderJobOf(
  message: RenderMessage,
  sources: ReadonlyMap<NodeId, PcmSource>,
  sinks: ReadonlyMap<NodeId, RenderSink>,
): RenderJob {
  const budget = budgetPerConversion(message);
  return {
    graph: message.graph,
    sampleRate: message.sampleRate,
    sources,
    sinks,
    range: message.range,
    quality: message.quality,
    chunkFrames: message.chunkFrames,
    ...(budget === undefined ? {} : { coefficientBudgetBytes: budget }),
  };
}

function doneOf(jobId: string, summary: RenderSummary, scoped: ScopeDsp): FromRenderWorker {
  return {
    kind: FromRenderWorkerKind.Done,
    jobId,
    frames: summary.frames,
    latencyTrimmed: [...summary.latencyTrimmed],
    conversions: summary.conversions,
    dsp: scoped.dsp.implementation,
    dspFallbackReason: scoped.fallbackReason,
  };
}

/** A render worker's behaviour, given how it posts and yields. */
export class RenderWorkerCore {
  readonly #host: RenderWorkerHost;
  readonly #chooseDsp: DspChooser;
  #running: RunningJob | undefined;

  constructor(host: RenderWorkerHost, chooseDsp: DspChooser = scopeDsp) {
    this.#host = host;
    this.#chooseDsp = chooseDsp;
  }

  /** Acts on a message the worker received. */
  receive(data: unknown): void {
    const read = readToRenderWorker(data);
    if (!read.ok) {
      this.#host.post({ kind: FromRenderWorkerKind.Refused, failures: read.failures }, []);
      return;
    }
    const message = read.value;
    // An acknowledgement or a cancellation for a job that is not running has
    // crossed with its end: the job finished before the message arrived, so
    // there is nothing left for it to act on.
    switch (message.kind) {
      case ToRenderWorkerKind.Render:
        this.#begin(message);
        return;
      case ToRenderWorkerKind.ChunkTaken:
        this.#runningAs(message.jobId)?.window.taken();
        return;
      case ToRenderWorkerKind.Cancel:
        this.#runningAs(message.jobId)?.cancellation.cancel(new Cancelled());
        return;
    }
  }

  /**
   * Says that a message arrived and could not be received: a `render` that
   * carries a compiled module and every source's audio can fail to
   * deserialise, and then nothing else ever reaches the host, which would wait
   * on the job, holding its slot of the scheduler, until the person cancelled.
   * Which job the message was for cannot be read, and a worker serves one, so
   * the host fails that one.
   */
  messageFailed(): void {
    this.#host.post(
      {
        kind: FromRenderWorkerKind.Refused,
        failures: [
          failure(
            'protocol.render-message-unreceivable',
            FailureKind.Unrecoverable,
            'A message from the main thread could not be received by the render worker, so the render cannot go on.',
          ),
        ],
      },
      [],
    );
  }

  #runningAs(jobId: string): RunningJob | undefined {
    return this.#running?.jobId === jobId ? this.#running : undefined;
  }

  #fail(jobId: string, failures: RenderFailures): void {
    this.#host.post({ kind: FromRenderWorkerKind.Failed, jobId, failures }, []);
  }

  #begin(message: RenderMessage): void {
    if (this.#running !== undefined) {
      this.#fail(message.jobId, [
        failure(
          'render.worker-busy',
          FailureKind.Conflict,
          `This worker is rendering ${this.#running.jobId} and renders one job at a time; ` +
            `give ${message.jobId} a worker of its own.`,
          { details: { busyWith: this.#running.jobId } },
        ),
      ]);
      return;
    }
    const job: RunningJob = {
      jobId: message.jobId,
      cancellation: createCancellationSource(),
      window: new ChunkWindow(),
    };
    this.#running = job;
    void this.#render(message, job)
      .finally(() => {
        this.#running = undefined;
      })
      .catch(this.#host.reportFault);
  }

  async #render(message: RenderMessage, job: RunningJob): Promise<void> {
    const scoped = this.#chooseDsp(message.dsp);
    const endpoints = renderEndpoints(message.graph);
    if (!endpoints.ok) {
      this.#fail(job.jobId, endpoints.failures);
      return;
    }
    const sources = makeSources(message.sources, endpoints.value.inputs, scoped.dsp, {
      processing: this.#host.processing,
      quality: message.quality.settings,
      start: ProcessedStart.Canonical,
    });
    if (!sources.ok) {
      this.#fail(job.jobId, sources.failures);
      return;
    }
    const posting = {
      jobId: job.jobId,
      window: job.window,
      signal: job.cancellation.signal,
      post: this.#host.post,
    };
    const sinks = new Map<NodeId, RenderSink>(
      [...endpoints.value.sinks.keys()].map((node) => [node, postingSink(node, posting)]),
    );
    try {
      await this.#run(renderJobOf(message, sources.value, sinks), job, scoped);
    } finally {
      for (const source of sources.value.values()) source.release();
    }
  }

  async #run(renderJob: RenderJob, job: RunningJob, scoped: ScopeDsp): Promise<void> {
    const { signal } = job.cancellation;
    const options: RenderOptions = {
      signal,
      // The renderer reports once a chunk, which is as often as the main
      // thread needs to move a progress bar.
      onProgress: (progress) => {
        this.#host.post({ kind: FromRenderWorkerKind.Progress, jobId: job.jobId, ...progress }, []);
      },
      yieldToHost: this.#host.yieldToHost,
    };
    try {
      const rendered = await renderOffline(renderJob, scoped.dsp, BUILT_IN_NODES, options);
      if (rendered.ok) this.#host.post(doneOf(job.jobId, rendered.value, scoped), []);
      else this.#fail(job.jobId, rendered.failures);
    } catch (error) {
      if (signal.aborted && error === signal.reason) {
        this.#host.post({ kind: FromRenderWorkerKind.Cancelled, jobId: job.jobId }, []);
        return;
      }
      // A render that stopped, such as on a source that cannot be read or a
      // DSP out of memory, is the job's failure, which the main thread is
      // waiting to hear as a message.
      if (!isRenderFault(error)) throw error;
      this.#fail(job.jobId, [
        failure(
          'render.worker-fault',
          FailureKind.Unrecoverable,
          `The render stopped: ${error.message}`,
        ),
      ]);
    }
  }
}
