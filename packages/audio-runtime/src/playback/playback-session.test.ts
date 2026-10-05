import { describe, expect, it, vi } from 'vitest';

import {
  MAXIMUM_QUALITY,
  sampleCount,
  sampleRate,
  StandardLayouts,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { LogSeverity } from '@audiogubbins/diagnostics';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  DspImplementation,
  PerformanceProfile,
  TransportMode,
  type PcmSource,
  toneRecipe,
  PcmDescriptionKind,
} from '@audiogubbins/audio-engine';
import {
  distinctChannels,
  dspModuleBytes,
  graphOf,
  named,
  nodeOf,
  wire,
} from '@audiogubbins/audio-engine/testing';

import { AudioContextState } from '../context/audio-context-port.js';
import { LifecycleState } from '../context/context-lifecycle.js';
import { GESTURE_WAIT_MILLISECONDS } from '../context/context-resume.js';
import { ENGINE_PROCESSOR_NAME } from '../processor/engine-processor-name.js';
import { ToFeederKind } from '../protocol/feeder-messages.js';
import { ToProcessorFeedKind, readToProcessorFeed } from '../protocol/feed-messages.js';
import {
  FeedTransport,
  FromProcessorKind,
  ToProcessorKind,
  type ToProcessor,
} from '../protocol/processor-messages.js';
import { DspDeliveryKind } from '../dsp/dsp-delivery.js';
import type { SourceDescription } from '../protocol/source-descriptions.js';
import type { FakeWorkletNode } from '../testing/fake-worklet-node.js';
import { PlaybackRig, WORKLET_MODULE_URL, settle } from '../testing/playback-rig.js';
import { GpuUseKind } from './gpu-use.js';
import { PlaybackPhase, type PlaybackStatus } from './playback-status.js';

const STEREO = StandardLayouts.stereo;
const RATE = expectSuccess(sampleRate(48_000));
const QUANTUM = 128;
const IN = named('in');

/** Frames of the test source: half a second, not a whole number of quanta. */
const SOURCE_FRAMES = 24_000;

/** The Balanced profile's chunk: an eighth of 200 ms at 48 kHz, in whole quanta. */
const CHUNK = 1_280;

/** Quanta between two reports at 48 kHz: thirty a second, rounded. */
const REPORT_QUANTA = 13;

/** in → gain × 0.5 → out, with a meter named `level` on the input where asked. */
function halving(options: { readonly metered?: boolean } = {}): GraphDescriptor {
  const nodes = [
    nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
    nodeOf('x', BuiltInNodeType.Gain, STEREO, { inputs: ['in'], outputs: ['out'] }, { gain: 0.5 }),
    nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
  ];
  const edges = [wire('in.out', 'x.in'), wire('x.out', 'out.in')];
  if (options.metered !== true) return graphOf(nodes, edges);
  return graphOf(
    [...nodes, nodeOf('level', BuiltInNodeType.Meter, STEREO, { inputs: ['in'] })],
    [...edges, wire('in.out', 'level.in')],
  );
}

/** in → a delay of 4 800 frames that stands for latency → out: a tenth of a second. */
const LATENCY = 4_800;
function latent(): GraphDescriptor {
  return graphOf(
    [
      nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
      nodeOf(
        'look',
        BuiltInNodeType.Delay,
        STEREO,
        { inputs: ['in'], outputs: ['out'] },
        { frames: LATENCY, 'as-latency': true },
      ),
      nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
    ],
    [wire('in.out', 'look.in'), wire('look.out', 'out.in')],
  );
}

/** The test signal at timeline frame `frame` of channel `channel`, exact in f32 and when halved. */
function sourceSample(channel: number, frame: number): number {
  return ((channel + 1) * 1000 + (frame % 4096)) / 65_536;
}

/** Recorded audio of `frames` frames, described for the feeder. */
function recorded(frames = SOURCE_FRAMES, rate = RATE): SourceDescription {
  return {
    node: IN,
    kind: PcmDescriptionKind.Pcm,
    sampleRate: rate,
    channels: distinctChannels(STEREO, frames),
  };
}

/** A tone the feeder makes itself, of `frames` frames, or endless. */
function tone(frames: number | undefined, amplitude = 0.5): SourceDescription {
  return {
    node: IN,
    kind: PcmDescriptionKind.Signal,
    sampleRate: RATE,
    // A tone as long as the largest count stands for one that never ends here.
    recipe: expectSuccess(toneRecipe(2, frames ?? Number.MAX_SAFE_INTEGER, 440, amplitude)),
  };
}

/** Reads of a source that answer none from `frames` on, as a stalled disk would not. */
function stallingAfter(frames: number): (node: NodeId, source: PcmSource) => PcmSource {
  return (_node, source) => ({
    ...source,
    read: (start, into, signal) =>
      start >= frames ? new Promise<number>(() => undefined) : source.read(start, into, signal),
  });
}

/** Reads that wait from `frames` on until the test opens the gate, as a slow disk would. */
function gatedAfter(frames: number): {
  readonly readThrough: (node: NodeId, source: PcmSource) => PcmSource;
  readonly open: () => void;
} {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    readThrough: (_node, source) => ({
      ...source,
      read: async (start, into, signal) => {
        if (start >= frames) await gate;
        return await source.read(start, into, signal);
      },
    }),
    open,
  };
}

/** Reads that fail from `frames` on, as a disk that went away. */
function failingAfter(frames: number): (node: NodeId, source: PcmSource) => PcmSource {
  return (_node, source) => ({
    ...source,
    read: (start, into, signal) =>
      start >= frames
        ? Promise.reject(new Error('The disk went away.'))
        : source.read(start, into, signal),
  });
}

function frames(count: number): SampleCount {
  return expectSuccess(sampleCount(count));
}

/**
 * The samples a node played from context frame `from` for `count` frames, one
 * array per channel.
 */
function played(node: FakeWorkletNode, from: number, count: number): Float32Array[] {
  const out = [new Float32Array(count), new Float32Array(count)];
  for (const quantum of node.rendered) {
    quantum.channels.forEach((channel, index) => {
      for (let frame = 0; frame < QUANTUM; frame += 1) {
        const at = quantum.frame + frame - from;
        if (at >= 0 && at < count) out[index]?.set([channel[frame] ?? 0], at);
      }
    });
  }
  return out;
}

/** Every sample a node played in the quanta `from` to `to` of its rendering, one channel's. */
function playedQuanta(node: FakeWorkletNode, from = 0, to = node.rendered.length): number[] {
  return node.rendered.slice(from, to).flatMap((quantum) => [...(quantum.channels[0] ?? [])]);
}

