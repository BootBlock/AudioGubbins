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

import { FailureKind, failure } from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  Cancelled,
  createCancellationSource,
  renderOffline,
  type CancellationSource,
  type PcmSource,
  type RenderJob,
  type RenderOptions,
  type RenderSink,
  type RenderSummary,
} from '@audiogubbins/audio-engine';

import { scopeDsp, type ScopeDsp } from '../dsp/dsp-instance.js';
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
}

/**
 * Chooses a job's DSP from the module the main thread sent, or the reason it
 * sent none. `scopeDsp` in the worker; a test gives one that counts what its
 * DSP makes, which is how a test sees every source released.
 */
export type DspChooser = (
  module: WebAssembly.Module | undefined,
  unavailable: string | undefined,
) => ScopeDsp;

type RenderMessage = Extract<ToRenderWorker, { readonly kind: typeof ToRenderWorkerKind.Render }>;

interface RunningJob {
  readonly jobId: string;
  readonly cancellation: CancellationSource;
  readonly window: ChunkWindow;
}

/** The engine's job for a render message, with the sources and sinks made for it. */
function renderJobOf(
  message: RenderMessage,
  sources: ReadonlyMap<NodeId, PcmSource>,
  sinks: ReadonlyMap<NodeId, RenderSink>,
): RenderJob {
  return {
    graph: message.graph,
    sampleRate: message.sampleRate,
    sources,
    sinks,
    range: message.range,
    quality: { resampling: message.resamplingQuality },
    chunkFrames: message.chunkFrames,
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
    void this.#render(message, job).finally(() => {
      this.#running = undefined;
    });
  }

  async #render(message: RenderMessage, job: RunningJob): Promise<void> {
    const scoped = this.#chooseDsp(message.dspModule, message.dspUnavailable);
    const endpoints = renderEndpoints(message.graph);
    if (!endpoints.ok) {
      this.#fail(job.jobId, endpoints.failures);
      return;
    }
    const sources = makeSources(message.sources, endpoints.value.inputs, scoped.dsp);
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
      // A fault in the render itself, such as a source that cannot be read or
      // a DSP out of memory. The main thread is waiting on this job and hears
      // of it only through a message, so it is reported rather than left to
      // surface as an unhandled rejection the main thread never sees.
      if (!(error instanceof Error)) throw error;
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
