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

import { POSTED_FEED_BLOCKS } from '../feed/posted-feed.js';
import { RingWriter, createSampleRing } from '../feed/sample-ring.js';
import {
  FromProcessorFeedKind,
  ToProcessorFeedKind,
  type FromProcessorFeed,
  type ToProcessorFeed,
} from '../protocol/feed-messages.js';
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

/** in → out, with a meter named `level` on the input, correlating the pair where asked. */
function metered(settings: Readonly<Record<string, SettingValue>> = {}): GraphDescriptor {
  return graphOf(
    [input(), nodeOf('level', BuiltInNodeType.Meter, { inputs: ['in'] }, settings), output()],
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
    readonly reportEveryBlocks?: number;
    readonly dspModuleBytes?: Uint8Array<ArrayBuffer>;
  } = {},
): ToProcessor {
  return {
    kind: ToProcessorKind.Load,
    graph,
    dspModuleBytes: options.dspModuleBytes,
    dspUnavailable: undefined,
    feeds,
    reportEveryBlocks: options.reportEveryBlocks ?? 0,
    feeder: undefined,
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

const feedBlock = (channels: readonly Float32Array[], name = 'in'): ToProcessorFeed => ({
  kind: ToProcessorFeedKind.Block,
  node: named(name),
  channels,
});

const feedEnd = (name = 'in'): ToProcessorFeed => ({
  kind: ToProcessorFeedKind.End,
  node: named(name),
});

const rewind = (epoch: number): ToProcessorFeed => ({ kind: ToProcessorFeedKind.Rewind, epoch });

/** A start of run `run`, of the audio of run `epoch`, from timeline frame `from` where fresh. */
const start = (run: number, epoch = run, from = 0): ToProcessor => ({
  kind: ToProcessorKind.Start,
  run,
  epoch,
  from,
});

const HALT: ToProcessor = { kind: ToProcessorKind.Halt };

/** A core at 48 kHz, every message it posted to the main thread, and every one to the feeder. */
function processor(implementations?: NodeImplementations): {
  core: EngineProcessorCore;
  posts: FromProcessor[];
  toFeeder: FromProcessorFeed[];
} {
  const posts: FromProcessor[] = [];
  const toFeeder: FromProcessorFeed[] = [];
  const core = new EngineProcessorCore({
    sampleRate: 48_000,
    post: (message) => {
      posts.push(message);
    },
    connectFeeder: () => undefined,
    postToFeeder: (message) => {
      toFeeder.push(message);
    },
    ...(implementations === undefined ? {} : { implementations }),
  });
  return { core, posts, toFeeder };
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

function ofKind<TKind extends FromProcessor['kind']>(
  posts: readonly FromProcessor[],
  kind: TKind,
): Extract<FromProcessor, { readonly kind: TKind }>[] {
  return posts.filter(
    (post): post is Extract<FromProcessor, { readonly kind: TKind }> => post.kind === kind,
  );
}

describe('the engine processor', () => {
  it('plays posted audio through the graph, bit for bit, from the quantum it started', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 0.5 }), [posted()]));
    expect(posts).toEqual([
      {
        kind: FromProcessorKind.Loaded,
        dsp: DspImplementation.Reference,
        dspFallbackReason: 'No compiled DSP module was provided.',
        dspInUse: false,
        latencyFrames: 0,
      },
    ]);
    core.receiveFeed(rewind(1));
    let from = 0;
    for (const frames of [100, 200, 84]) {
      core.receiveFeed(feedBlock(signal(from, frames)));
      from += frames;
    }
    // Loading halts, so nothing plays until the start.
    expect(silent(quantum(core, 1_152))).toBe(true);
    core.receive(start(1));
    const rendered = [1_280, 1_408, 1_536].map((frame) => quantum(core, frame));
    expect(posts.slice(1)).toEqual([
      { kind: FromProcessorKind.Started, run: 1, contextFrame: 1_280, position: 0 },
    ]);
    rendered.forEach((out, index) => {
      const expected = signal(index * QUANTUM, QUANTUM).map((channel) =>
        channel.map((sample) => Math.fround(sample * 0.5)),
      );
      expect(out).toEqual(expected);
    });
  });

  it('runs no quantum some feed cannot supply whole: silence, nothing consumed, and the count held', () => {
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
    core.receive(load(graph, [posted('one'), posted('two')], { reportEveryBlocks: 3 }));
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(constant(256, 0.25), 'one'));
    core.receiveFeed(feedBlock(constant(60, 0.5), 'two'));
    core.receive(start(1));
    // The second feed is 68 frames short of the quantum: the whole quantum waits.
    expect(silent(quantum(core, 0))).toBe(true);
    expect(silent(quantum(core, 128))).toBe(true);
    core.receiveFeed(feedBlock(constant(196, 0.5), 'two'));
    // Then both feeds give the frames that were due, in step with each other.
    expect(quantum(core, 256)).toEqual(constant(128, 0.75));
    expect(ofKind(posts, FromProcessorKind.Report)).toEqual([
      {
        kind: FromProcessorKind.Report,
        run: 1,
        contextFrame: 384,
        position: 128,
        underrunFrames: 256,
        underruns: 2,
        meters: [],
      },
    ]);
  });

  it('sums a sustained underrun into one report per so many quanta, not a message a quantum', () => {
    const { core, posts } = processor();
    core.receive(load(metered({ correlate: [0, 1] }), [posted()], { reportEveryBlocks: 12 }));
    core.receiveFeed(rewind(1));
    core.receive(start(1));
    const before = posts.length;
    for (let index = 0; index < 120; index += 1) quantum(core, index * QUANTUM);
    const said = posts.slice(before);
    expect(kinds(said)).toEqual([
      FromProcessorKind.Started,
      ...Array.from({ length: 10 }, () => FromProcessorKind.Report),
    ]);
    expect(ofKind(said, FromProcessorKind.Report).every((report) => report.underruns === 12)).toBe(
      true,
    );
    expect(ofKind(said, FromProcessorKind.Report)[0]).toMatchObject({
      underrunFrames: 12 * QUANTUM,
      position: 0,
      // No block reached the meter, so it says nothing rather than a level of silence.
      meters: [],
    });
  });

  it('counts the frames that have left the graph: its latency later, and never past the end', () => {
    const { core, posts } = processor();
    core.receive(
      load(through(BuiltInNodeType.Delay, { frames: 200, 'as-latency': true }), [posted()], {
        reportEveryBlocks: 1,
      }),
    );
    expect(posts[0]).toMatchObject({ kind: FromProcessorKind.Loaded, latencyFrames: 200 });
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(signal(0, 300)));
    core.receiveFeed(feedEnd());
    core.receive(start(1, 1, 5_000));
    const heard: Float32Array[] = [];
    for (let frame = 1_280; frame < 2_304; frame += QUANTUM) {
      heard.push(...quantum(core, frame).slice(0, 1));
    }
    // The first frame reaches the output 200 frames after the start.
    expect(ofKind(posts, FromProcessorKind.Started)).toEqual([
      { kind: FromProcessorKind.Started, run: 1, contextFrame: 1_480, position: 5_000 },
    ]);
    expect(ofKind(posts, FromProcessorKind.Report).map((report) => report.position)).toEqual([
      5_000, 5_056, 5_184, 5_300, 5_300, 5_300, 5_300, 5_300,
    ]);
    // The last frame supplied, 299, reaches the output at 1 280 + 499, so the end is heard at 1 780.
    expect(ofKind(posts, FromProcessorKind.FeedsEnded)).toEqual([
      { kind: FromProcessorKind.FeedsEnded, run: 1, contextFrame: 1_780, position: 5_300 },
    ]);
    expect(ofKind(posts, FromProcessorKind.Report).every((report) => report.underruns === 0)).toBe(
      true,
    );
    const played = heard.flatMap((channel) => [...channel]);
    expect(played[499]).toBe(sampleAt(0, 299));
    expect(played.slice(500).every((sample) => sample === 0)).toBe(true);
  });

  it('halts where it is, says where, and goes on with the very next frame', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(signal(0, 256)));
    core.receive(start(1));
    expect(quantum(core, 0)).toEqual(signal(0, 128));
    core.receive(HALT);
    expect(silent(quantum(core, 128))).toBe(true);
    core.receive(start(2, 1, 128));
    expect(quantum(core, 256)).toEqual(signal(128, 128));
    expect(ofKind(posts, FromProcessorKind.Halted)).toEqual([
      { kind: FromProcessorKind.Halted, run: 1, contextFrame: 128, position: 128 },
    ]);
    // Each start's reply names the run it started, and the count it goes on from.
    expect(ofKind(posts, FromProcessorKind.Started)).toEqual([
      { kind: FromProcessorKind.Started, run: 1, contextFrame: 0, position: 0 },
      { kind: FromProcessorKind.Started, run: 2, contextFrame: 256, position: 128 },
    ]);
  });

  it('keeps a latent graph’s history through a halt, so a pause loses no frame', () => {
    const graph = through(BuiltInNodeType.Delay, { frames: 300, 'as-latency': true });
    const play = (halts: readonly number[]): number[] => {
      const { core } = processor();
      core.receive(load(graph, [posted()]));
      core.receiveFeed(rewind(1));
      core.receiveFeed(feedBlock(signal(0, 1_024)));
      core.receiveFeed(feedEnd());
      core.receive(start(1));
      const heard: number[] = [];
      let frame = 0;
      let run = 1;
      for (let index = 0; index < 12; index += 1) {
        if (halts.includes(index)) {
          core.receive(HALT);
          quantum(core, frame);
          frame += QUANTUM;
          run += 1;
          core.receive(start(run, 1, 0));
        }
        heard.push(...(quantum(core, frame)[0] ?? []));
        frame += QUANTUM;
      }
      return heard;
    };
    expect(play([2, 5, 6])).toEqual(play([]));
  });

  it('starts other audio only once the feeds are rewound to it, with the graph made again', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Delay, { frames: 64 }), [posted()]));
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(constant(256, 0.5)));
    core.receive(start(1));
    quantum(core, 0);
    core.receive(HALT);
    // A seek: the start of run 2 lands before the feeder's rewind to it.
    core.receive(start(2, 2, 9_000));
    expect(silent(quantum(core, 128))).toBe(true);
    expect(ofKind(posts, FromProcessorKind.Started)).toHaveLength(1);
    core.receiveFeed(rewind(2));
    core.receiveFeed(feedBlock(constant(128, 0.25)));
    const after = quantum(core, 256);
    expect(ofKind(posts, FromProcessorKind.Started).at(-1)).toEqual({
      kind: FromProcessorKind.Started,
      run: 2,
      contextFrame: 256,
      position: 9_000,
    });
    // A fresh delay line: 64 frames of silence, then only the new audio.
    for (const channel of after) {
      expect(channel.subarray(0, 64).every((sample) => sample === 0)).toBe(true);
      expect(channel.subarray(64).every((sample) => sample === 0.25)).toBe(true);
    }
  });

  it('halts at a rewind that lands while it runs, since what it would play next is the old audio', () => {
    const { core } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(signal(0, 512)));
    core.receive(start(1));
    quantum(core, 0);
    core.receiveFeed(rewind(2));
    core.receiveFeed(feedBlock(constant(512, 0.25)));
    expect(silent(quantum(core, 128))).toBe(true);
  });

  it('plays a ring’s audio, and after a rewind only the audio written after the discard', () => {
    const { core, posts } = processor();
    const memory = expectSuccess(createSampleRing(2, 1_024));
    const writer = expectSuccess(RingWriter.open(memory));
    core.receive(
      load(through(BuiltInNodeType.Gain, { gain: 0.5 }), [
        { node: named('in'), transport: FeedTransport.SharedRing, channels: 2, ring: memory },
      ]),
    );
    writer.discard();
    core.receiveFeed(rewind(1));
    writer.write(expectSuccess(frameBlock(STEREO, RATE, signal(0, 256))));
    core.receive(start(1));
    expect(quantum(core, 0)).toEqual(
      signal(0, 128).map((channel) => channel.map((sample) => Math.fround(sample * 0.5))),
    );
    core.receive(HALT);
    writer.discard();
    core.receiveFeed(rewind(2));
    writer.write(expectSuccess(frameBlock(STEREO, RATE, constant(128, 0.25))));
    core.receive(start(2, 2, 4_000));
    expect(quantum(core, 256)).toEqual(constant(128, 0.125));
    expect(ofKind(posts, FromProcessorKind.Started).at(-1)).toMatchObject({ position: 4_000 });
  });

  it('tells the feeder of each posted block read whole, naming the audio it belonged to', () => {
    const { core, toFeeder } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receiveFeed(rewind(3));
    for (const frames of [100, 100, 200]) core.receiveFeed(feedBlock(signal(0, frames)));
    core.receive(start(3));
    quantum(core, 0);
    quantum(core, 128);
    quantum(core, 256);
    const consumed = (frames: number): FromProcessorFeed => ({
      kind: FromProcessorFeedKind.Consumed,
      epoch: 3,
      node: named('in'),
      frames,
    });
    // 128 frames reach past the first block; 256 past the second; 384 leave the third unfinished.
    expect(toFeeder).toEqual([consumed(100), consumed(100)]);
  });

  it('reports every meter in one message, over every block since the last, with the pair’s correlation', () => {
    const { core, posts } = processor();
    core.receive(load(metered({ correlate: [0, 1] }), [posted()], { reportEveryBlocks: 2 }));
    core.receiveFeed(rewind(1));
    for (const value of [0.5, 0.25, 0.5, 0.5]) core.receiveFeed(feedBlock(constant(128, value)));
    core.receive(start(1));
    for (let frame = 0; frame < 4 * QUANTUM; frame += QUANTUM) quantum(core, frame);
    const reports = ofKind(posts, FromProcessorKind.Report);
    expect(reports).toHaveLength(2);
    const [first, second] = reports.map((report) => report.meters);
    // The window's peak is its largest, and its level is over all its frames.
    expect(first).toHaveLength(1);
    expect(first?.[0]?.node).toBe(named('level'));
    expect(first?.[0]?.peak).toEqual([0.5, 0.5]);
    expect(first?.[0]?.rms[1]).toBeCloseTo(Math.sqrt((0.5 * 0.5 + 0.25 * 0.25) / 2), 12);
    expect(second?.[0]).toMatchObject({ peak: [0.5, 0.5], rms: [0.5, 0.5] });
    // A constant block does not vary, so it correlates with nothing.
    expect(first?.[0]?.correlation).toEqual([0]);
  });

  it('carries the correlation of a pair that moves together, and one that moves against itself', () => {
    const { core, posts } = processor();
    core.receive(load(metered({ correlate: [0, 1] }), [posted()], { reportEveryBlocks: 2 }));
    core.receiveFeed(rewind(1));
    const ramp = Float32Array.from({ length: 256 }, (_, frame) => (frame % 64) / 64 - 0.5);
    core.receiveFeed(feedBlock([ramp, ramp.map((sample) => -sample)]));
    core.receive(start(1));
    quantum(core, 0);
    quantum(core, 128);
    expect(ofKind(posts, FromProcessorKind.Report)[0]?.meters[0]?.correlation).toEqual([-1]);
  });

  it('reports nothing when the load asks for no reports', () => {
    const { core, posts } = processor();
    core.receive(load(metered(), [posted()]));
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(constant(512, 0.5)));
    core.receive(start(1));
    for (let frame = 0; frame < 4 * QUANTUM; frame += QUANTUM) quantum(core, frame);
    expect(kinds(posts)).not.toContain(FromProcessorKind.Report);
  });

  it('runs the WebAssembly DSP when its bytes are sent, with the reference path’s bits, and says a node uses it', () => {
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
      core.receive(start(1));
      const out = Array.from({ length: 8 }, (_, index) => quantum(core, index * QUANTUM));
      return { loaded: posts[0], out };
    });
    expect(wasm?.loaded).toMatchObject({
      dsp: DspImplementation.WebAssembly,
      dspFallbackReason: undefined,
      dspInUse: true,
    });
    expect(reference?.loaded).toMatchObject({ dsp: DspImplementation.Reference, dspInUse: true });
    expect(wasm?.out.some((channels) => !silent(channels))).toBe(true);
    expect(wasm?.out).toEqual(reference?.out);
  });

  it('says no node uses the DSP of a graph of gains, whatever it runs on', () => {
    const { core, posts } = processor();
    core.receive(
      load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()], {
        dspModuleBytes: dspModuleBytes(),
      }),
    );
    expect(posts[0]).toMatchObject({ dsp: DspImplementation.WebAssembly, dspInUse: false });
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

  it('faults when a message from the main thread or the feeder cannot be received', () => {
    const fromMain = processor();
    fromMain.core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    fromMain.core.messageFailed();
    expect(fromMain.posts.at(-1)).toEqual({
      kind: FromProcessorKind.Fault,
      message:
        'A message from the main thread could not be received by the audio processor, so what it plays is in doubt.',
    });
    const fromFeeder = processor();
    fromFeeder.core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    fromFeeder.core.feedMessageFailed();
    expect(fromFeeder.posts.at(-1)).toEqual({
      kind: FromProcessorKind.Fault,
      message:
        'Audio from the feeder could not be received by the audio processor, so what it plays is in doubt.',
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
    core.receive(start(1));
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
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(signal(0, 512)));
    core.receive(start(1));
    quantum(core, 0);
    expect(() => {
      core.receive({ kind: 'play' });
    }).not.toThrow();
    const fault = posts.at(-1);
    expect(fault?.kind === FromProcessorKind.Fault ? fault.message : '').toContain(
      "message's kind",
    );
    core.receive(start(2));
    expect(silent(quantum(core, 128))).toBe(true);
    // A fault is said once; what follows it is its consequence.
    core.receive({ kind: 'play' });
    core.receiveFeed({ kind: 'feed-block' });
    expect(ofKind(posts, FromProcessorKind.Fault)).toHaveLength(1);
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receiveFeed(rewind(3));
    core.receiveFeed(feedBlock(signal(0, 128)));
    core.receive(start(3));
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
    core.receive(start(1));
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
    early.core.receive(start(1));
    expect(early.posts).toEqual([
      { kind: FromProcessorKind.Fault, message: 'Nothing is loaded to start.' },
    ]);
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receiveFeed(feedBlock(signal(0, 128), 'x'));
    expect(posts.at(-1)).toEqual({
      kind: FromProcessorKind.Fault,
      message: 'No posted feed is bound to x to take its audio.',
    });
  });

  describe('faulting when a feed refuses a block, and playing silence after', () => {
    /** A core playing a posted feed, what it posted, and a check that it is silent from here. */
    function playingFeed(): {
      core: EngineProcessorCore;
      posts: FromProcessor[];
      silentAfter: () => boolean;
    } {
      const { core, posts } = processor();
      core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
      core.receiveFeed(rewind(1));
      core.receiveFeed(feedBlock(signal(0, 256)));
      core.receive(start(1));
      expect(quantum(core, 0)).toEqual(signal(0, 128));
      return {
        core,
        posts,
        silentAfter: () => silent(quantum(core, 128)) && silent(quantum(core, 256)),
      };
    }

    it('refuses a block past the number a posted feed holds', () => {
      const { core, posts, silentAfter } = playingFeed();
      // One block is queued already, so this many more is one past the bound.
      for (let block = 0; block < POSTED_FEED_BLOCKS; block += 1) {
        core.receiveFeed(feedBlock(signal(0, 1)));
      }
      expect(posts.at(-1)).toEqual({
        kind: FromProcessorKind.Fault,
        message: `in: A block arrived when ${String(POSTED_FEED_BLOCKS)} were already queued, more than the feed holds.`,
      });
      expect(silentAfter()).toBe(true);
    });

    it('refuses a block after its feed ended', () => {
      const { core, posts, silentAfter } = playingFeed();
      core.receiveFeed(feedEnd());
      core.receiveFeed(feedBlock(signal(256, 128)));
      expect(posts.at(-1)).toEqual({
        kind: FromProcessorKind.Fault,
        message: 'in: A block arrived after its feed had ended.',
      });
      expect(silentAfter()).toBe(true);
    });

    it('refuses a mono block for a stereo feed', () => {
      const { core, posts, silentAfter } = playingFeed();
      core.receiveFeed(feedBlock(signal(256, 128, 1)));
      expect(posts.at(-1)).toEqual({
        kind: FromProcessorKind.Fault,
        message: 'in: A block of 1 channels arrived for a feed of 2.',
      });
      expect(silentAfter()).toBe(true);
    });
  });

  it('leaves a refused parameter as it was, says why without a fault, and keeps playing', () => {
    const { core, posts } = processor();
    core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    core.receiveFeed(rewind(1));
    core.receiveFeed(feedBlock(signal(0, 256)));
    core.receive(start(1));
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
    wide.core.receiveFeed(rewind(1));
    wide.core.receiveFeed(feedBlock(signal(0, 128, 1)));
    wide.core.receive(start(1));
    const out = quantum(wide.core, 0, 2);
    expect(out[0]).toEqual(signal(0, 128, 1)[0]);
    expect(out[1]?.every((sample) => sample === 0)).toBe(true);

    const narrow = processor();
    narrow.core.receive(load(through(BuiltInNodeType.Gain, { gain: 1 }), [posted()]));
    narrow.core.receiveFeed(rewind(1));
    narrow.core.receiveFeed(feedBlock(signal(0, 128)));
    narrow.core.receive(start(1));
    expect(silent(quantum(narrow.core, 0, 1))).toBe(true);
    expect(narrow.posts.at(-1)?.kind).toBe(FromProcessorKind.Fault);
  });
});
