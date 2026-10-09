/**
 * The packet's acceptance "UI remains responsive during representative
 * offline renders", proved from the structure of the work rather than from a
 * clock, which a loaded test machine would make flaky:
 *
 * 1. the main thread runs no DSP: per chunk, the host writes the block it was
 *    posted, unchanged and uncopied, and answers once;
 * 2. the worker yields to its host between every chunk, so a `cancel` sent
 *    after the first progress report is read before the next chunk renders;
 * 3. no chunk is larger than the render asked for, so neither side ever
 *    handles more than a chunk at a time.
 *
 * The representative render: 30 s of stereo at 48 kHz from a 44.1 kHz
 * recording, converted at maximum quality, in chunks of half a second.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  sampleCount,
  sampleRate,
  StandardLayouts,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  DspImplementation,
  JobPriority,
  ResamplingQuality,
  createPriorityScheduler,
  type AudioFrameBlock,
  PcmDescriptionKind,
} from '@audiogubbins/audio-engine';
import {
  dspModuleBytes,
  graphOf,
  named,
  NO_CHAIN_PROCESSING,
  nodeOf,
  wire,
} from '@audiogubbins/audio-engine/testing';

import { DspDeliveryKind } from '../dsp/dsp-delivery.js';
import {
  FromRenderWorkerKind,
  ToRenderWorkerKind,
  type FromRenderWorker,
  type ToRenderWorker,
} from '../protocol/render-messages.js';
import { FakeRenderWorker } from '../testing/fake-render-worker.js';
import { createRenderHost } from './render-host.js';
import { RenderWorkerCore } from './render-worker-core.js';

const RENDER_RATE = expectSuccess(sampleRate(48_000));
const RECORDED_RATE = expectSuccess(sampleRate(44_100));
const STEREO: ChannelLayout = StandardLayouts.stereo;
const SECONDS = 30;
const CHUNK_FRAMES = RENDER_RATE / 2;
const RENDER_FRAMES = SECONDS * RENDER_RATE;
const CHUNKS = RENDER_FRAMES / CHUNK_FRAMES;
const JOB = 'render-1';

/**
 * The time the test that renders the whole recording is allowed. Converting
 * thirty seconds at maximum quality takes about three seconds of processor
 * time on its own, past the default of five on a busy machine. The test holds
 * the shape of the work, never its speed, so the bound only stops a hang.
 */
const WHOLE_RENDER_MS = 60_000;

const IN = named('in');
const OUT = named('out');

const GRAPH: GraphDescriptor = graphOf(
  [
    nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
  ],
  [wire('in.out', 'out.in')],
);

/** 30 s of a recording at 44.1 kHz, each channel its own sawtooth. */
function recording(): Float32Array[] {
  const frames = SECONDS * RECORDED_RATE;
  return STEREO.roles.map((_, channel) =>
    Float32Array.from(
      { length: frames },
      (__, frame) => ((frame % 2_000) - 1_000) / (4_000 + channel),
    ),
  );
}

function representativeRender(module: WebAssembly.Module | undefined): ToRenderWorker {
  return {
    kind: ToRenderWorkerKind.Render,
    jobId: JOB,
    graph: GRAPH,
    sampleRate: RENDER_RATE,
    range: {
      start: expectSuccess(sampleCount(0)),
      length: expectSuccess(sampleCount(RENDER_FRAMES)),
    },
    chunkFrames: CHUNK_FRAMES,
    quality: MAXIMUM_QUALITY,
    sources: [
      { node: IN, kind: PcmDescriptionKind.Pcm, sampleRate: RECORDED_RATE, channels: recording() },
    ],
    coefficientBudgetBytes: undefined,
    dsp:
      module === undefined
        ? { kind: DspDeliveryKind.Unavailable, reason: 'The reference path, for this test.' }
        : { kind: DspDeliveryKind.Available, module },
  };
}

/** Lets every promise waiting run, as an idle event loop would. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A worker core whose yields wait on the test, with everything it posts kept. */
function workerUnderTest() {
  const posted: FromRenderWorker[] = [];
  const yields: (() => void)[] = [];
  const core = new RenderWorkerCore({
    post: (message) => {
      posted.push(message);
    },
    yieldToHost: () =>
      new Promise((resolve) => {
        yields.push(resolve);
      }),
    // A fault fails the run, as an unhandled rejection, rather than a job.
    processing: NO_CHAIN_PROCESSING,
    reportFault: (error) => {
      throw error;
    },
  });
  const count = (kind: FromRenderWorker['kind']): number =>
    posted.filter((message) => message.kind === kind).length;
  return { posted, yields, core, count };
}

