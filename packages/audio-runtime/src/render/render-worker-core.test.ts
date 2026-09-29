import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  StandardLayouts,
  sampleCount,
  sampleRate,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { GraphDescriptor } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  DspImplementation,
  MAXIMUM_RENDER_QUALITY,
  REFERENCE_DSP,
  ResamplingQuality,
  frameBlock,
  memorySource,
  renderOffline,
  toneSource,
  type CanonicalDsp,
  type PcmSource,
  type RenderSink,
} from '@audiogubbins/audio-engine';

import { scopeDsp } from '../dsp/dsp-instance.js';
import {
  FromRenderWorkerKind,
  SourceKind,
  ToRenderWorkerKind,
  type FromRenderWorker,
  type SourceDescription,
  type ToRenderWorker,
} from '../protocol/render-messages.js';
import { countingDsp } from '../testing/counting-dsp.js';
import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import { distinctChannels, graphOf, named, nodeOf, wire } from '../testing/render-graphs.js';
import { RenderWorkerCore, type DspChooser } from './render-worker-core.js';

const RATE = expectSuccess(sampleRate(48_000));
const CD_RATE = expectSuccess(sampleRate(44_100));
const STEREO = StandardLayouts.stereo;
const LOOKAHEAD = 37;
/** The chunks a worker may have in flight, as `chunk-window.ts` states them. */
const WINDOW = 2;

function lookaheadGraph(layout: ChannelLayout): GraphDescriptor {
  return graphOf(
    [
      nodeOf('in', BuiltInNodeType.GraphInput, layout, { outputs: ['out'] }),
      nodeOf(
        'ahead',
        BuiltInNodeType.Delay,
        layout,
        { inputs: ['in'], outputs: ['out'] },
        { frames: LOOKAHEAD, 'as-latency': true },
      ),
      nodeOf('out', BuiltInNodeType.Output, layout, { inputs: ['in'] }),
      nodeOf('dry', BuiltInNodeType.Output, layout, { inputs: ['in'] }),
    ],
    [wire('in.out', 'ahead.in'), wire('ahead.out', 'out.in'), wire('in.out', 'dry.in')],
  );
}

function renderOf(
  graph: GraphDescriptor,
  sources: readonly SourceDescription[],
  options: {
    readonly jobId?: string;
    readonly length?: number;
    readonly chunkFrames?: number;
    readonly module?: WebAssembly.Module | undefined;
  } = {},
): ToRenderWorker {
  return {
    kind: ToRenderWorkerKind.Render,
    jobId: options.jobId ?? 'render-1',
    graph,
    sampleRate: RATE,
    range: {
      start: expectSuccess(sampleCount(0)),
      length: expectSuccess(sampleCount(options.length ?? 2_500)),
    },
    chunkFrames: options.chunkFrames ?? 700,
    resamplingQuality: MAXIMUM_RENDER_QUALITY.resampling,
    sources,
    dspModule: options.module,
    dspUnavailable: options.module === undefined ? 'No module, for this test.' : undefined,
  };
}

const ENDINGS: ReadonlySet<FromRenderWorker['kind']> = new Set([
  FromRenderWorkerKind.Done,
  FromRenderWorkerKind.Failed,
  FromRenderWorkerKind.Cancelled,
]);

/** Lets every promise the core is waiting on run, as a worker's idle event loop would. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * A render worker core with the main thread played by the test: every post
 * is kept, and every yield waits until the test resumes it.
 */
class WorkerUnderTest {
  readonly posted: FromRenderWorker[] = [];
  readonly transfers: Transferable[][] = [];
  readonly #yields: (() => void)[] = [];
  #acked = 0;
  #mostInFlight = 0;

  readonly core: RenderWorkerCore;

  constructor(chooseDsp?: DspChooser) {
    this.core = new RenderWorkerCore(
      {
        post: (message, transfer) => {
          this.posted.push(message);
          this.transfers.push(transfer);
          this.#mostInFlight = Math.max(this.#mostInFlight, this.inFlight);
        },
        yieldToHost: () =>
          new Promise((resolve) => {
            this.#yields.push(resolve);
          }),
      },
      chooseDsp,
    );
  }

