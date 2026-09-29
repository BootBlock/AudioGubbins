import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  StandardLayouts,
  failure,
  fail,
  sampleCount,
  sampleRate,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  GRAPH_DESCRIPTOR_VERSION,
  NodeRole,
  compileGraph,
  nodeId,
  type ExecutionPlan,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
} from '@audiogubbins/audio-graph';

import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import type {
  InputFeed,
  KernelContext,
  NodeImplementation,
  NodeImplementations,
  NodeKernel,
  SinkTarget,
} from '../nodes/node-implementation.js';
import { DelayLine } from '../pcm/delay-line.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { createExecutor } from './graph-executor.js';

const RATE: SampleRate = expectSuccess(sampleRate(48_000));
const LAYOUT: ChannelLayout = StandardLayouts.stereo;

function id(value: string): NodeId {
  return expectSuccess(nodeId(value));
}

function noParameters(): DomainResult<void> {
  return fail(failure('test.no-parameters', FailureKind.Rejected, 'No parameters.'));
}

/** A node type of this test: a role, a latency, and what its kernel does to a block. */
function nodeType(
  type: string,
  role: NodeRole,
  kernel: (context: KernelContext, node: NodeId, settings: number) => DomainResult<NodeKernel>,
): NodeImplementation {
  const frames = (node: ProcessingNodeDescriptor): number => {
    const value = node.settings['frames'];
    return typeof value === 'number' ? value : 0;
  };
  return {
    type,
    role,
    check: () => [],
    latency: (node) => ({ kind: 'known', frames: expectSuccess(sampleCount(frames(node))) }),
    createKernel: (step, context) => {
      const value = step.settings['frames'];
      return kernel(context, step.node, typeof value === 'number' ? value : 0);
    },
  };
}

function simpleKernel(
  process: NodeKernel['process'],
  setParameter: NodeKernel['setParameter'] = noParameters,
): NodeKernel {
  return { process, setParameter, release: () => undefined };
}

const released: string[] = [];

/** Test node types: a fed input, a scaler, a late copy, a sum and a sink. */
const TYPES: NodeImplementations = new Map(
  [
    nodeType('feed', NodeRole.Source, (context, node) => {
      const feed = context.feedFor(node);
      if (feed === undefined) {
        return fail(failure('test.unfed', FailureKind.Rejected, 'No feed.'));
      }
      return succeed(
        simpleKernel((_inputs, [output]) => {
          if (output !== undefined) feed.fill(output);
        }),
      );
    }),
    nodeType('scale', NodeRole.Processor, () => {
      let factor = 2;
      return succeed(
        simpleKernel(
          ([input], [output], frames) => {
            input?.channels.forEach((channel, index) => {
              const to = output?.channels[index];
              for (let frame = 0; frame < frames; frame += 1) {
                if (to !== undefined) to[frame] = (channel[frame] ?? 0) * factor;
              }
            });
          },
          (name, value) => {
            if (name !== 'factor') return noParameters();
            factor = value;
            return succeed(undefined);
          },
        ),
      );
    }),
    nodeType('late', NodeRole.Processor, (_context, _node, frames) => {
      const line = new DelayLine(LAYOUT.roles.map(() => frames));
      return succeed(
        simpleKernel(([input], [output], count) => {
          if (input !== undefined && output !== undefined) line.process(input, output, count);
        }),
      );
    }),
    nodeType('sum', NodeRole.Processor, () =>
      succeed(
        simpleKernel((inputs, [output], frames) => {
          output?.channels.forEach((to, index) => {
            for (let frame = 0; frame < frames; frame += 1) {
              let total = 0;
              for (const input of inputs) total += input.channels[index]?.[frame] ?? 0;
              to[frame] = total;
            }
          });
        }),
      ),
    ),
    nodeType('take', NodeRole.Sink, (context, node) => {
      const sink = context.sinkFor(node);
      if (sink === undefined) {
        return fail(failure('test.unsunk', FailureKind.Rejected, 'No sink.'));
      }
      return succeed({
        process: ([input]) => {
          if (input !== undefined) sink.receive(input);
        },
        setParameter: noParameters,
        release: () => {
          released.push(node);
        },
      });
    }),
  ].map((one) => [one.type, one] as const),
);

