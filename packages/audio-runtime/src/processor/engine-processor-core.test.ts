import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  ZERO_SAMPLES,
  sampleRate,
  succeed,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  GRAPH_DESCRIPTOR_VERSION,
  NodeRole,
  nodeId,
  type EdgeDescriptor,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
  type SettingValue,
} from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  DspImplementation,
  frameBlock,
  type NodeImplementation,
  type NodeImplementations,
} from '@audiogubbins/audio-engine';

import { RingWriter, createSampleRing } from '../feed/sample-ring.js';
import {
  FeedTransport,
  FromProcessorKind,
  ToProcessorKind,
  type FeedBinding,
  type FromProcessor,
  type ToProcessor,
} from '../protocol/processor-messages.js';
import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import { EngineProcessorCore } from './engine-processor-core.js';

const STEREO = StandardLayouts.stereo;
const RATE = expectSuccess(sampleRate(48_000));
const QUANTUM = 128;

/** What an output holds before the processor writes it, which no graph here produces. */
const STALE = 7;

function named(value: string): NodeId {
  return expectSuccess(nodeId(value));
}

function nodeOf(
  name: string,
  type: string,
  ports: { readonly inputs?: readonly string[]; readonly outputs?: readonly string[] },
  settings: Readonly<Record<string, SettingValue>> = {},
  layout: ChannelLayout = STEREO,
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id: named(name),
    type,
    inputs: (ports.inputs ?? []).map((port) => ({ name: port, layout })),
    outputs: (ports.outputs ?? []).map((port) => ({ name: port, layout })),
    settings,
  };
}

/** A wire from `node.port` to `node.port`. */
function wire(from: string, to: string): EdgeDescriptor {
  const [fromNode = '', fromPort = ''] = from.split('.');
  const [toNode = '', toPort = ''] = to.split('.');
  return {
    from: { node: named(fromNode), port: fromPort },
    to: { node: named(toNode), port: toPort },
  };
}

function graphOf(
  nodes: readonly ProcessingNodeDescriptor[],
  edges: readonly EdgeDescriptor[],
): GraphDescriptor {
  return { version: GRAPH_DESCRIPTOR_VERSION, nodes, edges };
}

const input = (name = 'in', layout: ChannelLayout = STEREO): ProcessingNodeDescriptor =>
  nodeOf(name, BuiltInNodeType.GraphInput, { outputs: ['out'] }, {}, layout);
const output = (name = 'out', layout: ChannelLayout = STEREO): ProcessingNodeDescriptor =>
  nodeOf(name, BuiltInNodeType.Output, { inputs: ['in'] }, {}, layout);

/** in → a node of `type` with `settings` → out. */
function through(type: string, settings: Readonly<Record<string, SettingValue>>): GraphDescriptor {
  return graphOf(
    [input(), nodeOf('x', type, { inputs: ['in'], outputs: ['out'] }, settings), output()],
    [wire('in.out', 'x.in'), wire('x.out', 'out.in')],
  );
}

/** in → out, with a meter named `level` on the input. */
function metered(): GraphDescriptor {
  return graphOf(
    [input(), nodeOf('level', BuiltInNodeType.Meter, { inputs: ['in'] }), output()],
    [wire('in.out', 'out.in'), wire('in.out', 'level.in')],
  );
}

const posted = (name = 'in', channels = 2): FeedBinding => ({
  node: named(name),
  transport: FeedTransport.Posted,
  channels,
});

function load(
  graph: GraphDescriptor,
  feeds: readonly FeedBinding[],
  options: {
    readonly meterEveryBlocks?: number;
    readonly dspModuleBytes?: Uint8Array<ArrayBuffer>;
  } = {},
): ToProcessor {
  return {
    kind: ToProcessorKind.Load,
    graph,
    dspModuleBytes: options.dspModuleBytes,
    dspUnavailable: undefined,
    feeds,
    meterEveryBlocks: options.meterEveryBlocks ?? 0,
  };
}

/** Channel `channel` at frame `frame` of the test signal, exact in f32 and when halved. */
function sampleAt(channel: number, frame: number): number {
  return ((channel + 1) * 1_000 + frame) / 65_536;
}

function signal(start: number, frames: number, channels = 2): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length: frames }, (__, frame) => sampleAt(channel, start + frame)),
  );
}