  get chunksPosted(): number {
    return this.posted.filter((message) => message.kind === FromRenderWorkerKind.Chunk).length;
  }

  get inFlight(): number {
    return this.chunksPosted - this.#acked;
  }

  get mostInFlight(): number {
    return this.#mostInFlight;
  }

  get ending(): FromRenderWorker | undefined {
    return this.endingOf('render-1');
  }

  endingOf(jobId: string): FromRenderWorker | undefined {
    return this.posted.find(
      (message) => ENDINGS.has(message.kind) && 'jobId' in message && message.jobId === jobId,
    );
  }

  get yielding(): boolean {
    return this.#yields.length > 0;
  }

  resume(): void {
    this.#yields.shift()?.();
  }

  ack(jobId = 'render-1'): void {
    this.#acked += 1;
    this.core.receive({ kind: ToRenderWorkerKind.ChunkTaken, jobId });
  }

  /** Takes every chunk and resumes every yield until the job ends. */
  async runToEnd(jobId = 'render-1'): Promise<FromRenderWorker> {
    for (let turn = 0; turn < 10_000; turn += 1) {
      await idle();
      const ended = this.endingOf(jobId);
      if (ended !== undefined) return ended;
      while (this.inFlight > 0) this.ack(jobId);
      this.resume();
    }
    throw new Error('The render never ended.');
  }

  /** Every frame posted for `node`, one array per channel. */
  channelsOf(node: string): Float32Array[] {
    const chunks = this.posted.flatMap((message) =>
      message.kind === FromRenderWorkerKind.Chunk && message.node === named(node)
        ? [message.channels]
        : [],
    );
    return (chunks[0] ?? []).map((_, channel) => {
      const pieces = chunks.map((chunk) => chunk[channel] ?? new Float32Array(0));
      const whole = new Float32Array(pieces.reduce((total, piece) => total + piece.length, 0));
      let at = 0;
      for (const piece of pieces) {
        whole.set(piece, at);
        at += piece.length;
      }
      return whole;
    });
  }
}

/** A sink that keeps a copy of every frame written to it. */
function collecting(): RenderSink & { readonly channels: Float32Array[][] } {
  const channels: Float32Array[][] = [];
  return {
    channels,
    write: (block) => {
      block.channels.forEach((channel, index) => {
        (channels[index] ??= []).push(channel.slice(0, block.frames));
      });
      return Promise.resolve();
    },
  };
}

function joined(pieces: readonly Float32Array[][]): Float32Array[] {
  return pieces.map((channel) => {
    const whole = new Float32Array(channel.reduce((total, piece) => total + piece.length, 0));
    let at = 0;
    for (const piece of channel) {
      whole.set(piece, at);
      at += piece.length;
    }
    return whole;
  });
}

/** The engine's own render of the same job, on the thread the test runs on. */
async function engineRender(
  graph: GraphDescriptor,
  source: PcmSource,
  dsp: CanonicalDsp,
  length = 2_500,
  chunkFrames = 700,
): Promise<{ readonly out: Float32Array[]; readonly dry: Float32Array[] }> {
  const out = collecting();
  const dry = collecting();
  expectSuccess(
    await renderOffline(
      {
        graph,
        sampleRate: RATE,
        sources: new Map([[named('in'), source]]),
        sinks: new Map([
          [named('out'), out],
          [named('dry'), dry],
        ]),
        range: { start: expectSuccess(sampleCount(0)), length: expectSuccess(sampleCount(length)) },
        quality: MAXIMUM_RENDER_QUALITY,
        chunkFrames,
      },
      dsp,
      BUILT_IN_NODES,
    ),
  );
  source.release();
  return { out: joined(out.channels), dry: joined(dry.channels) };
}

