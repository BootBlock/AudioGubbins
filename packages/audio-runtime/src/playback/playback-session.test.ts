import { describe, expect, it, vi } from 'vitest';

import { StandardLayouts, sampleCount, sampleRate, type SampleCount } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { LogSeverity } from '@audiogubbins/diagnostics';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  DspImplementation,
  PerformanceProfile,
  REFERENCE_DSP,
  TransportMode,
  frameBlock,
  memorySource,
  toneSource,
  type PcmSource,
} from '@audiogubbins/audio-engine';

import { AudioContextState } from '../context/audio-context-port.js';
import { ENGINE_PROCESSOR_NAME } from '../processor/engine-processor-name.js';
import {
  FeedTransport,
  ToProcessorKind,
  type ToProcessor,
} from '../protocol/processor-messages.js';
import type { FakeWorkletNode } from '../testing/fake-worklet-node.js';
import { PlaybackRig, WORKLET_MODULE_URL, settle } from '../testing/playback-rig.js';
import { distinctChannels, graphOf, named, nodeOf, wire } from '../testing/render-graphs.js';
import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import { WorkletDspKind } from './loaded-processor.js';
import { PlaybackPhase } from './playback-status.js';

const STEREO = StandardLayouts.stereo;
const RATE = expectSuccess(sampleRate(48_000));
const QUANTUM = 128;
const IN = named('in');

/** Frames of the test source: half a second, not a whole number of quanta. */
const SOURCE_FRAMES = 24_000;

/** The Balanced profile's chunk: an eighth of 200 ms at 48 kHz, in whole quanta. */
const CHUNK = 1_280;

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

/** The test signal at timeline frame `frame` of channel `channel`, exact in f32 and when halved. */
function sourceSample(channel: number, frame: number): number {
  return ((channel + 1) * 1000 + (frame % 4096)) / 65_536;
}

function signalSource(frames = SOURCE_FRAMES, rate = RATE): PcmSource {
  return expectSuccess(
    memorySource(expectSuccess(frameBlock(STEREO, rate, distinctChannels(STEREO, frames)))),
  );
}

/** A source that answers no read from `frames` on, as a stalled disk would not. */
function stallingAfter(source: PcmSource, frames: number): PcmSource {
  return {
    ...source,
    read: (start, into, signal) =>
      start >= frames ? new Promise<number>(() => undefined) : source.read(start, into, signal),
  };
}

/** A source that counts how often it was released, which the session must never do. */
function counted(source: PcmSource): {
  readonly source: PcmSource;
  readonly released: () => number;
} {
  let released = 0;
  return {
    source: {
      ...source,
      release: () => {
        released += 1;
      },
    },
    released: () => released,
  };
}