function processing(
  name: string,
  type: string,
  inputs: readonly string[],
  outputs: readonly string[],
  frames = 0,
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id: id(name),
    type,
    inputs: inputs.map((port) => ({ name: port, layout: LAYOUT })),
    outputs: outputs.map((port) => ({ name: port, layout: LAYOUT })),
    settings: frames === 0 ? {} : { frames },
  };
}

function wire(from: string, to: string): GraphDescriptor['edges'][number] {
  const [fromNode = '', fromPort = ''] = from.split('.');
  const [toNode = '', toPort = ''] = to.split('.');
  return { from: { node: id(fromNode), port: fromPort }, to: { node: id(toNode), port: toPort } };
}

/** in → scale → out, and in → late(3) → sum, beside in → sum, → out2. */
const GRAPH: GraphDescriptor = {
  version: GRAPH_DESCRIPTOR_VERSION,
  nodes: [
    processing('in', 'feed', [], ['out']),
    processing('scaled', 'scale', ['in'], ['out']),
    processing('out', 'take', ['in'], []),
    processing('lookahead', 'late', ['in'], ['out'], 3),
    processing('both', 'sum', ['wet', 'dry'], ['out']),
    processing('out2', 'take', ['in'], []),
  ],
  edges: [
    wire('in.out', 'scaled.in'),
    wire('scaled.out', 'out.in'),
    wire('in.out', 'lookahead.in'),
    wire('lookahead.out', 'both.wet'),
    wire('in.out', 'both.dry'),
    wire('both.out', 'out2.in'),
  ],
};

function plan(): ExecutionPlan {
  const compiled = compileGraph(GRAPH, TYPES, RATE);
  if (!compiled.ok) throw new Error(compiled.diagnostics[0].message);
  return compiled.plan;
}

/** A feed of `frames` numbered frames, channel `c` frame `i` being `(c + 1) · 1000 + i`. */
function numberedFeed(frames: number): InputFeed {
  let position = 0;
  return {
    layout: LAYOUT,
    fill: (into) => {
      const count = Math.min(into.frames, frames - position);
      into.channels.forEach((channel, index) => {
        for (let frame = 0; frame < into.frames; frame += 1) {
          channel[frame] = frame < count ? (index + 1) * 1_000 + position + frame : 0;
        }
      });
      position += count;
      return count;
    },
  };
}

/** A sink that appends every block it receives. */
function collector(): SinkTarget & { readonly channels: number[][] } {
  const channels: number[][] = LAYOUT.roles.map(() => []);
  return {
    channels,
    receive: (block: AudioFrameBlock) => {
      block.channels.forEach((channel, index) => {
        channels[index]?.push(...channel.subarray(0, block.frames));
      });
    },
  };
}

function context(
  blockFrames: number,
  feeds: ReadonlyMap<NodeId, InputFeed>,
  sinks: ReadonlyMap<NodeId, SinkTarget>,
): KernelContext {
  return {
    sampleRate: RATE,
    blockFrames,
    dsp: REFERENCE_DSP,
    feedFor: (node) => feeds.get(node),
    sinkFor: (node) => sinks.get(node),
    meterFor: () => undefined,
  };
}

/** A context with the input fed `feedFrames` frames and both sinks bound, `out` to the first. */
function bound(
  blockFrames: number,
  feedFrames: number,
  out: SinkTarget = collector(),
): KernelContext {
  return context(
    blockFrames,
    new Map([[id('in'), numberedFeed(feedFrames)]]),
    new Map([
      [id('out'), out],
      [id('out2'), collector()],
    ]),
  );
}