function constant(frames: number, value: number, channels = 2): Float32Array[] {
  return Array.from({ length: channels }, () => new Float32Array(frames).fill(value));
}

const feedBlock = (channels: readonly Float32Array[], name = 'in'): ToProcessor => ({
  kind: ToProcessorKind.FeedBlock,
  node: named(name),
  channels,
});

const START: ToProcessor = { kind: ToProcessorKind.Start, run: 1 };

/** A core at 48 kHz and every message it posted. */
function processor(implementations?: NodeImplementations): {
  core: EngineProcessorCore;
  posts: FromProcessor[];
} {
  const posts: FromProcessor[] = [];
  const core = new EngineProcessorCore({
    sampleRate: 48_000,
    post: (message) => {
      posts.push(message);
    },
    ...(implementations === undefined ? {} : { implementations }),
  });
  return { core, posts };
}

/** Renders one quantum at `frame` into a stale output of `channels` channels, and answers it. */
function quantum(core: EngineProcessorCore, frame: number, channels = 2): Float32Array[] {
  const out = Array.from({ length: channels }, () => new Float32Array(QUANTUM).fill(STALE));
  core.process(out, frame);
  return out;
}

const silent = (channels: readonly Float32Array[]): boolean =>
  channels.every((channel) => channel.every((sample) => sample === 0));

const kinds = (posts: readonly FromProcessor[]): readonly string[] =>
  posts.map((post) => post.kind);

