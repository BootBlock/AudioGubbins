import { expectSuccess } from '@audiogubbins/domain/testing';
import { sampleRate } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import type { GraphDescriptor } from './descriptor.js';
import { analyseLatency, type LatencyAnalysis } from './latency.js';
import {
  CATALOGUE,
  MONO,
  RATE,
  STEREO,
  delay,
  edge,
  graph,
  mix,
  node,
  port,
  sink,
  source,
  subgraph,
} from './testing/test-graphs.js';
import { validateGraph } from './validation.js';

function analysed(described: GraphDescriptor, rate = RATE): LatencyAnalysis {
  const validation = validateGraph(described, CATALOGUE);
  if (!validation.ok) throw new Error(JSON.stringify(validation.diagnostics));
  const result = analyseLatency(validation.graph, rate);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.analysis;
}

function refused(described: GraphDescriptor): readonly { code: string; message: string }[] {
  const validation = validateGraph(described, CATALOGUE);
  if (!validation.ok) throw new Error(JSON.stringify(validation.diagnostics));
  const result = analyseLatency(validation.graph, RATE);
  if (result.ok) throw new Error('Expected the latency analysis to refuse the graph.');
  return result.diagnostics;
}

/** The delay applied to one input of one node. */
function compensation(analysis: LatencyAnalysis, at: string, input: number): number | undefined {
  return analysis.nodes.find((one) => one.node === at)?.compensation[input];
}

/** A source, split into two paths of the given latencies, mixed, then a sink. */
function parallel(first: number, second: number): GraphDescriptor {
  return graph(
    [source('in'), delay('a', first), delay('b', second), mix('mix', 2), sink('out')],
    [
      edge('in.out', 'a.in'),
      edge('in.out', 'b.in'),
      edge('a.out', 'mix.in-1'),
      edge('b.out', 'mix.in-2'),
      edge('mix.out', 'out.in'),
    ],
  );
}

describe('latency along a serial path', () => {
  it('sums the latency of every node on the path', () => {
    const analysis = analysed(
      graph(
        [source('in'), delay('a', 64), delay('b', 128), delay('c', 3), sink('out')],
        [
          edge('in.out', 'a.in'),
          edge('a.out', 'b.in'),
          edge('b.out', 'c.in'),
          edge('c.out', 'out.in'),
        ],
      ),
    );
    expect(analysis.overall).toEqual({ kind: 'known', frames: 195 });
    expect(analysis.endpoints).toEqual([
      { node: 'out', role: 'sink', latency: { kind: 'known', frames: 195 } },
    ]);
    // A serial path has nothing to align with, so nothing is delayed.
    expect(analysis.nodes.flatMap((one) => one.compensation)).toEqual([0, 0, 0, 0]);
  });

  it('asks each contract for its latency at the graph’s sample rate', () => {
    const described = graph(
      [
        source('in'),
        node('up', 'oversampler', { inputs: [port('in')], outputs: [port('out')] }),
        sink('out'),
      ],
      [edge('in.out', 'up.in'), edge('up.out', 'out.in')],
    );
    expect(analysed(described).overall).toEqual({ kind: 'known', frames: 48 });
    expect(analysed(described, expectSuccess(sampleRate(96_000))).overall).toEqual({
      kind: 'known',
      frames: 96,
    });
  });

  it('reports an unknown latency on a serial path as unknown at the sink, with its reason', () => {
    const analysis = analysed(
      graph(
        [
          source('in'),
          delay('a', 10),
          node('plugin', 'plugin-host', { inputs: [port('in')], outputs: [port('out')] }),
          delay('b', 5),
          sink('out'),
        ],
        [
          edge('in.out', 'a.in'),
          edge('a.out', 'plugin.in'),
          edge('plugin.out', 'b.in'),
          edge('b.out', 'out.in'),
        ],
      ),
    );
    expect(analysis.overall).toEqual({
      kind: 'unknown',
      knownFrames: 15,
      causes: [{ node: 'plugin', reason: 'the plug-in reports no latency' }],
    });
  });
});

