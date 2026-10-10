/**
 * Offline renders on the main thread's behalf, each run in a worker of its own.
 *
 * The main thread does none of a render's work: it checks that every sink of
 * the graph is bound, queues the job with the priority scheduler, which
 * bounds how many run at once and starts a foreground render before a
 * waiting background one (REQ-ARCH-084), and gives each running job a new
 * worker (`worker-render.ts`). What is left to it per chunk is writing the
 * chunk to its sink and saying so, which is what keeps the interface
 * responsive while a long render runs (the packet's acceptance "UI remains
 * responsive during representative offline renders").
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { PriorityScheduler, RenderSink } from '@audiogubbins/audio-engine';

import type { CompiledDspModule, DspDelivery } from '../dsp/dsp-delivery.js';
import { renderEndpoints } from './render-endpoints.js';
import type { RenderRequest, RenderRunOptions, WorkerRenderSummary } from './render-request.js';
import { renderOnWorker, type BoundSink, type RenderWorkerPort } from './worker-render.js';
import type { Schedule } from '../schedule.js';

/** What the host is given. */
export interface RenderHostOptions {
  readonly createWorker: () => RenderWorkerPort;
  readonly scheduler: PriorityScheduler;
  /** The canonical DSP compiled once on the main thread, or why there is none. */
  readonly dsp: DspDelivery<CompiledDspModule>;
  readonly schedule: Schedule;
}

/** Offline renders, each in a worker. */
export interface RenderHost {
  /**
   * Renders a request to its sinks, or says why it cannot. Cancelling
   * `options.signal` rejects with the signal's reason, or with `Cancelled`
   * where it gave none, as the engine's own renderer does.
   */
  render(
    request: RenderRequest,
    options: RenderRunOptions,
  ): Promise<DomainResult<WorkerRenderSummary>>;
}

function unbound(node: NodeId): DomainFailure {
  return failure(
    'render.sink-unbound',
    FailureKind.Rejected,
    `The graph's sink ${node} has nowhere to write; bind a render sink to it.`,
    { details: { node } },
  );
}

function boundTwice(node: NodeId): DomainFailure {
  return failure(
    'render.sink-bound-twice',
    FailureKind.Rejected,
    `The graph's sink ${node} is bound to a render sink and to a channel; bind it to one.`,
    { details: { node } },
  );
}

function notASink(node: NodeId): DomainFailure {
  return failure(
    'render.channel-unknown-sink',
    FailureKind.Rejected,
    `A channel is given for ${node}, which is no sink of the graph.`,
    { details: { node } },
  );
}

/**
 * Each sink of the graph bound to the caller's, those bound to a channel
 * left to the worker, or every sink left unbound or bound twice, found before
 * a worker is started or a source's audio is given up.
 */
function bindSinks(
  request: RenderRequest,
  sinks: ReadonlyMap<NodeId, RenderSink>,
  channels: ReadonlyMap<NodeId, MessagePort>,
): DomainResult<ReadonlyMap<NodeId, BoundSink>> {
  const endpoints = renderEndpoints(request.graph);
  if (!endpoints.ok) return endpoints;
  const bound = new Map<NodeId, BoundSink>();
  const problems: DomainFailure[] = [];
  for (const [node, layout] of endpoints.value.sinks) {
    const sink = sinks.get(node);
    const channelled = channels.has(node);
    if (sink !== undefined && channelled) problems.push(boundTwice(node));
    else if (sink !== undefined) bound.set(node, { sink, layout });
    else if (!channelled) problems.push(unbound(node));
  }
  for (const node of channels.keys()) {
    if (!endpoints.value.sinks.has(node)) problems.push(notASink(node));
  }
  const [first, ...rest] = problems;
  return first === undefined ? succeed(bound) : fail(first, ...rest);
}

/** A host that runs each render in a worker of its own, as the scheduler allows. */
export function createRenderHost(options: RenderHostOptions): RenderHost {
  let jobs = 0;
  return {
    render: async (request, run) => {
      const sinks = bindSinks(request, run.sinks, run.channels ?? new Map());
      if (!sinks.ok) return sinks;
      jobs += 1;
      const jobId = `render-${String(jobs)}`;
      return await options.scheduler.submit(
        {
          priority: run.priority,
          run: (signal) =>
            renderOnWorker(options.createWorker(), {
              jobId,
              request,
              options: run,
              sinks: sinks.value,
              signal,
              schedule: options.schedule,
              dsp: options.dsp,
            }),
        },
        run.signal,
      );
    },
  };
}