/** The first frame at which `samples` differ from the halved source from timeline frame `from`, or -1. */
function firstMismatch(samples: readonly Float32Array[], from: number): number {
  const count = samples[0]?.length ?? 0;
  for (let frame = 0; frame < count; frame += 1) {
    for (let channel = 0; channel < samples.length; channel += 1) {
      if (samples[channel]?.[frame] !== sourceSample(channel, from + frame) * 0.5) return frame;
    }
  }
  return -1;
}

function kindOf(message: unknown): unknown {
  return typeof message === 'object' && message !== null && 'kind' in message
    ? message.kind
    : undefined;
}

const kindsSent = (node: FakeWorkletNode): readonly unknown[] => node.sent.map(kindOf);

function loadSent(node: FakeWorkletNode): Extract<ToProcessor, { kind: 'load' }> {
  const load = node.sent.find(
    (message): message is Extract<ToProcessor, { kind: 'load' }> =>
      kindOf(message) === ToProcessorKind.Load,
  );
  if (load === undefined) throw new Error('No load was sent.');
  return load;
}

/** The frames of the posted blocks the feeder has sent the processor. */
function postedFrames(rig: PlaybackRig): number {
  let total = 0;
  for (const message of rig.feeder.processorPort?.posted ?? []) {
    const read = readToProcessorFeed(message);
    if (read.ok && read.value.kind === ToProcessorFeedKind.Block) {
      total += read.value.channels[0]?.length ?? 0;
    }
  }
  return total;
}

/** A rig with the halving graph loaded, playing from a gesture, and one quantum rendered. */
async function playing(
  rig = new PlaybackRig(),
  source: SourceDescription = recorded(),
  graph = halving(),
): Promise<PlaybackRig> {
  expectSuccess(await rig.session.load({ quality: MAXIMUM_QUALITY, graph, sources: [source] }));
  expectSuccess(await rig.session.play());
  await rig.render(1);
  return rig;
}

function records(rig: PlaybackRig, severity: LogSeverity) {
  return rig.store.snapshot().filter((record) => record.severity === severity);
}

/** Every status the session publishes from now. */
function published(rig: PlaybackRig): PlaybackStatus[] {
  const heard: PlaybackStatus[] = [];
  rig.session.subscribe((status) => heard.push(status));
  return heard;
}