describe('a representative offline render leaves the interface responsive', () => {
  it.each([
    ['the reference path', () => Promise.resolve(undefined)],
    ['the WebAssembly module', () => WebAssembly.compile(dspModuleBytes())],
  ])(
    'on %s, the worker reads a cancel sent after the first progress before it renders another chunk',
    async (_path, compile) => {
      const worker = workerUnderTest();
      worker.core.receive(representativeRender(await compile()));

      // Runs the worker until it first hands its thread back.
      while (worker.yields.length === 0) await idle();
      expect(worker.count(FromRenderWorkerKind.Progress)).toBe(1);

      worker.core.receive({ kind: ToRenderWorkerKind.Cancel, jobId: JOB });
      worker.core.receive({ kind: ToRenderWorkerKind.ChunkTaken, jobId: JOB });
      worker.yields.shift()?.();
      while (worker.count(FromRenderWorkerKind.Cancelled) === 0) {
        await idle();
        worker.yields.shift()?.();
      }

      // One chunk before the cancel, and none after it.
      expect(worker.count(FromRenderWorkerKind.Chunk)).toBe(1);
      expect(worker.count(FromRenderWorkerKind.Progress)).toBe(1);
      expect(worker.posted.at(-1)).toEqual({ kind: FromRenderWorkerKind.Cancelled, jobId: JOB });
    },
  );

  it(
    'the worker yields between every chunk, and no chunk exceeds the frames asked for',
    async () => {
      const worker = workerUnderTest();
      worker.core.receive(representativeRender(await WebAssembly.compile(dspModuleBytes())));

      // The chunks rendered each time the worker hands its thread back.
      const renderedAtEachYield: number[] = [];
      while (worker.count(FromRenderWorkerKind.Done) === 0) {
        await idle();
        const taken = worker.count(FromRenderWorkerKind.Chunk);
        for (let one = 0; one < taken; one += 1) {
          worker.core.receive({ kind: ToRenderWorkerKind.ChunkTaken, jobId: JOB });
        }
        if (worker.yields.length > 0) {
          renderedAtEachYield.push(worker.count(FromRenderWorkerKind.Progress));
          worker.yields.shift()?.();
        }
      }

      expect(renderedAtEachYield).toEqual(Array.from({ length: CHUNKS }, (_, index) => index + 1));
      const chunks = worker.posted.flatMap((message) =>
        message.kind === FromRenderWorkerKind.Chunk ? [message] : [],
      );
      expect(chunks).toHaveLength(CHUNKS);
      for (const chunk of chunks) {
        expect(chunk.channels).toHaveLength(2);
        for (const channel of chunk.channels)
          expect(channel.length).toBeLessThanOrEqual(CHUNK_FRAMES);
      }
      expect(chunks.reduce((total, chunk) => total + (chunk.channels[0]?.length ?? 0), 0)).toBe(
        RENDER_FRAMES,
      );
      expect(worker.posted.at(-1)).toMatchObject({
        kind: FromRenderWorkerKind.Done,
        dsp: DspImplementation.WebAssembly,
        conversions: [
          { node: IN, from: RECORDED_RATE, to: RENDER_RATE, quality: ResamplingQuality.Maximum },
        ],
      });
    },
    WHOLE_RENDER_MS,
  );

  it('the main thread writes each posted chunk as it came and answers once, running no DSP', async () => {
    const scheduler = expectSuccess(
      createPriorityScheduler({ concurrency: 1, backgroundConcurrencyWhileInteractive: 1 }),
    );
    const bytes = dspModuleBytes();
    const worker = new FakeRenderWorker();
    const toWorker = worker.received;
    const written: AudioFrameBlock[] = [];
    const host = createRenderHost({
      createWorker: () => worker,
      scheduler,
      // The host is given a compiled module to pass on, and no DSP to run.
      dsp: {
        kind: DspDeliveryKind.Available,
        module: { bytes, module: await WebAssembly.compile(bytes) },
      },
      schedule: () => () => undefined,
    });
    const reply = (message: FromRenderWorker): void => {
      worker.reply(message);
    };

    const rendering = host.render(
      {
        graph: GRAPH,
        sampleRate: RENDER_RATE,
        range: {
          start: expectSuccess(sampleCount(0)),
          length: expectSuccess(sampleCount(RENDER_FRAMES)),
        },
        chunkFrames: CHUNK_FRAMES,
        quality: MAXIMUM_QUALITY,
        sources: [
          {
            node: IN,
            kind: PcmDescriptionKind.Pcm,
            sampleRate: RECORDED_RATE,
            channels: recording(),
          },
        ],
      },
      {
        priority: JobPriority.Foreground,
        sinks: new Map<NodeId, { write: (block: AudioFrameBlock) => Promise<void> }>([
          [
            OUT,
            {
              write: (block) => {
                written.push(block);
                return Promise.resolve();
              },
            },
          ],
        ]),
      },
    );
    await idle();
    expect(toWorker).toHaveLength(1);
    expect(toWorker[0]?.message).toMatchObject({ kind: ToRenderWorkerKind.Render });

    const posted: Float32Array[][] = [];
    for (let chunk = 0; chunk < CHUNKS; chunk += 1) {
      const channels = [new Float32Array(CHUNK_FRAMES), new Float32Array(CHUNK_FRAMES)];
      posted.push(channels);
      reply({ kind: FromRenderWorkerKind.Chunk, jobId: JOB, node: OUT, channels });
      await idle();
      // Per chunk: one write of the arrays as posted, and one answer.
      expect(written).toHaveLength(chunk + 1);
      expect(toWorker).toHaveLength(chunk + 2);
      expect(toWorker.at(-1)?.message).toEqual({ kind: ToRenderWorkerKind.ChunkTaken, jobId: JOB });
    }
    reply({
      kind: FromRenderWorkerKind.Done,
      jobId: JOB,
      frames: expectSuccess(sampleCount(RENDER_FRAMES)),
      latencyTrimmed: [[OUT, expectSuccess(sampleCount(0))]],
      conversions: [],
      dsp: DspImplementation.WebAssembly,
      dspFallbackReason: undefined,
    });

    expect((await rendering).ok).toBe(true);
    written.forEach((block, chunk) => {
      expect(block.channels[0]).toBe(posted[chunk]?.[0]);
      expect(block.channels[1]).toBe(posted[chunk]?.[1]);
    });
  });
});
