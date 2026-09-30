import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  FailureKind,
  StandardLayouts,
  failure,
  sampleCount,
  sampleRate,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId, type GraphDescriptor, type NodeId } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  Cancelled,
  DspImplementation,
  JobPriority,
  MAXIMUM_RENDER_QUALITY,
  createCancellationSource,
  SchedulingPolicy,
  createPriorityScheduler,
  type AudioFrameBlock,
  type PriorityScheduler,
  type RenderProgress,
  type RenderSink,
  PcmDescriptionKind,
} from '@audiogubbins/audio-engine';
import { graphOf, nodeOf, wire } from '@audiogubbins/audio-engine/testing';

import { DspDeliveryKind } from '../dsp/dsp-delivery.js';
import {
  FromRenderWorkerKind,
  ToRenderWorkerKind,
  type FromRenderWorker,
} from '../protocol/render-messages.js';
import { createRenderHost, type RenderHost } from './render-host.js';
import type { RenderRequest, WorkerRenderSummary } from './render-request.js';
import { FakeRenderWorker } from '../testing/fake-render-worker.js';
import type { RenderWorkerPort } from './worker-render.js';

const RATE = expectSuccess(sampleRate(48_000));
const IN = expectSuccess(nodeId('in'));
const OUT = expectSuccess(nodeId('out'));
const MONITOR = expectSuccess(nodeId('monitor'));

/** input → output and monitor, both stereo. */
const GRAPH: GraphDescriptor = graphOf(
  [
    nodeOf('in', BuiltInNodeType.GraphInput, StandardLayouts.stereo, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, StandardLayouts.stereo, { inputs: ['in'] }),
    nodeOf('monitor', BuiltInNodeType.Output, StandardLayouts.stereo, { inputs: ['in'] }),
  ],
  [wire('in.out', 'out.in'), wire('in.out', 'monitor.in')],
);