function pcmAt(rate: SampleRate, channels: readonly Float32Array[]): SourceDescription {
  return { node: named('in'), kind: SourceKind.Pcm, sampleRate: rate, channels };
}

function memoryAt(rate: SampleRate, layout: ChannelLayout, channels: Float32Array[]): PcmSource {
  return expectSuccess(memorySource(expectSuccess(frameBlock(layout, rate, channels))));
}

const PATHS = [
  ['the reference path', () => Promise.resolve(undefined), DspImplementation.Reference],
  [
    'the WebAssembly module',
    () => WebAssembly.compile(dspModuleBytes()),
    DspImplementation.WebAssembly,
  ],
] as const;

describe('a render worker', () => {
  describe.each(PATHS)('on %s', (_path, compile, implementation) => {
    it('runs on that path', async () => {
      expect(scopeDsp(await compile(), 'the reference path').dsp.implementation).toBe(
        implementation,
      );
    });

    it('posts chunks that are, joined, the engine’s own render to the bit', async () => {
      const module = await compile();
      const dsp = scopeDsp(module, 'the reference path').dsp;
      const worker = new WorkerUnderTest();

      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))], {
          module,
        }),
      );
      const ended = await worker.runToEnd();
      const engine = await engineRender(
        lookaheadGraph(STEREO),
        memoryAt(RATE, STEREO, distinctChannels(STEREO, 3_000)),
        dsp,
      );

      expect(ended).toEqual({
        kind: FromRenderWorkerKind.Done,
        jobId: 'render-1',
        frames: 2_500,
        latencyTrimmed: [
          [named('out'), LOOKAHEAD],
          [named('dry'), 0],
        ],
        conversions: [],
        dsp: module === undefined ? DspImplementation.Reference : DspImplementation.WebAssembly,
        dspFallbackReason: module === undefined ? 'No module, for this test.' : undefined,
      });
      expect(worker.channelsOf('out')).toEqual(engine.out);
      expect(worker.channelsOf('dry')).toEqual(engine.dry);
      expect(worker.channelsOf('out')[0]).toHaveLength(2_500);
    });

    it('renders a tone it makes itself as the engine does', async () => {
      const module = await compile();
      const dsp = scopeDsp(module, 'the reference path').dsp;
      const tone = { sampleRate: RATE, frequency: 997, amplitude: 0.5 } as const;
      const worker = new WorkerUnderTest();

      worker.core.receive(
        renderOf(
          lookaheadGraph(STEREO),
          [
            {
              node: named('in'),
              kind: SourceKind.Tone,
              ...tone,
              frames: expectSuccess(sampleCount(2_000)),
            },
          ],
          { module },
        ),
      );
      await worker.runToEnd();
      const engine = await engineRender(
        lookaheadGraph(STEREO),
        expectSuccess(
          toneSource(dsp, { ...tone, layout: STEREO, length: expectSuccess(sampleCount(2_000)) }),
        ),
        dsp,
      );

      expect(worker.ending).toMatchObject({
        kind: FromRenderWorkerKind.Done,
        dsp: dsp.implementation,
      });
      expect(worker.channelsOf('out')).toEqual(engine.out);
      // A tone that ends before the range does is silent after it, not repeated.
      expect(
        worker
          .channelsOf('dry')[0]
          ?.subarray(2_000)
          .every((sample) => sample === 0),
      ).toBe(true);
    });

    it('converts recorded audio at another rate as the engine does, and says so', async () => {
      const module = await compile();
      const dsp = scopeDsp(module, 'the reference path').dsp;
      const worker = new WorkerUnderTest();

      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(CD_RATE, distinctChannels(STEREO, 3_000))], {
          module,
        }),
      );
      const ended = await worker.runToEnd();
      const engine = await engineRender(
        lookaheadGraph(STEREO),
        memoryAt(CD_RATE, STEREO, distinctChannels(STEREO, 3_000)),
        dsp,
      );

      expect(ended).toMatchObject({ dsp: dsp.implementation });
      expect(ended.kind === FromRenderWorkerKind.Done && ended.conversions).toEqual([
        { node: named('in'), from: CD_RATE, to: RATE, quality: ResamplingQuality.Maximum },
      ]);
      expect(worker.channelsOf('out')).toEqual(engine.out);
    });
  });

  it('renders a 5.1 source in the layout of the input’s port, every channel in its place', async () => {
    const layout = StandardLayouts.surround5_1;
    const worker = new WorkerUnderTest();

    worker.core.receive(
      renderOf(lookaheadGraph(layout), [pcmAt(RATE, distinctChannels(layout, 3_000))]),
    );
    await worker.runToEnd();
    const engine = await engineRender(
      lookaheadGraph(layout),
      memoryAt(RATE, layout, distinctChannels(layout, 3_000)),
      REFERENCE_DSP,
    );

    expect(worker.channelsOf('dry')).toHaveLength(6);
    expect(worker.channelsOf('dry')).toEqual(engine.dry);
  });

  it('transfers each chunk’s arrays, which are its own and not the renderer’s', async () => {
    const worker = new WorkerUnderTest();

    worker.core.receive(
      renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))]),
    );
    await worker.runToEnd();

    const chunks = worker.posted.flatMap((message, index) =>
      message.kind === FromRenderWorkerKind.Chunk ? [{ message, index }] : [],
    );
    const buffers = chunks.flatMap(({ message }) => message.channels.map((one) => one.buffer));
    expect(new Set(buffers).size).toBe(buffers.length);
    for (const { message, index } of chunks) {
      expect(worker.transfers[index]).toEqual(message.channels.map((one) => one.buffer));
    }
  });

  describe('holds the chunks in flight to the window', () => {
    it('sends no more than the window until the main thread takes one', async () => {
      const worker = new WorkerUnderTest();
      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))]),
      );

      for (let turn = 0; turn < 20; turn += 1) {
        await idle();
        worker.resume();
      }
      expect(worker.chunksPosted).toBe(WINDOW);

      worker.ack();
      for (let turn = 0; turn < 20; turn += 1) {
        await idle();
        worker.resume();
      }
      expect(worker.chunksPosted).toBe(WINDOW + 1);
      expect(worker.ending).toBeUndefined();
    });

    it('never has more than the window in flight over a whole render', async () => {
      const worker = new WorkerUnderTest();
      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))], {
          chunkFrames: 128,
        }),
      );

      // Takes a chunk only on every third turn, so the main thread is slower
      // than the worker throughout.
      for (let turn = 0; worker.ending === undefined; turn += 1) {
        await idle();
        if (turn % 3 === 0 && worker.inFlight > 0) worker.ack();
        worker.resume();
      }

      expect(worker.ending.kind).toBe(FromRenderWorkerKind.Done);
      expect(worker.chunksPosted).toBeGreaterThan(20);
      expect(worker.mostInFlight).toBe(WINDOW);
    });

    it('ignores a second answer for one chunk rather than opening a slot', async () => {
      const worker = new WorkerUnderTest();
      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))]),
      );
      for (let turn = 0; turn < 20; turn += 1) {
        await idle();
        worker.resume();
      }

      // Three answers for the two chunks sent: the third frees nothing.
      worker.ack();
      worker.ack();
      worker.ack();
      for (let turn = 0; turn < 20; turn += 1) {
        await idle();
        worker.resume();
      }

      expect(worker.chunksPosted).toBe(2 * WINDOW);
    });
  });

  describe('when cancelled', () => {
    it('stops between chunks and says it was cancelled', async () => {
      const worker = new WorkerUnderTest();
      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))], {
          chunkFrames: 128,
        }),
      );
      await idle();
      worker.ack();
      worker.ack();
      const sent = worker.chunksPosted;

      worker.core.receive({ kind: ToRenderWorkerKind.Cancel, jobId: 'render-1' });
      const ended = await worker.runToEnd();

      expect(ended).toEqual({ kind: FromRenderWorkerKind.Cancelled, jobId: 'render-1' });
      expect(worker.chunksPosted).toBe(sent);
    });

    it('stops while it waits for the main thread to take a chunk', async () => {
      const worker = new WorkerUnderTest();
      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))]),
      );
      for (let turn = 0; turn < 20; turn += 1) {
        await idle();
        worker.resume();
      }
      expect(worker.chunksPosted).toBe(WINDOW);

      worker.core.receive({ kind: ToRenderWorkerKind.Cancel, jobId: 'render-1' });
      await idle();

      expect(worker.ending).toEqual({ kind: FromRenderWorkerKind.Cancelled, jobId: 'render-1' });
    });

    it('ignores a cancellation for another job', async () => {
      const worker = new WorkerUnderTest();
      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))]),
      );

      worker.core.receive({ kind: ToRenderWorkerKind.Cancel, jobId: 'render-9' });

      expect((await worker.runToEnd()).kind).toBe(FromRenderWorkerKind.Done);
    });
  });

  describe('reports a render it cannot run', () => {
    it.each([
      [
        'a graph the engine refuses',
        'render.graph-refused',
        renderOf(
          graphOf([nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] })], []),
          [],
        ),
      ],
      [
        'a source bound to a node that is not an input',
        'render.source-unplaced',
        renderOf(lookaheadGraph(STEREO), [
          { ...pcmAt(RATE, distinctChannels(STEREO, 10)), node: named('ahead') },
        ]),
      ],
      [
        'recorded audio with fewer channels than its input',
        'pcm.block-channel-count-mismatch',
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(StandardLayouts.mono, 10))]),
      ],
      [
        'two sources for one input',
        'render.source-duplicated',
        renderOf(lookaheadGraph(STEREO), [
          pcmAt(RATE, distinctChannels(STEREO, 10)),
          pcmAt(RATE, distinctChannels(STEREO, 10)),
        ]),
      ],
      [
        'a tone louder than full scale',
        'pcm.tone-amplitude-out-of-range',
        renderOf(lookaheadGraph(STEREO), [
          {
            node: named('in'),
            kind: SourceKind.Tone,
            sampleRate: RATE,
            frequency: 440,
            amplitude: 2,
            frames: expectSuccess(sampleCount(10)),
          },
        ]),
      ],
      [
        'a chunk of no frames',
        'render.chunk-invalid',
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 10))], {
          chunkFrames: 0,
        }),
      ],
    ])('%s, with the engine’s code', async (_case, code, message) => {
      const worker = new WorkerUnderTest();

      worker.core.receive(message);
      const ended = await worker.runToEnd();

      expect(ended.kind).toBe(FromRenderWorkerKind.Failed);
      expect(ended.kind === FromRenderWorkerKind.Failed && ended.failures[0]).toMatchObject({
        code,
        kind: FailureKind.Rejected,
      });
      expect(worker.chunksPosted).toBe(0);
    });

    it('with every reason the engine gives, not only the first', async () => {
      const worker = new WorkerUnderTest();

      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [
          { ...pcmAt(RATE, distinctChannels(STEREO, 10)), node: named('ahead') },
          { ...pcmAt(RATE, distinctChannels(STEREO, 10)), node: named('dry') },
        ]),
      );
      const ended = await worker.runToEnd();

      expect(ended.kind === FromRenderWorkerKind.Failed && ended.failures).toEqual([
        expect.objectContaining({ code: 'render.source-unplaced', details: { node: 'ahead' } }),
        expect.objectContaining({ code: 'render.source-unplaced', details: { node: 'dry' } }),
      ]);
    });

    it('while it renders another, naming the job it is busy with', async () => {
      const worker = new WorkerUnderTest();
      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))]),
      );

      worker.core.receive(
        renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))], {
          jobId: 'render-2',
        }),
      );

      expect(worker.posted).toContainEqual({
        kind: FromRenderWorkerKind.Failed,
        jobId: 'render-2',
        failures: [
          expect.objectContaining({
            code: 'render.worker-busy',
            kind: FailureKind.Conflict,
            details: { busyWith: 'render-1' },
          }),
        ],
      });
      expect((await worker.runToEnd()).kind).toBe(FromRenderWorkerKind.Done);
    });

    it('and renders the next job once the last has ended', async () => {
      const worker = new WorkerUnderTest();
      const job = renderOf(lookaheadGraph(STEREO), [pcmAt(RATE, distinctChannels(STEREO, 3_000))]);
      worker.core.receive(job);
      await worker.runToEnd();

      worker.core.receive({
        ...job,
        jobId: 'render-2',
        sources: [pcmAt(RATE, distinctChannels(STEREO, 3_000))],
      });
      await worker.runToEnd('render-2');

      expect(worker.posted.filter((message) => message.kind === FromRenderWorkerKind.Done)).toEqual(
        [
          expect.objectContaining({ jobId: 'render-1' }),
          expect.objectContaining({ jobId: 'render-2' }),
        ],
      );
    });
  });

  it('refuses a message it cannot read, saying which field was wrong', () => {
    const worker = new WorkerUnderTest();

    worker.core.receive({ kind: 'render', jobId: 'render-1', graph: 'a graph' });

    expect(worker.posted).toEqual([
      {
        kind: FromRenderWorkerKind.Refused,
        failures: [
          expect.objectContaining({
            code: 'protocol.render-message-malformed',
            summary: expect.stringContaining('graph'),
          }),
        ],
      },
    ]);
  });

  it('refuses a message that could not be received, so the host fails the job it waits on', () => {
    const worker = new WorkerUnderTest();

    worker.core.messageFailed();

    expect(worker.posted).toEqual([
      {
        kind: FromRenderWorkerKind.Refused,
        failures: [
          expect.objectContaining({
            code: 'protocol.render-message-unreceivable',
            kind: FailureKind.Unrecoverable,
          }),
        ],
      },
    ]);
  });

  describe('releases every source it made', () => {
    /** A tone at another rate than the render's: an oscillator of the worker's, and a resampler of the engine's. */
    const tone = {
      node: named('in'),
      kind: SourceKind.Tone,
      sampleRate: CD_RATE,
      frequency: 440,
      amplitude: 0.5,
      frames: expectSuccess(sampleCount(3_000)),
    };

    it.each([
      ['after a render', renderOf(lookaheadGraph(STEREO), [tone]), FromRenderWorkerKind.Done],
      [
        'after the engine refuses the job',
        renderOf(lookaheadGraph(STEREO), [tone], { chunkFrames: 0 }),
        FromRenderWorkerKind.Failed,
      ],
      [
        'after a later source cannot be made',
        renderOf(lookaheadGraph(STEREO), [tone, { ...tone, node: named('ahead') }]),
        FromRenderWorkerKind.Failed,
      ],
    ])('%s', async (_case, message, ending) => {
      const counting = countingDsp();
      const worker = new WorkerUnderTest(() => ({ dsp: counting.dsp, fallbackReason: 'counting' }));

      worker.core.receive(message);
      const ended = await worker.runToEnd();

      expect(ended.kind).toBe(ending);
      expect(counting.made()).toBeGreaterThan(0);
      expect(counting.held()).toBe(0);
    });

    it('after a cancellation', async () => {
      const counting = countingDsp();
      const worker = new WorkerUnderTest(() => ({ dsp: counting.dsp, fallbackReason: 'counting' }));
      worker.core.receive(renderOf(lookaheadGraph(STEREO), [tone], { chunkFrames: 128 }));
      while (!worker.yielding) await idle();
      expect(counting.held()).toBe(2);

      worker.core.receive({ kind: ToRenderWorkerKind.Cancel, jobId: 'render-1' });
      const ended = await worker.runToEnd();

      expect(ended.kind).toBe(FromRenderWorkerKind.Cancelled);
      expect(counting.held()).toBe(0);
    });
  });
});