describe('the engine processor', () => {
  it('plays posted audio through the graph, bit for bit, from the quantum it started', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 0.5 }), [posted()]));
    expect(posts).toEqual([
      {
        kind: FromProcessorKind.Loaded,
        dsp: DspImplementation.Reference,
        dspFallbackReason: 'No compiled DSP module was provided.',
        latencyFrames: 0,
      },
    ]);
    let start = 0;
    for (const frames of [100, 200, 84]) {
      core.receive(feedBlock(signal(start, frames)));
      start += frames;
    }
    // Loading halts, so nothing plays until the start.
    expect(silent(quantum(core, 1_152))).toBe(true);
    core.receive(START);
    const rendered = [1_280, 1_408, 1_536].map((frame) => quantum(core, frame));
    expect(posts.slice(1)).toEqual([
      { kind: FromProcessorKind.Started, run: 1, contextFrame: 1_280 },
    ]);
    rendered.forEach((out, index) => {
      const expected = signal(index * QUANTUM, QUANTUM).map((channel) =>
        channel.map((sample) => Math.fround(sample * 0.5)),
      );
      expect(out).toEqual(expected);
    });
  });

  it('reports an underrun once per short quantum, with its frame and the frames it lacked', () => {
    const { core, posts } = processor();
    const graph = graphOf(
      [
        input('one'),
        input('two'),
        nodeOf('sum', BuiltInNodeType.Mix, { inputs: ['a', 'b'], outputs: ['out'] }),
        output(),
      ],
      [wire('one.out', 'sum.a'), wire('two.out', 'sum.b'), wire('sum.out', 'out.in')],
    );
    core.receive(load(graph, [posted('one'), posted('two')]));
    core.receive(feedBlock(constant(128, 0.25), 'one'));
    core.receive(feedBlock(constant(60, 0.25), 'two'));
    core.receive(START);
    const first = quantum(core, 0);
    quantum(core, 128);
    expect(posts.filter((post) => post.kind === FromProcessorKind.Underrun)).toEqual([
      // Both feeds were short of the second quantum; one message says so.
      { kind: FromProcessorKind.Underrun, run: 1, contextFrame: 0, frames: 68 },
      { kind: FromProcessorKind.Underrun, run: 1, contextFrame: 128, frames: 128 },
    ]);
    // The short feed's missing frames are silence, not repeated audio.
    expect(first[0]?.[59]).toBe(0.5);
    expect(first[0]?.[60]).toBe(0.25);
  });

  it('says every feed has ended once its last frame has come through the latency', () => {
    const { core, posts } = processor();
    core.receive(
      load(through(BuiltInNodeType.Delay, { frames: 200, 'as-latency': true }), [posted()]),
    );
    expect(posts[0]).toMatchObject({ kind: FromProcessorKind.Loaded, latencyFrames: 200 });
    core.receive(feedBlock(signal(0, 300)));
    core.receive({ kind: ToProcessorKind.FeedEnd, node: named('in') });
    core.receive(START);
    const heard: Float32Array[] = [];
    const endedAfter: number[] = [];
    for (let frame = 1_280; frame < 2_304; frame += QUANTUM) {
      const before = posts.length;
      heard.push(...quantum(core, frame).slice(0, 1));
      const said = posts.slice(before).map((post) => post.kind);
      if (said.includes(FromProcessorKind.FeedsEnded)) endedAfter.push(frame);
    }
    // The last frame supplied is at 1_579, heard 200 frames later at 1_779.
    expect(posts.filter((post) => post.kind === FromProcessorKind.FeedsEnded)).toEqual([
      { kind: FromProcessorKind.FeedsEnded, run: 1, contextFrame: 1_780 },
    ]);
    expect(endedAfter).toEqual([1_664]);
    expect(kinds(posts)).not.toContain(FromProcessorKind.Underrun);
    const played = heard.flatMap((channel) => [...channel]);
    expect(played[499]).toBe(sampleAt(0, 299));
    expect(played.slice(500).every((sample) => sample === 0)).toBe(true);
  });

  it('outputs silence while halted and carries on from where it was when started again', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receive(feedBlock(signal(0, 256)));
    core.receive(START);
    expect(quantum(core, 0)).toEqual(signal(0, 128));
    core.receive({ kind: ToProcessorKind.Halt });
    expect(silent(quantum(core, 128))).toBe(true);
    core.receive({ kind: ToProcessorKind.Start, run: 2 });
    expect(quantum(core, 256)).toEqual(signal(128, 128));
    // Each start's reply names the run it started.
    expect(posts.filter((post) => post.kind === FromProcessorKind.Started)).toEqual([
      { kind: FromProcessorKind.Started, run: 1, contextFrame: 0 },
      { kind: FromProcessorKind.Started, run: 2, contextFrame: 256 },
    ]);
    expect(kinds(posts)).not.toContain(FromProcessorKind.Underrun);
  });

  it('discards queued audio and the graph’s history on a reset', () => {
    const { core } = processor();
    core.receive(load(through(BuiltInNodeType.Delay, { frames: 64 }), [posted()]));
    core.receive(feedBlock(constant(256, 0.5)));
    core.receive(START);
    quantum(core, 0);
    core.receive({ kind: ToProcessorKind.Reset });
    core.receive(feedBlock(constant(128, 0.25)));
    const after = quantum(core, 128);
    // A fresh delay line: 64 frames of silence, then only the new audio.
    for (const channel of after) {
      expect(channel.subarray(0, 64).every((sample) => sample === 0)).toBe(true);
      expect(channel.subarray(64).every((sample) => sample === 0.25)).toBe(true);
    }
  });

  it('plays a ring’s audio, and after a seek only the audio written after the discard', () => {
    const { core, posts } = processor();
    const memory = expectSuccess(createSampleRing(2, 1_024));
    const writer = expectSuccess(RingWriter.open(memory));
    writer.write(expectSuccess(frameBlock(STEREO, RATE, signal(0, 256))));
    core.receive(
      load(through(BuiltInNodeType.Gain, { gain: 0.5 }), [
        { node: named('in'), transport: FeedTransport.SharedRing, channels: 2, ring: memory },
      ]),
    );
    core.receive(START);
    expect(quantum(core, 0)).toEqual(
      signal(0, 128).map((channel) => channel.map((sample) => Math.fround(sample * 0.5))),
    );
    core.receive({ kind: ToProcessorKind.Halt });
    writer.discard();
    writer.write(expectSuccess(frameBlock(STEREO, RATE, constant(128, 0.25))));
    core.receive({ kind: ToProcessorKind.Reset });
    core.receive(START);
    expect(quantum(core, 256)).toEqual(constant(128, 0.125));
    expect(kinds(posts)).not.toContain(FromProcessorKind.Underrun);
  });

  it('reports a meter every so many blocks, over every block since the last report', () => {
    const { core, posts } = processor();
    core.receive(load(metered(), [posted()], { meterEveryBlocks: 2 }));
    for (const value of [0.5, 0.25, 0.5, 0.5]) core.receive(feedBlock(constant(128, value)));
    core.receive(START);
    for (let frame = 0; frame < 4 * QUANTUM; frame += QUANTUM) quantum(core, frame);
    const meters = posts.flatMap((post) => (post.kind === FromProcessorKind.Meter ? [post] : []));
    expect(meters).toHaveLength(2);
    const [first, second] = meters;
    // The window's peak is its largest, and its level is over all its frames.
    expect(first?.node).toBe(named('level'));
    expect(first?.peak).toEqual([0.5, 0.5]);
    expect(first?.rms[1]).toBeCloseTo(Math.sqrt((0.5 * 0.5 + 0.25 * 0.25) / 2), 12);
    expect(second).toMatchObject({ peak: [0.5, 0.5], rms: [0.5, 0.5] });
  });

  it('reports no meter when the load asks for none', () => {
    const { core, posts } = processor();
    core.receive(load(metered(), [posted()]));
    core.receive(feedBlock(constant(512, 0.5)));
    core.receive(START);
    for (let frame = 0; frame < 4 * QUANTUM; frame += QUANTUM) quantum(core, frame);
    expect(kinds(posts)).not.toContain(FromProcessorKind.Meter);
  });

  it('runs the WebAssembly DSP when its bytes are sent, with the reference path’s bits', () => {
    const tone = graphOf(
      [
        nodeOf(
          'tone',
          BuiltInNodeType.Tone,
          { outputs: ['out'] },
          { frequency: 997, amplitude: 0.5 },
        ),
        output(),
      ],
      [wire('tone.out', 'out.in')],
    );
    const [wasm, reference] = [{ dspModuleBytes: dspModuleBytes() }, {}].map((options) => {
      const { core, posts } = processor();
      core.receive(load(tone, [], options));
      core.receive(START);
      const out = Array.from({ length: 8 }, (_, index) => quantum(core, index * QUANTUM));
      return { loaded: posts[0], out };
    });
    expect(wasm?.loaded).toMatchObject({
      dsp: DspImplementation.WebAssembly,
      dspFallbackReason: undefined,
    });
    expect(reference?.loaded).toMatchObject({ dsp: DspImplementation.Reference });
    expect(wasm?.out.some((channels) => !silent(channels))).toBe(true);
    expect(wasm?.out).toEqual(reference?.out);
  });

  it('compiles the DSP from its bytes, and runs the reference path with the reason when they will not', () => {
    const damaged = dspModuleBytes().slice(0, 40);
    const { core, posts } = processor();
    core.receive(
      load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()], { dspModuleBytes: damaged }),
    );
    expect(posts[0]).toMatchObject({
      kind: FromProcessorKind.Loaded,
      dsp: DspImplementation.Reference,
      dspFallbackReason: expect.stringMatching(
        /^The DSP module could not be compiled in the audio thread: /u,
      ),
    });
  });

  it('faults when a message from the main thread cannot be received', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.messageFailed();
    expect(posts.at(-1)).toEqual({
      kind: FromProcessorKind.Fault,
      message:
        'A message from the main thread could not be received by the audio processor, so what it plays is in doubt.',
    });
  });

  it('refuses a graph with every reason it cannot run, and outputs silence', () => {
    const { core, posts } = processor();
    const graph = graphOf(
      [input(), input('spare'), output('left'), output('right')],
      [wire('in.out', 'left.in'), wire('spare.out', 'right.in')],
    );
    core.receive(load(graph, [posted('in', 1), posted('left')]));
    const [refused] = posts;
    const reasons = refused?.kind === FromProcessorKind.Refused ? refused.reasons : [];
    expect(reasons).toHaveLength(4);
    expect(reasons[0]).toMatch(/2 outputs/u);
    expect(reasons[1]).toMatch(/in has 1 channels/u);
    expect(reasons[2]).toMatch(/left, which is not a graph input/u);
    expect(reasons[3]).toMatch(/spare has no feed/u);
    core.receive(START);
    expect(silent(quantum(core, 0))).toBe(true);
  });

  it('refuses a graph its own checks refuse', () => {
    const { core, posts } = processor();
    core.receive(load(through('no-such-type', {}), [posted()]));
    expect(posts[0]?.kind).toBe(FromProcessorKind.Refused);
  });

  it('faults on a message it cannot read, without throwing, and plays nothing until a load', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receive(feedBlock(signal(0, 512)));
    core.receive(START);
    quantum(core, 0);
    expect(() => {
      core.receive({ kind: 'play' });
    }).not.toThrow();
    const fault = posts.at(-1);
    expect(fault?.kind === FromProcessorKind.Fault ? fault.message : '').toContain(
      "message's kind",
    );
    core.receive(START);
    expect(silent(quantum(core, 128))).toBe(true);
    // A fault is said once; what follows it is its consequence.
    core.receive({ kind: 'play' });
    expect(posts.filter((post) => post.kind === FromProcessorKind.Fault)).toHaveLength(1);
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receive(feedBlock(signal(0, 128)));
    core.receive(START);
    expect(quantum(core, 256)).toEqual(signal(0, 128));
  });

  it('faults when a kernel throws, and outputs silence from then on', () => {
    let calls = 0;
    const exploding: NodeImplementation = {
      type: 'explode',
      role: NodeRole.Source,
      check: () => [],
      latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
      createKernel: () =>
        succeed({
          process: (_inputs, outputs) => {
            calls += 1;
            if (calls === 2) throw new Error('The kernel gave up.');
            for (const channel of outputs[0]?.channels ?? []) channel.fill(0.5);
          },
          setParameter: () => succeed(undefined),
          release: () => undefined,
        }),
    };
    const { core, posts } = processor(new Map([...BUILT_IN_NODES, ['explode', exploding]]));
    const graph = graphOf(
      [nodeOf('boom', 'explode', { outputs: ['out'] }), output()],
      [wire('boom.out', 'out.in')],
    );
    core.receive(load(graph, []));
    core.receive(START);
    expect(quantum(core, 0)).toEqual(constant(128, 0.5));
    expect(silent(quantum(core, 128))).toBe(true);
    expect(posts.at(-1)).toEqual({
      kind: FromProcessorKind.Fault,
      message: 'Processing stopped: The kernel gave up.',
    });
    const said = posts.length;
    expect(silent(quantum(core, 256))).toBe(true);
    expect(posts).toHaveLength(said);
    expect(calls).toBe(2);
  });

  it('faults on a start with nothing loaded, and on audio for an input with no posted feed', () => {
    const early = processor();
    early.core.receive(START);
    expect(early.posts).toEqual([
      { kind: FromProcessorKind.Fault, message: 'Nothing is loaded to start.' },
    ]);
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receive(feedBlock(signal(0, 128), 'x'));
    expect(posts.at(-1)?.kind).toBe(FromProcessorKind.Fault);
  });

  it('leaves a refused parameter as it was, says why without a fault, and keeps playing', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receive(feedBlock(signal(0, 256)));
    core.receive(START);
    quantum(core, 0);
    core.receive({
      kind: ToProcessorKind.SetParameter,
      node: named('x'),
      name: 'loudness',
      value: 2,
    });
    expect(quantum(core, 128)).toEqual(signal(128, 128));
    expect(kinds(posts)).toEqual([
      FromProcessorKind.Loaded,
      FromProcessorKind.Started,
      FromProcessorKind.ParameterRefused,
    ]);
    expect(posts.at(-1)).toMatchObject({
      kind: FromProcessorKind.ParameterRefused,
      node: named('x'),
      name: 'loudness',
      failures: [{ code: expect.any(String), summary: expect.any(String) }],
    });
  });

  it('silences output channels the graph does not fill, and faults rather than drop one', () => {
    const mono = StandardLayouts.mono;
    const monoGraph = graphOf([input('in', mono), output('out', mono)], [wire('in.out', 'out.in')]);
    const wide = processor();
    wide.core.receive(load(monoGraph, [posted('in', 1)]));
    wide.core.receive(feedBlock(signal(0, 128, 1)));
    wide.core.receive(START);
    const out = quantum(wide.core, 0, 2);
    expect(out[0]).toEqual(signal(0, 128, 1)[0]);
    expect(out[1]?.every((sample) => sample === 0)).toBe(true);

    const narrow = processor();
    narrow.core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    narrow.core.receive(feedBlock(signal(0, 128)));
    narrow.core.receive(START);
    expect(silent(quantum(narrow.core, 0, 1))).toBe(true);
    expect(narrow.posts.at(-1)?.kind).toBe(FromProcessorKind.Fault);
  });
});