/** A timer the test fires. */
function playedTimers() {
  const timers: { callback: () => void; milliseconds: number; cancelled: boolean }[] = [];
  return {
    timers,
    schedule: (callback: () => void, milliseconds: number) => {
      const timer = { callback, milliseconds, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A sink that keeps each block and settles each write when the test says. */
function heldSink() {
  const blocks: AudioFrameBlock[] = [];
  const pending: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const sink: RenderSink = {
    write: (block) =>
      new Promise<void>((resolve, reject) => {
        blocks.push(block);
        pending.push({ resolve, reject });
      }),
  };
  return { sink, blocks, pending };
}

function immediateSink(): RenderSink & { readonly blocks: AudioFrameBlock[] } {
  const blocks: AudioFrameBlock[] = [];
  return {
    blocks,
    write: (block) => {
      blocks.push(block);
      return Promise.resolve();
    },
  };
}

function scheduler(concurrency = 2): PriorityScheduler {
  return expectSuccess(
    createPriorityScheduler({ concurrency, backgroundConcurrencyWhileInteractive: 1 }),
  );
}

function request(channels: readonly Float32Array[] = []): RenderRequest {
  return {
    graph: GRAPH,
    sampleRate: RATE,
    range: { start: expectSuccess(sampleCount(0)), length: expectSuccess(sampleCount(4)) },
    chunkFrames: 2,
    quality: MAXIMUM_RENDER_QUALITY,
    sources:
      channels.length === 0
        ? []
        : [{ node: IN, kind: PcmDescriptionKind.Pcm, sampleRate: RATE, channels }],
  };
}

function done(jobId: string): FromRenderWorker {
  return {
    kind: FromRenderWorkerKind.Done,
    jobId,
    frames: expectSuccess(sampleCount(4)),
    latencyTrimmed: [
      [OUT, expectSuccess(sampleCount(0))],
      [MONITOR, expectSuccess(sampleCount(0))],
    ],
    conversions: [],
    dsp: DspImplementation.Reference,
    dspFallbackReason: 'None was compiled.',
  };
}

function chunk(jobId: string, node = OUT, frames = 2): FromRenderWorker {
  return {
    kind: FromRenderWorkerKind.Chunk,
    jobId,
    node,
    channels: [new Float32Array(frames).fill(0.5), new Float32Array(frames).fill(-0.5)],
  };
}

/** A host over played workers, each kept in the order the host made them. */
function hostUnderTest(concurrency = 2) {
  const workers: FakeRenderWorker[] = [];
  const timers = playedTimers();
  const jobs = scheduler(concurrency);
  const host: RenderHost = createRenderHost({
    createWorker: () => {
      const worker = new FakeRenderWorker();
      workers.push(worker);
      return worker;
    },
    scheduler: jobs,
    dsp: { kind: DspDeliveryKind.Unavailable, reason: 'None was compiled.' },
    schedule: timers.schedule,
  });
  return { host, workers, timers, scheduler: jobs };
}

/** The worker the host made for the render it started last. */
function lastWorker(workers: readonly FakeRenderWorker[]): FakeRenderWorker {
  const worker = workers.at(-1);
  if (worker === undefined) throw new Error('The host made no worker.');
  return worker;
}

async function settled(
  rendering: Promise<DomainResult<WorkerRenderSummary>>,
): Promise<DomainResult<WorkerRenderSummary> | Error> {
  try {
    return await rendering;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
}

describe('the render host', () => {
  it('can be given a real worker, as the port it uses', () => {
    expectTypeOf<Worker>().toExtend<RenderWorkerPort>();
  });

  it('posts the render with each source buffer transferred once, and the module’s reason', async () => {
    const { host, workers } = hostUnderTest();
    const shared = new ArrayBuffer(32);
    const left = new Float32Array(shared, 0, 4);
    const right = new Float32Array(shared, 16, 4);

    void host.render(request([left, right]), {
      priority: JobPriority.Foreground,
      sinks: new Map([
        [OUT, immediateSink()],
        [MONITOR, immediateSink()],
      ]),
    });
    await idle();

    const [posted] = lastWorker(workers).received;
    expect(posted?.message).toMatchObject({
      kind: ToRenderWorkerKind.Render,
      jobId: 'render-1',
      chunkFrames: 2,
      resamplingQuality: MAXIMUM_RENDER_QUALITY.resampling,
      dsp: { kind: DspDeliveryKind.Unavailable, reason: 'None was compiled.' },
    });
    expect(posted?.transfer).toEqual([shared]);
  });

  it('writes each chunk to its sink in order, answers once each is written, and resolves on done', async () => {
    const { host, workers } = hostUnderTest();
    const out = heldSink();
    const monitor = immediateSink();
    const progress: RenderProgress[] = [];

    const rendering = host.render(request(), {
      priority: JobPriority.Foreground,
      onProgress: (reported) => progress.push(reported),
      sinks: new Map<NodeId, RenderSink>([
        [OUT, out.sink],
        [MONITOR, monitor],
      ]),
    });
    await idle();
    const worker = lastWorker(workers);
    worker.reply(chunk(worker.jobId, OUT, 2));
    worker.reply(chunk(worker.jobId, MONITOR, 2));
    worker.reply({
      kind: FromRenderWorkerKind.Progress,
      jobId: worker.jobId,
      framesRendered: 2,
      framesTotal: 4,
    });
    worker.reply(chunk(worker.jobId, OUT, 2));
    await idle();

    // The first write is still settling: nothing is answered, nothing after it written.
    expect(worker.kinds).toEqual([ToRenderWorkerKind.Render]);
    expect(out.blocks).toHaveLength(1);
    expect(monitor.blocks).toHaveLength(0);
    expect(progress).toEqual([{ framesRendered: 2, framesTotal: 4 }]);

    out.pending[0]?.resolve();
    await idle();
    expect(worker.kinds).toEqual([
      ToRenderWorkerKind.Render,
      ToRenderWorkerKind.ChunkTaken,
      ToRenderWorkerKind.ChunkTaken,
    ]);
    expect(out.blocks).toHaveLength(2);

    worker.reply(done(worker.jobId));
    await idle();
    // Done is not the end while a chunk is still being written.
    expect(worker.terminated).toBe(false);

    out.pending[1]?.resolve();
    const result = expectSuccess(await rendering);
    expect(result).toEqual({
      frames: 4,
      latencyTrimmed: new Map([
        [OUT, 0],
        [MONITOR, 0],
      ]),
      conversions: [],
      dsp: DspImplementation.Reference,
      dspFallbackReason: 'None was compiled.',
    });
    expect(out.blocks[0]).toMatchObject({ layout: StandardLayouts.stereo, sampleRate: RATE });
    expect(worker.terminated).toBe(true);
    expect(worker.listening).toBe(0);
  });

  it('refuses a render with a sink left unbound before it starts a worker', async () => {
    const { host, workers } = hostUnderTest();

    const result = await host.render(request(), {
      priority: JobPriority.Foreground,
      sinks: new Map([[OUT, immediateSink()]]),
    });

    expect(expectFailureCode(result)).toBe('render.sink-unbound');
    expect(result.ok ? undefined : result.failures[0].details).toEqual({ node: 'monitor' });
    expect(workers).toHaveLength(0);
  });

  describe('fails the render, and terminates its worker,', () => {
    const sinks = () =>
      new Map([
        [OUT, immediateSink()],
        [MONITOR, immediateSink()],
      ]);

    it.each([
      [
        'with every reason the worker gives',
        (worker: FakeRenderWorker) => {
          worker.reply({
            kind: FromRenderWorkerKind.Failed,
            jobId: worker.jobId,
            failures: [
              failure('render.graph-refused', FailureKind.Rejected, 'The graph has no sink.'),
              failure('render.worker-busy', FailureKind.Conflict, 'This worker is busy.'),
            ],
          });
        },
        [
          ['render.graph-refused', FailureKind.Rejected],
          ['render.worker-busy', FailureKind.Conflict],
        ],
      ],
      [
        'when the worker could not read what it was sent',
        (worker: FakeRenderWorker) => {
          worker.reply({
            kind: FromRenderWorkerKind.Refused,
            failures: [
              failure(
                'protocol.render-message-malformed',
                FailureKind.Rejected,
                'The kind is wrong.',
              ),
            ],
          });
        },
        [['protocol.render-message-malformed', FailureKind.Rejected]],
      ],
      [
        'on a reply it cannot read',
        (worker: FakeRenderWorker) => {
          worker.reply({ kind: 'done', jobId: worker.jobId });
        },
        [['render.worker-failed', FailureKind.Unrecoverable]],
      ],
      [
        'on a reply for another job',
        (worker: FakeRenderWorker) => {
          worker.reply(done('render-99'));
        },
        [['render.worker-failed', FailureKind.Unrecoverable]],
      ],
      [
        'on audio for a node with no sink',
        (worker: FakeRenderWorker) => {
          worker.reply(chunk(worker.jobId, IN));
        },
        [['render.worker-failed', FailureKind.Unrecoverable]],
      ],
      [
        'on a message that could not be received',
        (worker: FakeRenderWorker) => {
          worker.unreadable();
        },
        [['render.worker-failed', FailureKind.Unrecoverable]],
      ],
    ])('%s', async (_case, act, codes) => {
      const { host, workers } = hostUnderTest();
      const rendering = host.render(request(), {
        priority: JobPriority.Foreground,
        sinks: sinks(),
      });
      await idle();
      const worker = lastWorker(workers);

      act(worker);
      const result = await rendering;

      expect(
        result.ok ? [] : result.failures.map((problem) => [problem.code, problem.kind]),
      ).toEqual(codes);
      expect(worker.terminated).toBe(true);
      expect(worker.listening).toBe(0);
    });

    it('with the worker’s failures as it stated them, details and causes too', async () => {
      const { host, workers } = hostUnderTest();
      const rendering = host.render(request(), {
        priority: JobPriority.Foreground,
        sinks: sinks(),
      });
      await idle();
      const worker = lastWorker(workers);
      const stated = failure('render.source-unplaced', FailureKind.Rejected, 'Bound to nothing.', {
        details: { node: 'ahead' },
        cause: failure('graph.node-id-invalid', FailureKind.Rejected, 'Not an identifier.'),
      });

      worker.reply({ kind: FromRenderWorkerKind.Failed, jobId: worker.jobId, failures: [stated] });

      expect(await rendering).toEqual({ ok: false, failures: [stated] });
    });

    it('naming why a reply could not be read', async () => {
      const { host, workers } = hostUnderTest();
      const rendering = host.render(request(), {
        priority: JobPriority.Foreground,
        sinks: sinks(),
      });
      await idle();
      const worker = lastWorker(workers);

      worker.reply({ kind: 'done', jobId: worker.jobId });
      const result = await rendering;

      expect(result.ok ? undefined : result.failures[0].cause?.code).toBe(
        'protocol.render-reply-malformed',
      );
    });

    it('when the worker throws, with its message', async () => {
      const { host, workers } = hostUnderTest();
      const rendering = host.render(request(), {
        priority: JobPriority.Foreground,
        sinks: sinks(),
      });
      await idle();
      const worker = lastWorker(workers);

      const event = worker.fail('Out of memory.');
      const result = await rendering;

      expect(expectFailureCode(result)).toBe('render.worker-failed');
      expect(result.ok ? '' : result.failures[0].summary).toContain('Out of memory.');
      expect(event.defaultPrevented).toBe(true);
      expect(worker.terminated).toBe(true);
    });

    it('rejecting with the error a sink refused a chunk with', async () => {
      const { host, workers } = hostUnderTest();
      const full = new Error('The disk is full.');
      const rendering = settled(
        host.render(request(), {
          priority: JobPriority.Foreground,
          sinks: new Map<NodeId, RenderSink>([
            [OUT, { write: () => Promise.reject(full) }],
            [MONITOR, immediateSink()],
          ]),
        }),
      );
      await idle();
      const worker = lastWorker(workers);

      worker.reply(chunk(worker.jobId));

      expect(await rendering).toBe(full);
      expect(worker.kinds).toEqual([ToRenderWorkerKind.Render]);
      expect(worker.terminated).toBe(true);
    });
  });

  describe('when the caller cancels', () => {
    it('asks the worker to stop, and rejects once it has', async () => {
      const { host, workers, timers } = hostUnderTest();
      const cancellation = createCancellationSource();
      const rendering = settled(
        host.render(request(), {
          priority: JobPriority.Foreground,
          signal: cancellation.signal,
          sinks: new Map([
            [OUT, immediateSink()],
            [MONITOR, immediateSink()],
          ]),
        }),
      );
      await idle();
      const worker = lastWorker(workers);

      cancellation.cancel();
      expect(worker.kinds).toEqual([ToRenderWorkerKind.Render, ToRenderWorkerKind.Cancel]);
      expect(worker.terminated).toBe(false);
      worker.reply({ kind: FromRenderWorkerKind.Cancelled, jobId: worker.jobId });

      expect(await rendering).toBeInstanceOf(Cancelled);
      expect(worker.terminated).toBe(true);
      expect(timers.timers.map((timer) => timer.cancelled)).toEqual([true]);
    });

    it('terminates a worker that does not answer within the grace it is given', async () => {
      const { host, workers, timers } = hostUnderTest();
      const cancellation = createCancellationSource();
      const rendering = settled(
        host.render(request(), {
          priority: JobPriority.Foreground,
          signal: cancellation.signal,
          sinks: new Map([
            [OUT, immediateSink()],
            [MONITOR, immediateSink()],
          ]),
        }),
      );
      await idle();
      const worker = lastWorker(workers);

      cancellation.cancel();
      const [grace] = timers.timers;
      expect(grace?.milliseconds).toBeGreaterThan(0);
      expect(worker.terminated).toBe(false);
      grace?.callback();

      expect(await rendering).toBeInstanceOf(Cancelled);
      expect(worker.terminated).toBe(true);
      expect(worker.listening).toBe(0);
    });

    it('withdraws a render still queued, without starting a worker for it', async () => {
      const { host, workers } = hostUnderTest(1);
      const sinks = () =>
        new Map([
          [OUT, immediateSink()],
          [MONITOR, immediateSink()],
        ]);
      void host.render(request(), { priority: JobPriority.Foreground, sinks: sinks() });
      const cancellation = createCancellationSource();
      const queued = settled(
        host.render(request(), {
          priority: JobPriority.Foreground,
          signal: cancellation.signal,
          sinks: sinks(),
        }),
      );
      await idle();

      cancellation.cancel();

      expect(await queued).toBeInstanceOf(Cancelled);
      expect(workers).toHaveLength(1);
    });
  });

  it('starts a foreground render before a background one queued ahead of it', async () => {
    const { host, workers } = hostUnderTest(1);
    const sinks = () =>
      new Map([
        [OUT, immediateSink()],
        [MONITOR, immediateSink()],
      ]);
    const first = host.render(request(), { priority: JobPriority.Foreground, sinks: sinks() });
    const background = host.render(request(), {
      priority: JobPriority.Background,
      sinks: sinks(),
    });
    const foreground = host.render(request(), {
      priority: JobPriority.Foreground,
      sinks: sinks(),
    });
    await idle();
    expect(workers.map((worker) => worker.jobId)).toEqual(['render-1']);

    lastWorker(workers).reply(done('render-1'));
    await first;
    await idle();
    expect(workers.map((worker) => worker.jobId)).toEqual(['render-1', 'render-3']);

    lastWorker(workers).reply(done('render-3'));
    await foreground;
    await idle();
    lastWorker(workers).reply(done('render-2'));
    await background;

    expect(workers.map((worker) => worker.jobId)).toEqual(['render-1', 'render-3', 'render-2']);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  describe('under the priority policy the person chose', () => {
    const sinks = () =>
      new Map([
        [OUT, immediateSink()],
        [MONITOR, immediateSink()],
      ]);

    it('starts renders in the order they were asked for under the throughput policy', async () => {
      const { host, workers, scheduler: jobs } = hostUnderTest(1);
      jobs.setPolicy(SchedulingPolicy.Throughput);
      const first = host.render(request(), { priority: JobPriority.Foreground, sinks: sinks() });
      const background = host.render(request(), {
        priority: JobPriority.Background,
        sinks: sinks(),
      });
      const foreground = host.render(request(), {
        priority: JobPriority.Foreground,
        sinks: sinks(),
      });
      await idle();

      lastWorker(workers).reply(done('render-1'));
      await first;
      await idle();
      // Interactive first would start render-3 here, as the test above shows.
      expect(workers.map((worker) => worker.jobId)).toEqual(['render-1', 'render-2']);

      lastWorker(workers).reply(done('render-2'));
      await background;
      await idle();
      lastWorker(workers).reply(done('render-3'));
      await foreground;
    });

    it('holds background renders to their share while a person plays, unless throughput is chosen', async () => {
      const { host, workers, scheduler: jobs } = hostUnderTest(2);
      jobs.setInteractive(true);
      const renders = [1, 2].map(() =>
        host.render(request(), { priority: JobPriority.Background, sinks: sinks() }),
      );
      await idle();
      expect(workers).toHaveLength(1);

      jobs.setPolicy(SchedulingPolicy.Throughput);
      await idle();
      expect(workers.map((worker) => worker.jobId)).toEqual(['render-1', 'render-2']);

      for (const worker of workers) worker.reply(done(worker.jobId));
      await Promise.all(renders);
    });
  });
});