function sources(source: PcmSource = signalSource()): ReadonlyMap<NodeId, PcmSource> {
  return new Map([[IN, source]]);
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

/** A rig with the halving graph loaded, playing from a gesture, and one quantum rendered. */
async function playing(
  rig = new PlaybackRig(),
  source: PcmSource = signalSource(),
): Promise<PlaybackRig> {
  expectSuccess(await rig.session.load({ graph: halving(), sources: sources(source) }));
  expectSuccess(await rig.session.play());
  await rig.render(1);
  return rig;
}

function records(rig: PlaybackRig, severity: LogSeverity) {
  return rig.store.snapshot().filter((record) => record.severity === severity);
}

describe('PlaybackSession', () => {
  describe('loading', () => {
    it('makes one node of the engine processor, shaped for the sink, and loads the graph with posted feeds', async () => {
      const rig = new PlaybackRig();

      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));

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
      expect(rig.session.status).toMatchObject({
        phase: PlaybackPhase.Ready,
        dsp: {
          implementation: DspImplementation.Reference,
          fallbackReason: 'This test compiles no DSP module.',
        },
        latencyFrames: 0,
        contextState: AudioContextState.Suspended,
        stability: { stable: true, underrunsInWindow: 0 },
        problems: [],
      });
    });

    it('binds a shared ring where memory can be shared', async () => {
      const rig = new PlaybackRig({ sharedMemory: true });

      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));

      const [binding] = loadSent(rig.node).feeds;
      expect(binding?.transport).toBe(FeedTransport.SharedRing);
      // The feed-ahead time plus one chunk, for 200 ms at 48 kHz in chunks of 1,280.
      expect(binding?.transport === FeedTransport.SharedRing && binding.ring.byteLength).toBe(
        7 * 4 + 2 * (9_600 + CHUNK) * 4,
      );
    });

    it('adds the processor module to a context once, however many graphs it loads', async () => {
      const rig = new PlaybackRig();

      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));
      const first = rig.node;
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));

      expect(rig.current.modules).toEqual([WORKLET_MODULE_URL]);
      expect(rig.current.nodes).toHaveLength(2);
      expect(first.disconnected).toBe(true);
      expect(first.listenerCount).toBe(0);
    });

    it('sends the DSP module’s bytes, which the processor compiles and runs', async () => {
      const bytes = dspModuleBytes();
      const rig = new PlaybackRig({ dsp: { kind: WorkletDspKind.Bytes, bytes } });

      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));

      const sent = loadSent(rig.node);
      expect(sent.dspModuleBytes).toBe(bytes);
      expect(sent.dspUnavailable).toBeUndefined();
      expect(rig.session.status.dsp).toEqual({
        implementation: DspImplementation.WebAssembly,
        fallbackReason: undefined,
      });
      // Copied into the message, not transferred: the bytes are kept for the next load.
      expect(bytes.byteLength).toBeGreaterThan(0);
    });

    it('sends no bytes where the page cannot compile WebAssembly, and says why', async () => {
      const rig = new PlaybackRig({
        webAssembly: false,
        dsp: { kind: WorkletDspKind.Bytes, bytes: dspModuleBytes() },
      });

      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));

      expect(loadSent(rig.node).dspModuleBytes).toBeUndefined();
      expect(rig.session.status.dsp?.implementation).toBe(DspImplementation.Reference);
      expect(rig.session.status.dsp?.fallbackReason).toMatch(/cannot compile WebAssembly/u);
    });

    it('settles a load the processor never answers after ten seconds, and says why', async () => {
      const rig = new PlaybackRig({ lost: (message) => kindOf(message) === ToProcessorKind.Load });

      const loading = rig.session.load({ graph: halving(), sources: sources() });
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

    it('adds the module once when two loads overlap, and the first stands down', async () => {
      const rig = new PlaybackRig();

      const first = rig.session.load({ graph: halving(), sources: sources() });
      const second = rig.session.load({ graph: halving(), sources: sources() });

      expect(expectFailureCode(await first)).toBe('playback.superseded');
      expectSuccess(await second);
      expect(rig.current.modules).toEqual([WORKLET_MODULE_URL]);
      expect(rig.current.nodes).toHaveLength(1);
    });

    it('faults a load whose processor module the browser refuses, and tries it again on the next', async () => {
      const rig = new PlaybackRig();
      rig.lifecycle.context();
      vi.spyOn(rig.current.context.audioWorklet, 'addModule').mockRejectedValueOnce(
        new Error('The module could not be fetched.'),
      );

      const refused = await rig.session.load({ graph: halving(), sources: sources() });

      expect(expectFailureCode(refused)).toBe('playback.processor-module-failed');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.current.nodes).toEqual([]);
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));
      expect(rig.session.status.phase).toBe(PlaybackPhase.Ready);
    });

    it('refuses a graph without exactly one output before any node is made', async () => {
      const rig = new PlaybackRig();
      const twoOutputs = graphOf(
        [
          nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
          nodeOf('a', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
          nodeOf('b', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
        ],
        [wire('in.out', 'a.in'), wire('in.out', 'b.in')],
      );

      const refused = await rig.session.load({ graph: twoOutputs, sources: sources() });

      expect(expectFailureCode(refused)).toBe('playback.graph-sinks');
      expect(rig.current.nodes).toEqual([]);
      expect(rig.current.modules).toEqual([]);
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

      const refused = await rig.session.load({ graph: dangling, sources: new Map() });

      expect(expectFailureCode(refused)).toBe('playback.graph-invalid');
      expect(rig.current.nodes).toEqual([]);
      expect(rig.session.status.phase).toBe(PlaybackPhase.Refused);
      expect(rig.session.status.problems.length).toBeGreaterThan(0);
    });

    it('refuses a source at another rate than the context’s, naming the explicit conversion', async () => {
      const rig = new PlaybackRig();
      const cd = expectSuccess(sampleRate(44_100));

      const refused = await rig.session.load({
        graph: halving(),
        sources: sources(signalSource(4_410, cd)),
      });

      expect(expectFailureCode(refused)).toBe('playback.source-rate-mismatch');
      expect(!refused.ok && refused.failures[0].summary).toContain('resampledSource');
      expect(rig.current.nodes).toEqual([]);
    });

    it('refuses a graph input without a source, and a source without a graph input', async () => {
      const rig = new PlaybackRig();

      const refused = await rig.session.load({
        graph: halving(),
        sources: new Map([[named('elsewhere'), signalSource()]]),
      });

      expect(!refused.ok && refused.failures.map((one) => one.code)).toEqual([
        'playback.source-missing',
        'playback.source-unbound',
      ]);
      expect(rig.current.nodes).toEqual([]);
    });
  });

  describe('playing', () => {
    it('starts the context from the gesture and anchors the transport where the processor started', async () => {
      const rig = new PlaybackRig();
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));
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

    it('tells the processor to start only once every feed has audio queued', async () => {
      const inner = signalSource();
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const rig = new PlaybackRig();
      const read: PcmSource['read'] = async (start, into, signal) => {
        await gate;
        return await inner.read(start, into, signal);
      };
      expectSuccess(
        await rig.session.load({ graph: halving(), sources: sources({ ...inner, read }) }),
      );

      const started = rig.session.play();
      await settle();
      expect(kindsSent(rig.node)).not.toContain(ToProcessorKind.Start);

      open();
      expectSuccess(await started);
      const sent = kindsSent(rig.node);
      expect(sent.indexOf(ToProcessorKind.FeedBlock)).toBeLessThan(
        sent.indexOf(ToProcessorKind.Start),
      );
      await rig.render(3);
      expect(rig.session.status.stability).toMatchObject({ stable: true });
    });

    it('returns the browser’s refusal to start audio without a gesture', async () => {
      const rig = new PlaybackRig();
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));
      rig.current.context.refuseResume = new Error('The request is not allowed.');

      const refused = await rig.session.play();

      expect(expectFailureCode(refused)).toBe('audio.context-resume-refused');
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
      expect(kindsSent(rig.node).slice(-2)).toEqual([ToProcessorKind.Halt, ToProcessorKind.Reset]);
    });

    it('plays a shared ring bit for bit', async () => {
      const rig = await playing(new PlaybackRig({ sharedMemory: true }));

      await rig.render(Math.ceil(SOURCE_FRAMES / QUANTUM) + 2);

      expect(firstMismatch(played(rig.node, 0, SOURCE_FRAMES), 0)).toBe(-1);
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Stopped,
        position: SOURCE_FRAMES,
      });
      expect(kindsSent(rig.node)).not.toContain(ToProcessorKind.FeedBlock);
    });

    it('plays an endless tone without ending', async () => {
      const tone = expectSuccess(
        toneSource(REFERENCE_DSP, {
          layout: STEREO,
          sampleRate: RATE,
          frequency: 440,
          amplitude: 0.5,
          length: undefined,
        }),
      );
      const rig = await playing(new PlaybackRig(), tone);

      await rig.render(40);

      expect(rig.session.status.transport.mode).toBe(TransportMode.Playing);
      expect(rig.position()).toBe(41 * QUANTUM);
      expect(rig.session.status.stability).toMatchObject({ stable: true });
    });

    it('pauses where it has reached, and plays on from there with the clock anchored anew', async () => {
      const rig = await playing();
      await rig.render(9);

      expectSuccess(rig.session.pause());
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
      // after the ten played and the four paused.
      const resumedAt = 14 * QUANTUM;
      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Playing,
        anchor: { contextFrame: resumedAt, timelineFrame: 10 * QUANTUM },
        origin: 0,
      });
      expect(rig.position()).toBe(10 * QUANTUM + (rig.frame - resumedAt));
      expect(firstMismatch(played(rig.node, resumedAt, 4 * QUANTUM), 10 * QUANTUM)).toBe(-1);
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

    it('seeks while stopped without starting anything', async () => {
      const rig = new PlaybackRig();
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));

      expectSuccess(await rig.session.seek(frames(4_000)));

      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Stopped,
        position: 4_000,
      });
      expect(kindsSent(rig.node)).toEqual([ToProcessorKind.Load]);
    });

    it('stops and returns to where the play began', async () => {
      const rig = await playing();
      await rig.render(10);

      expectSuccess(rig.session.stop());

      expect(rig.session.status.transport).toEqual({ mode: TransportMode.Stopped, position: 0 });
      expect(rig.position()).toBe(0);
      expect(kindsSent(rig.node).slice(-2)).toEqual([ToProcessorKind.Halt, ToProcessorKind.Reset]);
      // The pumps and their ticks stop with the run.
      expect(rig.schedule.pending).toBe(0);
    });

    it('cancels a play still on its way when paused', async () => {
      const rig = new PlaybackRig();
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));
      expectSuccess(await rig.session.play());

      expectSuccess(rig.session.pause());
      await rig.render(3);

      expect(rig.session.status.transport).toEqual({ mode: TransportMode.Stopped, position: 0 });
    });

    it('refuses to pause what is stopped', async () => {
      const rig = new PlaybackRig();
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));

      expect(expectFailureCode(rig.session.pause())).toBe('transport.pause-while-stopped');
    });

    it('shows the audible position behind the rendered one by the device’s latency', async () => {
      const rig = await playing();
      await rig.render(19);

      // 128 frames of the context's own and 480 of the device's, the fake's defaults.
      expect(expectSuccess(rig.session.audiblePosition())).toBe(20 * QUANTUM - 608);
    });
  });

  describe('observing the processor', () => {
    it('records a starved feed’s underruns, assesses them and logs each with its frame', async () => {
      const rig = await playing(new PlaybackRig(), stallingAfter(signalSource(), 2 * CHUNK));

      await rig.render(29);

      const stability = rig.session.status.stability;
      expect(stability).toMatchObject({
        stable: false,
        underrunsInWindow: 10,
        recommendation: PerformanceProfile.MaximumStability,
      });
      const underruns = records(rig, LogSeverity.Warning).filter(
        (record) => record.message === 'The audio device ran out of sound to play.',
      );
      expect(underruns.map((record) => record.fields)).toContainEqual({
        contextFrame: 2 * CHUNK,
        frames: QUANTUM,
      });
      expect(underruns).toHaveLength(10);
    });

    it('reports meters as the processor sends them', async () => {
      const rig = new PlaybackRig();
      expectSuccess(
        await rig.session.load({ graph: halving({ metered: true }), sources: sources() }),
      );
      expectSuccess(await rig.session.play());

      await rig.render(14);

      const level = rig.session.status.meters.get(named('level'));
      expect(level?.peak).toHaveLength(2);
      expect(level?.rms).toHaveLength(2);
      expect(level?.peak[1]).toBeGreaterThan(level?.peak[0] ?? 1);
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
      const failing = signalSource();
      // Past the time ahead, so the failing read comes after the start.
      const rig = await playing(new PlaybackRig(), {
        ...failing,
        read: (start, into, signal) =>
          start >= 12_000
            ? Promise.reject(new Error('The disk went away.'))
            : failing.read(start, into, signal),
      });

      await rig.render(40);

      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.session.status.problems).toEqual([
        'The audio for in could not be read: The disk went away.',
      ]);
      expect(rig.session.status.transport.mode).toBe(TransportMode.Paused);
      expect(kindsSent(rig.node).slice(-2)).toEqual([ToProcessorKind.Halt, ToProcessorKind.Reset]);
    });

    it('answers Play with the fault when a source fails before the processor starts', async () => {
      const failing = signalSource();
      const rig = new PlaybackRig();
      const read: PcmSource['read'] = (start, into, signal) =>
        start >= CHUNK
          ? Promise.reject(new Error('The disk went away.'))
          : failing.read(start, into, signal);
      expectSuccess(
        await rig.session.load({ graph: halving(), sources: sources({ ...failing, read }) }),
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
      expect(kindsSent(rig.node).slice(-2)).toEqual([ToProcessorKind.Halt, ToProcessorKind.Reset]);
    });

    it('ends a load at once when the answer to it cannot be received', async () => {
      const rig = new PlaybackRig({ lost: (message) => kindOf(message) === ToProcessorKind.Load });

      const loading = rig.session.load({ graph: halving(), sources: sources() });
      await settle();
      rig.node.replyFails();

      expect(expectFailureCode(await loading)).toBe('playback.processor-fault');
      expect(rig.session.status.phase).toBe(PlaybackPhase.Faulted);
      expect(rig.schedule.pending).toBe(0);
    });

    it('logs a malformed reply with its failure code and acts on none of it', async () => {
      const rig = new PlaybackRig();
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));
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
      expectSuccess(await rig.session.load({ graph: halving(), sources: sources() }));
      expectSuccess(await rig.session.play());
      expectSuccess(rig.session.pause());
      expectSuccess(await rig.session.play());

      // The first run's start, posted before its halt reached the processor,
      // lands only now.
      rig.node.reply({ kind: 'started', run: 1, contextFrame: 0 });
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

    it('ignores the end of a run halted since, and plays on', async () => {
      const rig = await playing();
      await rig.render(4);
      expectSuccess(await rig.session.seek(frames(1_000)));
      await rig.render(2);

      rig.node.reply({ kind: 'feeds-ended', run: 1, contextFrame: 5 * QUANTUM });
      rig.node.reply({ kind: 'underrun', run: 1, contextFrame: 5 * QUANTUM, frames: QUANTUM });
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

      expect(rig.session.status.transport).toEqual({
        mode: TransportMode.Playing,
        anchor: { contextFrame: 10 * QUANTUM, timelineFrame: 10 * QUANTUM },
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

    it('unloads when the context is lost, and Play loads the graph again on a new one', async () => {
      const source = counted(signalSource());
      const rig = await playing(new PlaybackRig(), source.source);
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
      expect(rig.schedule.pending).toBe(0);

      expectSuccess(await rig.session.play());
      await rig.render(3);

      expect(rig.contexts).toHaveLength(2);
      expect(rig.node).not.toBe(lostNode);
      expect(rig.session.status.phase).toBe(PlaybackPhase.Ready);
      expect(rig.position()).toBe(10 * QUANTUM + 3 * QUANTUM);
      expect(firstMismatch(played(rig.node, 0, 3 * QUANTUM), 10 * QUANTUM)).toBe(-1);
      expect(source.released()).toBe(0);
    });
  });

  it('releases everything it made on dispose, and none of the caller’s sources', async () => {
    const source = counted(signalSource());
    const rig = await playing(new PlaybackRig(), source.source);
    await rig.render(4);
    const heard: unknown[] = [];
    rig.session.subscribe((status) => heard.push(status));

    rig.session.dispose();

    expect(rig.node.disconnected).toBe(true);
    expect(rig.node.listenerCount).toBe(0);
    expect(rig.schedule.pending).toBe(0);
    expect(source.released()).toBe(0);
    rig.current.context.becomes(AudioContextState.Suspended);
    expect(heard).toEqual([]);
    await expect(rig.session.play()).rejects.toThrow('disposed');
  });
});
