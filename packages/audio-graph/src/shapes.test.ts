import { describe, expect, it } from 'vitest';

import { compileGraph } from './compilation.js';
import type { GraphDescriptor } from './descriptor.js';
import type { ExecutionPlan } from './plan.js';
import {
  CATALOGUE,
  MID,
  RATE,
  SIDE,
  STEREO,
  delay,
  edge,
  graph,
  mix,
  node,
  port,
  ref,
  sink,
  source,
  subgraph,
} from './testing/test-graphs.js';

/**
 * REQ-ARCH-140 lists what the graph must be able to represent. Each shape here
 * is built from the generic descriptor and the test contracts alone, and is
 * validated, analysed and planned, so none of them needs a graph of its own.
 */

function compiled(described: GraphDescriptor): ExecutionPlan {
  const result = compileGraph(described, CATALOGUE, RATE);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

function order(planned: ExecutionPlan): readonly string[] {
  return planned.steps.map((step) => step.node);
}

function processor(identifier: string, type: string, frames = 0): ReturnType<typeof node> {
  return node(identifier, type, {
    inputs: [port('in')],
    outputs: [port('out')],
    settings: { frames },
  });
}

describe('the processing shapes the graph represents (REQ-ARCH-140)', () => {
  it('a serial chain', () => {
    const planned = compiled(
      graph(
        [source('in'), delay('eq', 0), delay('limiter', 64), sink('out')],
        [edge('in.out', 'eq.in'), edge('eq.out', 'limiter.in'), edge('limiter.out', 'out.in')],
      ),
    );
    expect(order(planned)).toEqual(['in', 'eq', 'limiter', 'out']);
    expect(planned.latency).toEqual({ kind: 'known', frames: 64 });
  });

  it('parallel branches split from one output and mixed back together', () => {
    const planned = compiled(
      graph(
        [
          source('in'),
          delay('low', 10),
          delay('high', 30),
          delay('mid', 20),
          mix('sum', 3),
          sink('out'),
        ],
        [
          edge('in.out', 'low.in'),
          edge('in.out', 'high.in'),
          edge('in.out', 'mid.in'),
          edge('low.out', 'sum.in-1'),
          edge('high.out', 'sum.in-2'),
          edge('mid.out', 'sum.in-3'),
          edge('sum.out', 'out.in'),
        ],
      ),
    );
    expect(
      planned.steps.find((step) => step.node === 'sum')?.inputs.map((input) => input.delay),
    ).toEqual([20, 0, 10]);
  });

  it('a wet/dry blend', () => {
    const planned = compiled(
      graph(
        [source('in'), processor('reverb', 'delay', 256), mix('blend', 2), sink('out')],
        [
          edge('in.out', 'reverb.in'),
          edge('reverb.out', 'blend.in-1'),
          edge('in.out', 'blend.in-2'),
          edge('blend.out', 'out.in'),
        ],
      ),
    );
    expect(
      planned.steps.find((step) => step.node === 'blend')?.inputs.map((input) => input.delay),
    ).toEqual([0, 256]);
  });

  it('a side-chain input on a second named port', () => {
    const planned = compiled(
      graph(
        [
          source('music'),
          source('voice'),
          node('duck', 'compressor', {
            inputs: [port('main'), port('sidechain')],
            outputs: [port('out')],
          }),
          sink('out'),
        ],
        [
          edge('music.out', 'duck.main'),
          edge('voice.out', 'duck.sidechain'),
          edge('duck.out', 'out.in'),
        ],
      ),
    );
    expect(
      planned.steps.find((step) => step.node === 'duck')?.inputs.map((input) => input.port),
    ).toEqual(['main', 'sidechain']);
  });

  it('mid/side branches, encoded and decoded by matrix nodes', () => {
    const planned = compiled(
      graph(
        [
          source('in'),
          node('encode', 'matrix', {
            inputs: [port('in')],
            outputs: [port('mid', MID), port('side', SIDE)],
          }),
          node('mid-eq', 'delay', {
            inputs: [port('in', MID)],
            outputs: [port('out', MID)],
            settings: { frames: 8 },
          }),
          node('decode', 'matrix', {
            inputs: [port('mid', MID), port('side', SIDE)],
            outputs: [port('out')],
          }),
          sink('out'),
        ],
        [
          edge('in.out', 'encode.in'),
          edge('encode.mid', 'mid-eq.in'),
          edge('mid-eq.out', 'decode.mid'),
          edge('encode.side', 'decode.side'),
          edge('decode.out', 'out.in'),
        ],
      ),
    );
    expect(
      planned.steps.find((step) => step.node === 'decode')?.inputs.map((input) => input.delay),
    ).toEqual([0, 8]);
  });

  it('an analysis-only node that observes a path without feeding anything', () => {
    const planned = compiled(
      graph(
        [source('in'), node('meter', 'meter', { inputs: [port('in')] }), sink('out')],
        [edge('in.out', 'meter.in'), edge('in.out', 'out.in')],
      ),
    );
    expect(planned.steps.find((step) => step.node === 'meter')?.outputs).toEqual([]);
    expect(planned.sinks.map((one) => one.node)).toEqual(['out']);
  });

  it('a render or cache node in the middle of a path', () => {
    const planned = compiled(
      graph(
        [source('in'), processor('frozen', 'cache'), sink('out')],
        [edge('in.out', 'frozen.in'), edge('frozen.out', 'out.in')],
      ),
    );
    expect(order(planned)).toEqual(['in', 'frozen', 'out']);
  });

  it('sends from two tracks to a bus, returned into the main mix', () => {
    const planned = compiled(
      graph(
        [
          source('track-1'),
          source('track-2'),
          processor('send-1', 'gain'),
          processor('send-2', 'gain'),
          mix('bus', 2),
          processor('bus-reverb', 'delay', 100),
          mix('main', 3),
          sink('out'),
        ],
        [
          edge('track-1.out', 'send-1.in'),
          edge('track-2.out', 'send-2.in'),
          edge('send-1.out', 'bus.in-1'),
          edge('send-2.out', 'bus.in-2'),
          edge('bus.out', 'bus-reverb.in'),
          edge('track-1.out', 'main.in-1'),
          edge('track-2.out', 'main.in-2'),
          edge('bus-reverb.out', 'main.in-3'),
          edge('main.out', 'out.in'),
        ],
      ),
    );
    expect(
      planned.steps.find((step) => step.node === 'main')?.inputs.map((input) => input.delay),
    ).toEqual([100, 100, 0]);
  });

  it('a reusable subgraph placed as one node', () => {
    const chorus = graph(
      [delay('a', 5), delay('b', 9), mix('sum', 2)],
      [edge('a.out', 'sum.in-1'), edge('b.out', 'sum.in-2')],
    );
    const planned = compiled(
      graph(
        [
          source('in'),
          subgraph('chorus', chorus, {
            inputs: [{ name: 'in', layout: STEREO, to: [ref('a.in'), ref('b.in')] }],
            outputs: [{ name: 'out', layout: STEREO, from: ref('sum.out') }],
          }),
          sink('out'),
        ],
        [edge('in.out', 'chorus.in'), edge('chorus.out', 'out.in')],
      ),
    );
    expect(order(planned)).toEqual(['in', 'chorus/a', 'chorus/b', 'chorus/sum', 'out']);
    expect(planned.latency).toEqual({ kind: 'known', frames: 9 });
  });

  it('a plug-in host node whose latency is unknown, on a serial path', () => {
    const planned = compiled(
      graph(
        [source('in'), processor('host', 'plugin-host'), sink('out')],
        [edge('in.out', 'host.in'), edge('host.out', 'out.in')],
      ),
    );
    expect(planned.latency).toMatchObject({ kind: 'unknown', causes: [{ node: 'host' }] });
  });
});