describe('automatic delay compensation', () => {
  it('delays the earlier of two parallel branches to meet the later', () => {
    const analysis = analysed(parallel(100, 30));
    expect(compensation(analysis, 'mix', 0)).toBe(0);
    expect(compensation(analysis, 'mix', 1)).toBe(70);
    expect(analysis.overall).toEqual({ kind: 'known', frames: 100 });
  });

  it('compensates whichever branch is earlier, whatever order the inputs are in', () => {
    const analysis = analysed(parallel(30, 100));
    expect(compensation(analysis, 'mix', 0)).toBe(70);
    expect(compensation(analysis, 'mix', 1)).toBe(0);
  });

  it('delays the dry path of a wet/dry blend by the latency of the wet processor', () => {
    const analysis = analysed(
      graph(
        [source('in'), delay('reverb', 512), mix('blend', 2), sink('out')],
        [
          edge('in.out', 'reverb.in'),
          edge('reverb.out', 'blend.in-1'),
          edge('in.out', 'blend.in-2'),
          edge('blend.out', 'out.in'),
        ],
      ),
    );
    expect(compensation(analysis, 'blend', 0)).toBe(0);
    expect(compensation(analysis, 'blend', 1)).toBe(512);
    expect(analysis.overall).toEqual({ kind: 'known', frames: 512 });
  });

  it('aligns the main input of a compressor with a side chain that passes through a filter', () => {
    const analysis = analysed(
      graph(
        [
          source('vocal'),
          source('music'),
          delay('filter', 48),
          node('duck', 'compressor', {
            inputs: [port('main'), port('sidechain')],
            outputs: [port('out')],
            settings: { frames: 0 },
          }),
          sink('out'),
        ],
        [
          edge('music.out', 'duck.main'),
          edge('vocal.out', 'filter.in'),
          edge('filter.out', 'duck.sidechain'),
          edge('duck.out', 'out.in'),
        ],
      ),
    );
    expect(compensation(analysis, 'duck', 0)).toBe(48);
    expect(compensation(analysis, 'duck', 1)).toBe(0);
  });

  it('carries the latency of a nested subgraph out through its boundary', () => {
    const inner = graph([delay('first', 7), delay('second', 11)], [edge('first.out', 'second.in')]);
    const middle = graph(
      [
        subgraph('core', inner, {
          inputs: [{ name: 'in', layout: STEREO, to: [{ node: inner.nodes[0]!.id, port: 'in' }] }],
          outputs: [
            { name: 'out', layout: STEREO, from: { node: inner.nodes[1]!.id, port: 'out' } },
          ],
        }),
        delay('tail', 2),
      ],
      [edge('core.out', 'tail.in')],
    );
    const analysis = analysed(
      graph(
        [
          source('in'),
          subgraph('fx', middle, {
            inputs: [
              { name: 'in', layout: STEREO, to: [{ node: middle.nodes[0]!.id, port: 'in' }] },
            ],
            outputs: [
              { name: 'out', layout: STEREO, from: { node: middle.nodes[1]!.id, port: 'out' } },
            ],
          }),
          mix('blend', 2),
          sink('out'),
        ],
        [
          edge('in.out', 'fx.in'),
          edge('fx.out', 'blend.in-1'),
          edge('in.out', 'blend.in-2'),
          edge('blend.out', 'out.in'),
        ],
      ),
    );
    expect(analysis.nodes.map((one) => one.node)).toContain('fx/core/second');
    expect(compensation(analysis, 'blend', 1)).toBe(20);
    expect(analysis.overall).toEqual({ kind: 'known', frames: 20 });
  });

  it('measures an analysis node on a branch without delaying the main path for it', () => {
    const analysis = analysed(
      graph(
        [
          source('in'),
          delay('look', 32),
          node('meter', 'meter', { inputs: [port('in')] }),
          sink('out'),
        ],
        [edge('in.out', 'look.in'), edge('look.out', 'meter.in'), edge('in.out', 'out.in')],
      ),
    );
    expect(analysis.endpoints).toEqual([
      { node: 'meter', role: 'analysis', latency: { kind: 'known', frames: 32 } },
      { node: 'out', role: 'sink', latency: { kind: 'known', frames: 0 } },
    ]);
    expect(analysis.overall).toEqual({ kind: 'known', frames: 0 });
  });

  it('takes the latest sink as the graph’s latency', () => {
    const analysis = analysed(
      graph(
        [source('in'), delay('slow', 90), sink('main'), sink('monitor')],
        [edge('in.out', 'slow.in'), edge('slow.out', 'main.in'), edge('in.out', 'monitor.in')],
      ),
    );
    expect(analysis.overall).toEqual({ kind: 'known', frames: 90 });
  });
});

describe('unknown latency where paths meet', () => {
  it('refuses a merge of a path of unknown latency with one that does not pass through it', () => {
    const [problem] = refused(
      graph(
        [
          source('in'),
          node('plugin', 'plugin-host', { inputs: [port('in')], outputs: [port('out')] }),
          mix('blend', 2),
          sink('out'),
        ],
        [
          edge('in.out', 'plugin.in'),
          edge('plugin.out', 'blend.in-1'),
          edge('in.out', 'blend.in-2'),
          edge('blend.out', 'out.in'),
        ],
      ),
    );
    expect(problem?.code).toBe('unknown-latency-at-merge');
    expect(problem?.message).toContain('plugin (the plug-in reports no latency)');
    expect(problem?.message).toContain('Give that processor a known latency');
  });

  it('aligns paths that share the same unknown latency upstream by their known parts', () => {
    const analysis = analysed(
      graph(
        [
          source('in'),
          node('plugin', 'plugin-host', { inputs: [port('in')], outputs: [port('out')] }),
          delay('wet', 40),
          mix('blend', 2),
          sink('out'),
        ],
        [
          edge('in.out', 'plugin.in'),
          edge('plugin.out', 'wet.in'),
          edge('wet.out', 'blend.in-1'),
          edge('plugin.out', 'blend.in-2'),
          edge('blend.out', 'out.in'),
        ],
      ),
    );
    expect(compensation(analysis, 'blend', 1)).toBe(40);
    expect(analysis.overall).toMatchObject({ kind: 'unknown', knownFrames: 40 });
  });

  it('reports every sink of unknown latency in the graph’s latency', () => {
    const analysis = analysed(
      graph(
        [
          source('in', MONO),
          node('plugin', 'plugin-host', {
            inputs: [port('in', MONO)],
            outputs: [port('out', MONO)],
          }),
          sink('a', MONO),
          sink('b', MONO),
        ],
        [edge('in.out', 'plugin.in'), edge('plugin.out', 'a.in'), edge('in.out', 'b.in')],
      ),
    );
    expect(analysis.overall).toEqual({
      kind: 'unknown',
      knownFrames: 0,
      causes: [{ node: 'plugin', reason: 'the plug-in reports no latency' }],
    });
  });
});

describe('latency beyond what can be counted', () => {
  it('refuses a sum that leaves the exact range rather than rounding it', () => {
    const [problem] = refused(
      graph(
        [source('in'), delay('huge', Number.MAX_SAFE_INTEGER), delay('more', 1), sink('out')],
        [edge('in.out', 'huge.in'), edge('huge.out', 'more.in'), edge('more.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'latency-out-of-range', node: 'more' });
    expect(problem?.message).toContain('Check the latency its processors report');
  });
});