/** Runs the graph over `total` frames in blocks of the given sizes, and what each sink received. */
function run(total: number, sizes: readonly number[], largest: number): number[][][] {
  const [out, out2] = [collector(), collector()];
  const executor = expectSuccess(
    createExecutor(
      plan(),
      TYPES,
      context(
        largest,
        new Map([[id('in'), numberedFeed(total)]]),
        new Map([
          [id('out'), out],
          [id('out2'), out2],
        ]),
      ),
    ),
  );
  for (let done = 0, index = 0; done < total; index += 1) {
    const frames = Math.min(sizes[index % sizes.length] ?? 1, total - done);
    executor.process(frames);
    done += frames;
  }
  executor.release();
  return [out.channels, out2.channels];
}

describe('the executor', () => {
  it('runs every step in order and delivers each sink its audio', () => {
    const [scaled] = run(6, [6], 6);
    expect(scaled).toEqual([
      [2_000, 2_002, 2_004, 2_006, 2_008, 2_010],
      [4_000, 4_002, 4_004, 4_006, 4_008, 4_010],
    ]);
  });

  it('delays the early input of a merge to meet the late one', () => {
    const [, both] = run(8, [8], 8);
    // Without the compensation the dry input would be three frames early, and
    // the first sum 1000 rather than 0.
    expect(both?.[0]).toEqual([0, 0, 0, 2_000, 2_002, 2_004, 2_006, 2_008]);
    expect(both?.[1]).toEqual([0, 0, 0, 4_000, 4_002, 4_004, 4_006, 4_008]);
  });

  it('gives the same bits whatever the blocks the stream is cut into', () => {
    const whole = run(700, [700], 700);
    expect(run(700, [1], 128)).toEqual(whole);
    expect(run(700, [128], 128)).toEqual(whole);
    expect(run(700, [7, 128, 3, 64], 128)).toEqual(whole);
  });

  it('changes a running parameter of the node named, and refuses one it lacks', () => {
    const out = collector();
    const executor = expectSuccess(createExecutor(plan(), TYPES, bound(2, 4, out)));
    executor.process(2);
    expectSuccess(executor.setParameter(id('scaled'), 'factor', 3));
    executor.process(2);
    expect(out.channels[0]).toEqual([2_000, 2_002, 3_006, 3_009]);
    expect(expectFailureCode(executor.setParameter(id('scaled'), 'width', 1))).toBe(
      'test.no-parameters',
    );
    expect(expectFailureCode(executor.setParameter(id('nowhere'), 'factor', 1))).toBe(
      'execution.node-unknown',
    );
  });

  it('refuses a plan it cannot run, releasing every kernel it made first', () => {
    released.length = 0;
    const unsunk = createExecutor(
      plan(),
      TYPES,
      context(4, new Map([[id('in'), numberedFeed(4)]]), new Map([[id('out'), collector()]])),
    );
    expect(expectFailureCode(unsunk)).toBe('test.unsunk');
    expect(released).toEqual(['out']);

    const unknown = new Map([...TYPES].filter(([type]) => type !== 'sum'));
    expect(expectFailureCode(createExecutor(plan(), unknown, bound(4, 4)))).toBe(
      'execution.node-type-unknown',
    );

    const other = expectSuccess(sampleRate(44_100));
    expect(
      expectFailureCode(
        createExecutor(plan(), TYPES, { ...context(4, new Map(), new Map()), sampleRate: other }),
      ),
    ).toBe('execution.rate-mismatch');
    expect(expectFailureCode(createExecutor(plan(), TYPES, context(0, new Map(), new Map())))).toBe(
      'execution.block-frames-invalid',
    );
  });

  it('refuses a block larger than it was sized for', () => {
    const executor = expectSuccess(createExecutor(plan(), TYPES, bound(4, 8)));
    expect(() => {
      executor.process(5);
    }).toThrow('4-frame blocks');
  });
});