describe('PlaybackSession', () => {
  describe('loading', () => {
    it('makes one node of the engine processor, shaped for the sink, and binds the feeder to it', async () => {
      const rig = new PlaybackRig();

      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );

      const { node } = rig;
      expect(rig.current.modules).toEqual([WORKLET_MODULE_URL]);
      expect(node.processorName).toBe(ENGINE_PROCESSOR_NAME);
      expect(node.shape).toEqual({
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      expect(node.connectedTo).toBe(rig.current.context.destination);
      expect(loadSent(node).feeds).toEqual([
        { node: IN, transport: FeedTransport.Posted, channels: 2 },
      ]);
      expect(rig.feeders).toHaveLength(1);
      expect(rig.feeder.received.map((message) => message.kind)).toEqual([
        ToFeederKind.Sources,
        ToFeederKind.Bind,
      ]);
      // The two ends of one channel: the processor's in the load, the feeder's in the binding.
      expect(loadSent(node).feeder).toBeDefined();
      expect(rig.feeder.processorPort).toBeDefined();
      expect(rig.session.status).toMatchObject({
        phase: PlaybackPhase.Ready,
        processorDsp: {
          implementation: DspImplementation.Reference,
          fallbackReason: 'This test compiles no DSP module.',
          inUse: false,
        },
        feederDsp: {
          implementation: DspImplementation.Reference,
          fallbackReason: 'This test compiles no DSP module.',
          inUse: false,
        },
        latencyFrames: 0,
        contextState: AudioContextState.Suspended,
        stability: { stable: true, underrunsInWindow: 0 },
        problems: [],
      });
    });

    it('binds a shared ring where memory can be shared, to both the processor and the feeder', async () => {
      const rig = new PlaybackRig({ sharedMemory: true });

      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );

      const [binding] = loadSent(rig.node).feeds;
      expect(binding?.transport).toBe(FeedTransport.SharedRing);
      // The feed-ahead time plus one chunk, for 200 ms at 48 kHz in chunks of 1,280.
      expect(binding?.transport === FeedTransport.SharedRing && binding.ring.byteLength).toBe(
        7 * 4 + 2 * (9_600 + CHUNK) * 4,
      );
      const bind = rig.feeder.received.find((message) => message.kind === ToFeederKind.Bind);
      expect(bind?.kind === ToFeederKind.Bind && bind.feeds).toEqual([
        {
          node: IN,
          transport: FeedTransport.SharedRing,
          ring: binding?.transport === FeedTransport.SharedRing ? binding.ring : undefined,
        },
      ]);
    });

    it('transfers recorded audio to the feeder rather than keeping a copy on the main thread', async () => {
      const rig = new PlaybackRig();
      const source = recorded();

      expectSuccess(
        await rig.session.load({ quality: MAXIMUM_QUALITY, graph: halving(), sources: [source] }),
      );

      expect(source.kind === PcmDescriptionKind.Pcm && source.channels[0]?.length).toBe(0);
    });

    it('adds the processor module to a context once, and makes the sources once, however often it loads them', async () => {
      const rig = new PlaybackRig();
      const request = {
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [tone(SOURCE_FRAMES)],
      };

      expectSuccess(await rig.session.load(request));
      const first = rig.node;
      expectSuccess(await rig.session.load(request));

      expect(rig.current.modules).toEqual([WORKLET_MODULE_URL]);
      expect(rig.current.nodes).toHaveLength(2);
      expect(first.disconnected).toBe(true);
      expect(first.listenerCount).toBe(0);
      expect(rig.feeder.received.map((message) => message.kind)).toEqual([
        ToFeederKind.Sources,
        ToFeederKind.Bind,
        ToFeederKind.Unbind,
        ToFeederKind.Bind,
      ]);
    });

    it('releases a request’s sources when another replaces it', async () => {
      const rig = new PlaybackRig();

      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [tone(100)],
        }),
      );
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [tone(200)],
        }),
      );

      expect(rig.feeder.received.map((message) => message.kind)).toEqual([
        ToFeederKind.Sources,
        ToFeederKind.Bind,
        ToFeederKind.Unbind,
        ToFeederKind.Release,
        ToFeederKind.Sources,
        ToFeederKind.Bind,
      ]);
    });

    it('makes the tone in the feeder on the WebAssembly module, which the worklet has too', async () => {
      const bytes = dspModuleBytes();
      const module = new WebAssembly.Module(bytes);
      const rig = new PlaybackRig({
        dsp: { kind: DspDeliveryKind.Available, module: { bytes, module } },
      });

      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [tone(4_800)],
        }),
      );

      const sent = loadSent(rig.node);
      expect(sent.dsp.kind === DspDeliveryKind.Available && sent.dsp.module).toBe(bytes);
      const sources = rig.feeder.received.find((message) => message.kind === ToFeederKind.Sources);
      expect(
        sources?.kind === ToFeederKind.Sources &&
          sources.dsp.kind === DspDeliveryKind.Available &&
          sources.dsp.module,
      ).toBe(module);
      expect(rig.session.status.feederDsp).toEqual({
        implementation: DspImplementation.WebAssembly,
        fallbackReason: undefined,
        inUse: true,
      });
      // The worklet has the module, and no node of this graph calls it.
      expect(rig.session.status.processorDsp).toEqual({
        implementation: DspImplementation.WebAssembly,
        fallbackReason: undefined,
        inUse: false,
      });
    });

    it('plays the same bits from the WebAssembly tone as from the reference path', async () => {
      const bytes = dspModuleBytes();
      const module = new WebAssembly.Module(bytes);
      const [wasm, reference] = await Promise.all(
        [
          new PlaybackRig({ dsp: { kind: DspDeliveryKind.Available, module: { bytes, module } } }),
          new PlaybackRig(),
        ].map(async (rig) => {
          await playing(rig, tone(4_800));
          await rig.render(40);
          return playedQuanta(rig.node);
        }),
      );
      expect(wasm?.some((sample) => sample !== 0)).toBe(true);
      expect(wasm).toEqual(reference);
    });

    it('sends no module where the page cannot compile WebAssembly, and says why', async () => {
      const bytes = dspModuleBytes();
      const rig = new PlaybackRig({
        webAssembly: false,
        dsp: {
          kind: DspDeliveryKind.Available,
          module: { bytes, module: new WebAssembly.Module(bytes) },
        },
      });

      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [tone(100)],
        }),
      );

      expect(loadSent(rig.node).dsp.kind).toBe(DspDeliveryKind.Unavailable);
      expect(rig.session.status.processorDsp?.implementation).toBe(DspImplementation.Reference);
      expect(rig.session.status.processorDsp?.fallbackReason).toMatch(
        /cannot compile WebAssembly/u,
      );
      expect(rig.session.status.feederDsp?.fallbackReason).toMatch(/cannot compile WebAssembly/u);
    });

    it('refuses a request whose sources the feeder cannot make, with its reason', async () => {
      const rig = new PlaybackRig();

      // Above half the rate: a pitch the oscillator refuses to alias.
      const shrill = {
        node: IN,
        kind: PcmDescriptionKind.Signal,
        sampleRate: RATE,
        recipe: expectSuccess(toneRecipe(2, 100, 30_000, 0.5)),
      } as const;
      const refused = await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [shrill],
      });

      expect(expectFailureCode(refused)).toBe('playback.sources-refused');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Refused);
      expect(rig.session.status.problems).toEqual([
        'An oscillator frequency must be above zero and at most half the sample rate.',
      ]);
      expect(rig.current.nodes).toEqual([]);
    });

    it('settles a load the processor never answers after ten seconds, and says why', async () => {
      const rig = new PlaybackRig({ lost: (message) => kindOf(message) === ToProcessorKind.Load });

      const loading = rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [recorded()],
      });
      await settle();
      rig.schedule.advance(9_999);
      await settle();
      expect(rig.session.status.phase).toBe(PlaybackPhase.Loading);
      rig.schedule.advance(1);

      expect(expectFailureCode(await loading)).toBe('playback.load-unanswered');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.session.status.problems).toEqual([
        expect.stringMatching(/did not answer when the graph was sent/u),
      ]);
      expect(rig.node.disconnected).toBe(true);
      expect(rig.schedule.pending).toBe(0);
    });

    it('settles a load the feeder never answers after ten seconds, and says why', async () => {
      const rig = new PlaybackRig();
      rig.lifecycle.context();
      const loading = rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [recorded()],
      });
      rig.feeder.terminate();
      await settle();
      rig.schedule.advance(10_000);

      expect(expectFailureCode(await loading)).toBe('playback.feeder-unanswered');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.current.nodes).toEqual([]);
    });

    it('adds the module once when two loads overlap, and the first stands down', async () => {
      const rig = new PlaybackRig();

      const first = rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [tone(100)],
      });
      const second = rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [tone(100)],
      });

      expect(expectFailureCode(await first)).toBe('playback.superseded');
      expectSuccess(await second);
      expect(rig.current.modules).toEqual([WORKLET_MODULE_URL]);
      expect(rig.current.nodes).toHaveLength(1);
    });

    it('faults a load whose processor module the browser refuses, and tries it again on the next', async () => {
      const rig = new PlaybackRig();
      rig.lifecycle.context();
      vi.spyOn(rig.current.context.audioWorklet, 'addModule').mockRejectedValueOnce(
        new DOMException('Unable to load a worklet’s module.', 'AbortError'),
      );

      const refused = await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [tone(100)],
      });

      expect(expectFailureCode(refused)).toBe('playback.processor-module-failed');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.current.nodes).toEqual([]);
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [tone(100)],
        }),
      );
      expect(rig.session.status.phase).toBe(PlaybackPhase.Ready);
    });

    it('refuses a graph without exactly one output before any node or feeder is made', async () => {
      const rig = new PlaybackRig();
      const twoOutputs = graphOf(
        [
          nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
          nodeOf('a', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
          nodeOf('b', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
        ],
        [wire('in.out', 'a.in'), wire('in.out', 'b.in')],
      );

      const refused = await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: twoOutputs,
        sources: [recorded()],
      });

      expect(expectFailureCode(refused)).toBe('playback.graph-sinks');
      expect(rig.current.nodes).toEqual([]);
      expect(rig.current.modules).toEqual([]);
      expect(rig.feeders).toEqual([]);
      expect(rig.session.status.phase).toBe(PlaybackPhase.Refused);
      expect(rig.session.status.problems).toEqual([
        'The graph has 2 outputs; playback plays exactly one.',
      ]);
    });

    it('refuses a graph the compiler refuses, with the compiler’s reasons', async () => {
      const rig = new PlaybackRig();
      const dangling = graphOf(
        [nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] })],
        [wire('nowhere.out', 'out.in')],
      );

      const refused = await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: dangling,
        sources: [],
      });

      expect(expectFailureCode(refused)).toBe('playback.graph-invalid');
      expect(rig.current.nodes).toEqual([]);
      expect(rig.session.status.phase).toBe(PlaybackPhase.Refused);
      expect(rig.session.status.problems.length).toBeGreaterThan(0);
    });

    it('refuses a source at another rate than the context’s, naming the explicit conversion', async () => {
      const rig = new PlaybackRig();
      const cd = expectSuccess(sampleRate(44_100));

      const refused = await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [recorded(4_410, cd)],
      });

      expect(expectFailureCode(refused)).toBe('playback.source-rate-mismatch');
      expect(!refused.ok && refused.failures[0].summary).toContain('resampledSource');
      expect(rig.current.nodes).toEqual([]);
    });

    it('refuses a graph input without a source, a source without a graph input, and two for one', async () => {
      const rig = new PlaybackRig();
      const elsewhere: SourceDescription = { ...tone(100), node: named('elsewhere') };

      const missing = await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [elsewhere],
      });
      const doubled = await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [tone(1), tone(2)],
      });

      expect(!missing.ok && missing.failures.map((one) => one.code)).toEqual([
        'playback.source-missing',
        'playback.source-unbound',
      ]);
      expect(!doubled.ok && doubled.failures.map((one) => one.code)).toEqual([
        'playback.source-duplicated',
      ]);
      expect(rig.current.nodes).toEqual([]);
    });
  });

  describe('playing', () => {
    it('starts the context from the gesture and anchors the transport where the processor started', async () => {
      const rig = new PlaybackRig();
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );
      const context = rig.current.context;
      expect(context.state).toBe(AudioContextState.Suspended);

      expectSuccess(await rig.session.play());

      expect(context.resumeCalls).toBe(1);
      // Nothing plays until the processor says it started, at the next quantum.
      expect(rig.session.status.transport.mode).toBe(TransportMode.Stopped);
      expect(kindsSent(rig.node)).toContain(ToProcessorKind.Start);
      await rig.render(3);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Playing,
        anchor: { contextFrame: 0, timelineFrame: 0 },
        origin: 0,
      });
      expect(rig.session.status.contextState).toBe(AudioContextState.Running);
      expect(rig.position()).toBe(3 * QUANTUM);
    });

    it('sends the main thread’s processor no audio: the feeder feeds it on a channel of its own', async () => {
      const rig = await playing();
      await rig.render(REPORT_QUANTA);

      expect(new Set(kindsSent(rig.node))).toEqual(
        new Set([ToProcessorKind.Load, ToProcessorKind.Start]),
      );
      expect(postedFrames(rig)).toBeGreaterThan(0);
      expect(rig.feeder.processorPort?.posted.map(kindOf)[0]).toBe(ToProcessorFeedKind.Rewind);
    });

    it('tells the processor to start only once every feed has audio queued', async () => {
      const gated = gatedAfter(0);
      const rig = new PlaybackRig({ readThrough: gated.readThrough });
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );

      const started = rig.session.play();
      await settle();
      expect(kindsSent(rig.node)).not.toContain(ToProcessorKind.Start);

      gated.open();
      expectSuccess(await started);
      expect(postedFrames(rig)).toBeGreaterThan(0);
      await rig.render(3);
      expect(rig.session.status.stability).toMatchObject({ stable: true });
    });

    it('says audio waits for a gesture when the browser holds the start for one', async () => {
      const rig = new PlaybackRig({ context: { allowedToStart: false } });
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );

      const played = rig.session.play();
      rig.schedule.advance(GESTURE_WAIT_MILLISECONDS);
      const refused = await played;

      expect(expectFailureCode(refused)).toBe('audio.context-awaiting-gesture');
      expect(rig.session.status.contextState).toBe(LifecycleState.AwaitingGesture);
      expect(kindsSent(rig.node)).not.toContain(ToProcessorKind.Start);
    });

    it('plays the source through the graph bit for bit, and stops at its end', async () => {
      const rig = await playing();

      await rig.render(Math.ceil(SOURCE_FRAMES / QUANTUM) + 2);

      expect(firstMismatch(played(rig.node, 0, SOURCE_FRAMES), 0)).toBe(-1);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Stopped,
        position: SOURCE_FRAMES,
      });
      expect(rig.session.status.stability).toMatchObject({ stable: true, underrunsInWindow: 0 });
      expect(records(rig, LogSeverity.Error)).toEqual([]);
      expect(kindsSent(rig.node).at(-1)).toBe(ToProcessorKind.Halt);
      expect(rig.feeder.received.at(-1)?.kind).toBe(ToFeederKind.Stop);
    });

    it('plays a shared ring bit for bit, with no block posted', async () => {
      const rig = await playing(new PlaybackRig({ sharedMemory: true }));

      await rig.render(Math.ceil(SOURCE_FRAMES / QUANTUM) + 2);

      expect(firstMismatch(played(rig.node, 0, SOURCE_FRAMES), 0)).toBe(-1);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Stopped,
        position: SOURCE_FRAMES,
      });
      expect(postedFrames(rig)).toBe(0);
    });

    it('plays an endless tone without ending', async () => {
      const rig = await playing(new PlaybackRig(), tone(undefined));

      await rig.render(40);

      expect(rig.session.status.transport.mode).toBe(TransportMode.Playing);
      expect(rig.position()).toBe(41 * QUANTUM);
      expect(rig.session.status.stability).toMatchObject({ stable: true });
    });

    it('pauses where the processor halted, and plays on from its very next frame', async () => {
      const rig = await playing();
      await rig.render(9);

      expectSuccess(rig.session.pause());
      await settle();
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Paused,
        position: 10 * QUANTUM,
        origin: 0,
      });
      await rig.render(4);
      expect(rig.position()).toBe(10 * QUANTUM);

      expectSuccess(await rig.session.play());
      await rig.render(5);

      // The processor starts at the first quantum after the play: the one
      // after the ten played and the four paused. A report since has moved
      // the anchor along the same line.
      const resumedAt = 14 * QUANTUM;
      const { transport } = rig.session.status;
      expect(transport).toMatchObject({ mode: TransportMode.Playing, origin: 0 });
      expect(
        transport.mode === TransportMode.Playing &&
          transport.anchor.timelineFrame - transport.anchor.contextFrame,
      ).toBe(10 * QUANTUM - resumedAt);
      expect(rig.position()).toBe(10 * QUANTUM + (rig.frame - resumedAt));
      expect(firstMismatch(played(rig.node, resumedAt, 4 * QUANTUM), 10 * QUANTUM)).toBe(-1);
      // The pipeline was kept: the feeder was not told to start again.
      expect(
        rig.feeder.received.filter((message) => message.kind === ToFeederKind.Start),
      ).toHaveLength(1);
    });

    it('seeks while playing and plays on from the new frame', async () => {
      const rig = await playing();
      await rig.render(4);

      expectSuccess(await rig.session.seek(frames(12_000)));
      expect(rig.session.status.transport.mode).toBe(TransportMode.Paused);
      await rig.render(3);

      const startedAt = 5 * QUANTUM;
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Playing,
        anchor: { contextFrame: startedAt, timelineFrame: 12_000 },
        origin: 12_000,
      });
      expect(rig.position()).toBe(12_000 + 3 * QUANTUM);
      expect(firstMismatch(played(rig.node, startedAt, 3 * QUANTUM), 12_000)).toBe(-1);
    });

    it('seeks while paused, and plays afresh from there rather than going on', async () => {
      const rig = await playing();
      await rig.render(4);
      expectSuccess(rig.session.pause());
      await settle();

      expectSuccess(await rig.session.seek(frames(6_000)));
      expectSuccess(await rig.session.play());
      const startedAt = rig.frame;
      await rig.render(3);

      expect(rig.position()).toBe(6_000 + 3 * QUANTUM);
      expect(firstMismatch(played(rig.node, startedAt, 3 * QUANTUM), 6_000)).toBe(-1);
    });

    it('parks a pause where it was heard, plays afresh from there, and stops where the play began', async () => {
      const rig = await playing();
      await rig.render(9);
      expectSuccess(rig.session.pause());
      await settle();

      expectSuccess(rig.session.park(frames(6 * QUANTUM)));
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Paused,
        position: 6 * QUANTUM,
        origin: 0,
      });
      expectSuccess(await rig.session.play());
      const startedAt = rig.frame;
      await rig.render(3);
      expect(firstMismatch(played(rig.node, startedAt, 3 * QUANTUM), 6 * QUANTUM)).toBe(-1);

      expectSuccess(rig.session.stop());
      await settle();
      expect(rig.session.status.transport).toEqual({ mode: TransportMode.Stopped, position: 0 });
    });

    it('refuses to park a transport that is not paused, and leaves the run alone', async () => {
      const rig = await playing();
      await rig.render(4);
      const sent = kindsSent(rig.node).length;

      expect(expectFailureCode(rig.session.park(frames(QUANTUM)))).toBe(
        'transport.park-while-not-paused',
      );
      expect(rig.session.status.transport.mode).toBe(TransportMode.Playing);
      expect(kindsSent(rig.node)).toHaveLength(sent);
    });

    it('seeks while stopped without starting anything', async () => {
      const rig = new PlaybackRig();
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );

      expectSuccess(await rig.session.seek(frames(4_000)));

      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Stopped,
        position: 4_000,
      });
      expect(kindsSent(rig.node)).toEqual([ToProcessorKind.Load]);
    });

    it('stops and returns to where the play began, the feeder with it', async () => {
      const rig = await playing();
      await rig.render(10);

      expectSuccess(rig.session.stop());
      await settle();

      expect(rig.session.status.transport).toEqual({ mode: TransportMode.Stopped, position: 0 });
      expect(rig.position()).toBe(0);
      expect(kindsSent(rig.node).at(-1)).toBe(ToProcessorKind.Halt);
      expect(rig.feeder.received.at(-1)?.kind).toBe(ToFeederKind.Stop);
      // The pumps and their timers stop with the run.
      expect(rig.schedule.pending).toBe(0);
    });

    it('cancels a play still on its way when paused', async () => {
      const rig = new PlaybackRig();
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );
      expectSuccess(await rig.session.play());

      expectSuccess(rig.session.pause());
      await rig.render(3);

      expect(rig.session.status.transport).toEqual({ mode: TransportMode.Stopped, position: 0 });
    });

    it('refuses to pause what is stopped', async () => {
      const rig = new PlaybackRig();
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );

      expect(expectFailureCode(rig.session.pause())).toBe('transport.pause-while-stopped');
    });

    it('shows the audible position behind the one at the output by the device’s latency', async () => {
      const rig = await playing();
      await rig.render(19);

      // 128 frames of the context's own and 480 of the device's, the fake's defaults.
      expect(expectSuccess(rig.session.audiblePosition())).toBe(20 * QUANTUM - 608);
    });
  });

  describe('counting where playback is on the audio thread', () => {
    /** The whole latent graph's output, played without a pause. */
    async function uninterrupted(): Promise<number[]> {
      const rig = await playing(new PlaybackRig(), recorded(), latent());
      await rig.render(250);
      return playedQuanta(rig.node);
    }

    it('plays every frame of a latent graph once through pauses, as an uninterrupted play does, and ends at the end', async () => {
      const rig = await playing(new PlaybackRig(), recorded(), latent());
      const paused: [number, number][] = [];
      for (const at of [59, 20, 1]) {
        await rig.render(at);
        expectSuccess(rig.session.pause());
        await settle();
        const from = rig.node.rendered.length;
        await rig.render(3);
        expectSuccess(await rig.session.play());
        paused.push([from, rig.node.rendered.length]);
      }
      await rig.render(250);

      // The first pause lands after 60 quanta: 7 680 frames run, less the 4 800 of latency.
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Stopped,
        position: SOURCE_FRAMES,
      });
      const heard: number[] = [];
      let at = 0;
      for (const [from, to] of paused) {
        heard.push(...playedQuanta(rig.node, at, from));
        at = to;
      }
      heard.push(...playedQuanta(rig.node, at));
      const whole = await uninterrupted();
      expect(heard.slice(0, whole.length)).toEqual(whole);
      expect(whole.slice(0, LATENCY).every((sample) => sample === 0)).toBe(true);
      expect(whole[LATENCY]).toBe(sourceSample(0, 0));
    });

    it('pauses at the frame that has left the graph, not the frame fed into it', async () => {
      const rig = await playing(new PlaybackRig(), recorded(), latent());
      await rig.render(59);

      expectSuccess(rig.session.pause());
      await settle();

      expect(rig.session.status.transport).toMatchObject({
        mode: TransportMode.Paused,
        position: 60 * QUANTUM - LATENCY,
      });
    });

    it('settles a pause where the processor halted, when the halt lands a quantum after it was asked', async () => {
      const rig = await playing();
      await rig.render(9);

      expectSuccess(rig.session.pause());
      // The processor renders one more quantum before the halt reaches it.
      await rig.render(1);

      expect(rig.session.status.transport).toMatchObject({
        mode: TransportMode.Paused,
        position: 11 * QUANTUM,
      });
      const resumedAt = rig.frame;
      expectSuccess(await rig.session.play());
      await rig.render(2);
      // Nothing heard before the halt is played again.
      expect(firstMismatch(played(rig.node, resumedAt, 2 * QUANTUM), 11 * QUANTUM)).toBe(-1);
    });

    it('holds the playhead at the start while the first frame passes through the latency', async () => {
      const rig = await playing(new PlaybackRig(), recorded(), latent());
      await rig.render(20);

      expect(rig.position()).toBe(0);
      await rig.render(30);
      expect(rig.position()).toBe(51 * QUANTUM - LATENCY);
    });

    it('counts an underrun as no progress, so the position and the resume stay exact', async () => {
      const gated = gatedAfter(2 * CHUNK);
      const rig = await playing(new PlaybackRig({ readThrough: gated.readThrough }));
      // 2 560 frames fed are 20 quanta; 16 more quanta starve.
      await rig.render(35);
      gated.open();
      await settle();
      await rig.render(10);

      expectSuccess(rig.session.pause());
      await settle();

      // 46 quanta rendered, 16 of them silent for want of audio.
      const underrun = 16;
      expect(rig.session.status.transport).toMatchObject({
        mode: TransportMode.Paused,
        position: (46 - underrun) * QUANTUM,
      });
      // The audio after the underrun is the audio that was due, not audio skipped past it.
      expect(firstMismatch(played(rig.node, 36 * QUANTUM, 10 * QUANTUM), 20 * QUANTUM)).toBe(-1);
      const resumedAt = rig.frame;
      expectSuccess(await rig.session.play());
      await rig.render(4);
      expect(firstMismatch(played(rig.node, resumedAt, 4 * QUANTUM), 30 * QUANTUM)).toBe(-1);
    });
  });

  describe('observing the processor', () => {
    it('records a starved feed’s underruns from its reports, and logs one warning for the episode', async () => {
      const rig = await playing(new PlaybackRig({ readThrough: stallingAfter(2 * CHUNK) }));

      // 39 quanta in all: reports at 13, 26 and 39, the last 19 of them starved.
      await rig.render(38);

      const stability = rig.session.status.stability;
      expect(stability).toMatchObject({
        stable: false,
        underrunsInWindow: 19,
        recommendation: PerformanceProfile.MaximumStability,
      });
      const underruns = records(rig, LogSeverity.Warning).filter(
        (record) => record.message === 'The audio device ran out of sound to play.',
      );
      expect(underruns.map((record) => record.fields)).toEqual([
        { contextFrame: 26 * QUANTUM, frames: 6 * QUANTUM },
      ]);
    });

    it('posts one report per so many quanta and publishes only what changed, however long a feed starves', async () => {
      const rig = await playing(new PlaybackRig({ readThrough: stallingAfter(2 * CHUNK) }));
      const heard = published(rig);
      const before = rig.node.rendered.length;
      let replies = 0;
      rig.node.port.addEventListener('message', () => {
        replies += 1;
      });

      // Five seconds starved: 1 875 quanta.
      await rig.render(1_875);

      const reports =
        Math.floor((before + 1_875) / REPORT_QUANTA) - Math.floor(before / REPORT_QUANTA);
      expect(replies).toBe(reports);
      // A publish for each report whose count changed, and none for the rest.
      expect(heard.length).toBeLessThanOrEqual(reports);
      expect(new Set(heard.map((status) => status.stability?.underrunsInWindow)).size).toBe(
        heard.length,
      );
      expect(
        records(rig, LogSeverity.Warning).filter(
          (record) => record.message === 'The audio device ran out of sound to play.',
        ),
      ).toHaveLength(1);
    });

    it('carries every meter in one report, and publishes no status for their levels', async () => {
      const rig = new PlaybackRig();
      const graph = graphOf(
        [
          nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
          nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
          ...['a', 'b', 'c'].map((name) =>
            nodeOf(name, BuiltInNodeType.Meter, STEREO, { inputs: ['in'] }, { correlate: [0, 1] }),
          ),
        ],
        [wire('in.out', 'out.in'), ...['a', 'b', 'c'].map((name) => wire('in.out', `${name}.in`))],
      );
      expectSuccess(
        await rig.session.load({ quality: MAXIMUM_QUALITY, graph, sources: [tone(undefined)] }),
      );
      expectSuccess(await rig.session.play());
      await rig.render(1);
      const heard = published(rig);
      const kinds: unknown[] = [];
      rig.node.port.addEventListener('message', (event) => {
        kinds.push(kindOf(event.data));
      });

      await rig.render(10 * REPORT_QUANTA);

      expect(kinds).toEqual(Array.from({ length: 10 }, () => FromProcessorKind.Report));
      expect(heard).toEqual([]);
      const meters = rig.session.meters();
      expect([...meters.keys()]).toEqual([named('a'), named('b'), named('c')]);
      // The same tone on both channels moves together.
      expect(meters.get(named('a'))?.correlation).toEqual([1]);
      expect(meters.get(named('a'))?.peak).toHaveLength(2);
    });

    it('publishes nothing when what it would publish has not changed', async () => {
      const rig = await playing();
      await rig.render(4);
      const heard = published(rig);

      // Play while playing asks the context to run, which it does, and shows the status again.
      expectSuccess(await rig.session.play());
      rig.devices.change();
      await rig.render(2 * REPORT_QUANTA);

      expect(heard).toEqual([]);
    });

    it('stops at a processor fault, says why, and pauses the transport where it was', async () => {
      const rig = await playing();
      await rig.render(4);

      rig.node.reply({ kind: 'fault', message: 'Processing stopped: a kernel threw.' });
      await settle();

      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.session.status.problems).toEqual(['Processing stopped: a kernel threw.']);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Paused,
        position: 5 * QUANTUM,
        origin: 0,
      });
      expect(records(rig, LogSeverity.Error).map((record) => record.fields)).toEqual([
        { reason: 'Processing stopped: a kernel threw.' },
      ]);
      expect(expectFailureCode(await rig.session.play())).toBe('playback.not-ready');
    });

    it('faults when a source cannot be read while playing, and says which', async () => {
      // Past the time ahead, so the failing read comes after the start.
      const rig = await playing(new PlaybackRig({ readThrough: failingAfter(12_000) }));

      await rig.render(40);

      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.session.status.problems).toEqual([
        'The audio for in could not be read: The disk went away.',
      ]);
      expect(rig.session.status.transport.mode).toBe(TransportMode.Paused);
      expect(kindsSent(rig.node).at(-1)).toBe(ToProcessorKind.Halt);
    });

    it('answers Play with the fault when a source fails before the processor starts', async () => {
      const rig = new PlaybackRig({ readThrough: failingAfter(0) });
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );

      const played = await rig.session.play();

      expect(expectFailureCode(played)).toBe('playback.processor-fault');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
    });

    it('faults when a reply from the processor cannot be received, and pauses where it was', async () => {
      const rig = await playing();
      await rig.render(4);

      rig.node.replyFails();
      await settle();

      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.session.status.problems).toEqual([
        'A message from the audio processor could not be received, so what it plays is in doubt.',
      ]);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Paused,
        position: 5 * QUANTUM,
        origin: 0,
      });
      expect(records(rig, LogSeverity.Error).map((record) => record.message)).toContain(
        'A reply from the audio processor could not be received.',
      );
      expect(kindsSent(rig.node).at(-1)).toBe(ToProcessorKind.Halt);
    });

    it('faults when a reply from the feeder cannot be received, or the feeder throws', async () => {
      for (const [breaks, problem] of [
        [
          (rig: PlaybackRig) => {
            rig.feeder.replyFails();
          },
          'A message from the feeder could not be received, so what it feeds is in doubt.',
        ],
        [
          (rig: PlaybackRig) => {
            rig.feeder.fail('Out of memory.');
          },
          'The feeder stopped with an error: Out of memory.',
        ],
      ] as const) {
        const rig = await playing();
        await rig.render(4);

        breaks(rig);
        await settle();

        expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
        expect(rig.session.status.problems).toEqual([problem]);
        expect(rig.session.status.transport.mode).toBe(TransportMode.Paused);
      }
    });

    it('ends a load at once when the answer to it cannot be received', async () => {
      const rig = new PlaybackRig({ lost: (message) => kindOf(message) === ToProcessorKind.Load });

      const loading = rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [recorded()],
      });
      await settle();
      rig.node.replyFails();

      expect(expectFailureCode(await loading)).toBe('playback.processor-fault');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.schedule.pending).toBe(0);
    });

    it('logs a malformed reply with its failure code and acts on none of it', async () => {
      const rig = new PlaybackRig();
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );
      const before = rig.session.status;

      rig.node.reply({ kind: 'started', run: 1 });
      await rig.render(1);

      expect(rig.session.status).toBe(before);
      expect(records(rig, LogSeverity.Error).map((record) => record.fields)).toEqual([
        {
          code: 'protocol.processor-reply-malformed',
          reason: "The message's contextFrame is not a finite number.",
        },
      ]);
    });
  });

  describe('telling runs apart', () => {
    it('ignores a started of an earlier run that arrives after a later run began', async () => {
      const rig = new PlaybackRig();
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [recorded()],
        }),
      );
      expectSuccess(await rig.session.play());
      expectSuccess(rig.session.pause());
      expectSuccess(await rig.session.play());

      // The first run's start, posted before its halt reached the processor,
      // lands only now.
      rig.node.reply({ kind: 'started', run: 1, contextFrame: 0, position: 0 });
      await settle();
      expect(rig.session.status.transport).toEqual({ mode: TransportMode.Stopped, position: 0 });

      await rig.render(4);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Playing,
        anchor: { contextFrame: 0, timelineFrame: 0 },
        origin: 0,
      });
      expect(rig.position()).toBe(4 * QUANTUM);
    });

    it('ignores the end, the report and the failed feed of a run halted since, and plays on', async () => {
      const rig = await playing();
      await rig.render(4);
      expectSuccess(await rig.session.seek(frames(1_000)));
      await rig.render(2);

      rig.node.reply({ kind: 'feeds-ended', run: 1, contextFrame: 5 * QUANTUM, position: 640 });
      rig.node.reply({
        kind: 'report',
        run: 1,
        contextFrame: 5 * QUANTUM,
        position: 640,
        underrunFrames: QUANTUM,
        underruns: 1,
        meters: [],
      });
      await settle();

      expect(rig.session.status.transport.mode).toBe(TransportMode.Playing);
      expect(rig.session.status.stability).toMatchObject({ stable: true, underrunsInWindow: 0 });
      await rig.render(2);
      expect(rig.position()).toBe(1_000 + 4 * QUANTUM);
    });
  });

  describe('parameters', () => {
    it('sends a parameter to the loaded graph, and shows a node’s refusal while it plays on', async () => {
      const rig = await playing();

      expectSuccess(rig.session.setParameter(named('x'), 'gain', 0.25));
      expectSuccess(rig.session.setParameter(named('x'), 'loudness', 2));
      await rig.render(2);

      expect(
        kindsSent(rig.node).filter((kind) => kind === ToProcessorKind.SetParameter),
      ).toHaveLength(2);
      expect(rig.session.status.phase).toBe(PlaybackPhase.Ready);
      expect(rig.session.status.transport.mode).toBe(TransportMode.Playing);
      expect(rig.session.status.problems).toHaveLength(1);
      expect(rig.session.status.problems[0]).toContain('loudness');
      const refusals = records(rig, LogSeverity.Warning).filter(
        (record) => record.message === 'A node refused a parameter, which keeps its value.',
      );
      expect(refusals.map((record) => record.fields)).toEqual([
        { node: 'x', parameter: 'loudness', code: expect.any(String) },
      ]);
    });

    it('refuses a parameter when no graph is loaded', () => {
      const rig = new PlaybackRig();

      expect(expectFailureCode(rig.session.setParameter(named('x'), 'gain', 0.5))).toBe(
        'playback.not-ready',
      );
    });
  });

  describe('when the context changes under it', () => {
    it('freezes the position while the system holds the context, and plays on from it', async () => {
      const rig = await playing();
      await rig.render(9);
      const context = rig.current.context;

      context.becomes(AudioContextState.Suspended);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Suspended,
        position: 10 * QUANTUM,
        origin: 0,
      });
      await rig.render(5);
      expect(rig.position()).toBe(10 * QUANTUM);

      context.becomes(AudioContextState.Running);
      await rig.render(10);

      expect(rig.session.status.transport).toMatchObject({
        mode: TransportMode.Playing,
        origin: 0,
      });
      expect(rig.position()).toBe(20 * QUANTUM);
      expect(firstMismatch(played(rig.node, 0, 20 * QUANTUM), 0)).toBe(-1);
      expect(rig.session.status.stability).toMatchObject({ stable: true });
    });

    it('reports a device change, and hears the new latency in the audible position', async () => {
      const rig = await playing();
      const context = rig.current.context;

      context.outputLatency = 960 / 48_000;
      rig.devices.change();

      expect(rig.session.status.device?.outputLatencySeconds).toBe(960 / 48_000);
      expect(expectSuccess(rig.session.audiblePosition())).toBe(0);
      await rig.render(19);
      expect(expectSuccess(rig.session.audiblePosition())).toBe(20 * QUANTUM - 128 - 960);
    });

    it('stops with the reason when the device changes to one that cannot take every channel', async () => {
      const rig = await playing();
      await rig.render(4);
      const context = rig.current.context;

      context.destination.maxChannelCount = 1;
      rig.devices.change();
      await settle();

      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.session.status.problems).toEqual([
        expect.stringMatching(/output has 2 channels, but the output device takes at most 1/u),
      ]);
      expect(rig.session.status.transport.mode).toBe(TransportMode.Paused);
      expect(kindsSent(rig.node).at(-1)).toBe(ToProcessorKind.Halt);
    });

    it('shows the context waiting for a gesture after a device change it could not recover from, and playing once it has', async () => {
      const rig = await playing();
      await rig.render(4);
      const context = rig.current.context;
      const heard = published(rig);

      context.allowedToStart = false;
      context.becomes(AudioContextState.Suspended);
      rig.devices.change();
      rig.schedule.advance(GESTURE_WAIT_MILLISECONDS);
      await settle();

      expect(rig.session.status.contextState).toBe(LifecycleState.AwaitingGesture);
      expect(heard.at(-1)?.contextState).toBe(LifecycleState.AwaitingGesture);
      context.gesture();
      await settle();
      expect(rig.session.status.contextState).toBe(AudioContextState.Running);
      expect(rig.session.status.transport.mode).toBe(TransportMode.Playing);
    });

    it('unloads when the context is lost, and Play loads the graph again on a new one, with the same sources', async () => {
      const rig = await playing();
      await rig.render(9);
      const lostNode = rig.node;

      rig.current.context.becomes(AudioContextState.Closed);

      expect(rig.session.status).toMatchObject({
        phase: PlaybackPhase.Unloaded,
        transport: { mode: TransportMode.Paused, position: 10 * QUANTUM, origin: 0 },
        problems: [
          'The audio output stopped because the browser closed the audio device. Press Play to start again.',
        ],
      });
      expect(lostNode.disconnected).toBe(true);
      await settle();
      expect(rig.schedule.pending).toBe(0);

      expectSuccess(await rig.session.play());
      await rig.render(3);

      expect(rig.contexts).toHaveLength(2);
      expect(rig.node).not.toBe(lostNode);
      expect(rig.session.status.phase).toBe(PlaybackPhase.Ready);
      expect(rig.position()).toBe(10 * QUANTUM + 3 * QUANTUM);
      expect(firstMismatch(played(rig.node, 0, 3 * QUANTUM), 10 * QUANTUM)).toBe(-1);
      // The recorded audio was not sent again: the feeder kept it.
      expect(
        rig.feeder.received.filter((message) => message.kind === ToFeederKind.Sources),
      ).toHaveLength(1);
    });
  });

  describe('under each performance profile', () => {
    /** The whole of a two-second tone, played under `profile`, and what the feeds held. */
    async function underProfile(
      profile: typeof PerformanceProfile.LowLatency | typeof PerformanceProfile.MaximumStability,
    ) {
      const rig = new PlaybackRig({ profile });
      expectSuccess(
        await rig.session.load({
          quality: MAXIMUM_QUALITY,
          graph: halving(),
          sources: [tone(96_000)],
        }),
      );
      expectSuccess(await rig.session.play());
      await settle();
      const queuedAtStart = postedFrames(rig);
      const wake = rig.feeder.delays[0];
      await rig.render(Math.ceil(96_000 / QUANTUM) + 2);
      return {
        rig,
        queuedAtStart,
        wake,
        heard: playedQuanta(rig.node),
      };
    }

    it('changes how far ahead the feeder keeps and how often it looks, and nothing that plays', async () => {
      const low = await underProfile(PerformanceProfile.LowLatency);
      const stable = await underProfile(PerformanceProfile.MaximumStability);

      // 50 ms is 2 400 frames, six chunks of 384; 1 000 ms is 48 000, seven chunks of 6 016.
      expect(low.queuedAtStart).toBe(6 * 384);
      expect(stable.queuedAtStart).toBe(7 * 6_016);
      expect(low.wake).toBe((384 * 1000) / 48_000);
      expect(stable.wake).toBe((6_016 * 1000) / 48_000);
      expect(low.heard).toEqual(stable.heard);
      for (const { rig } of [low, stable]) {
        expect(rig.session.status.transport).toEqual({
          mode: TransportMode.Stopped,
          position: 96_000,
        });
        expect(rig.session.status.stability).toMatchObject({ stable: true, underrunsInWindow: 0 });
      }
    });
  });

  it('releases everything it made on dispose, the feeder worker with it', async () => {
    const rig = await playing();
    await rig.render(4);
    const heard = published(rig);

    rig.session.dispose();

    expect(rig.node.disconnected).toBe(true);
    expect(rig.node.listenerCount).toBe(0);
    expect(rig.feeder.terminated).toBe(true);
    expect(rig.feeder.listening).toBe(0);
    expect(rig.schedule.pending).toBe(0);
    rig.current.context.becomes(AudioContextState.Suspended);
    expect(heard).toEqual([]);
    await expect(rig.session.play()).rejects.toThrow('disposed');
  });
});

describe('what a loaded graph runs on the GPU', () => {
  it('says the browser offers none', async () => {
    const rig = new PlaybackRig();

    expectSuccess(
      await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [tone(4_800)],
      }),
    );

    expect(rig.session.status.gpu).toEqual({ kind: GpuUseKind.Unavailable });
  });

  it('says one is offered and no processor of the graph uses it', async () => {
    const rig = new PlaybackRig({ gpu: true });

    expectSuccess(
      await rig.session.load({
        quality: MAXIMUM_QUALITY,
        graph: halving(),
        sources: [tone(4_800)],
      }),
    );

    expect(rig.session.status.gpu).toEqual({ kind: GpuUseKind.Unused });
  });
});
