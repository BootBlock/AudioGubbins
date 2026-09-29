import { describe, expect, it } from 'vitest';

import type { GraphDescriptor, NodeDescriptor } from './descriptor.js';
import type { GraphDiagnostic } from './diagnostic.js';
import { flattenGraph, type FlatGraph } from './flattening.js';
import {
  MONO,
  STEREO,
  delay,
  edge,
  graph,
  mix,
  ref,
  sink,
  source,
  subgraph,
} from './testing/test-graphs.js';

function flat(described: GraphDescriptor): FlatGraph {
  const flattening = flattenGraph(described);
  if (!flattening.ok) throw new Error(JSON.stringify(flattening.diagnostics));
  return flattening.graph;
}

function problems(described: GraphDescriptor): readonly GraphDiagnostic[] {
  const flattening = flattenGraph(described);
  if (flattening.ok) throw new Error('Expected the graph to be refused.');
  return flattening.diagnostics;
}

function edgesOf(described: FlatGraph): readonly string[] {
  return described.edges.map(
    (one) => `${one.from.node}.${one.from.port} -> ${one.to.node}.${one.to.port}`,
  );
}

/** A parallel pair of delays, both fed by the boundary input and mixed to the output. */
const PAIR = graph(
  [delay('left', 3), delay('right', 5), mix('sum', 2)],
  [edge('left.out', 'sum.in-1'), edge('right.out', 'sum.in-2')],
);

function pair(identifier: string): NodeDescriptor {
  return subgraph(identifier, PAIR, {
    inputs: [{ name: 'in', layout: STEREO, to: [ref('left.in'), ref('right.in')] }],
    outputs: [{ name: 'out', layout: STEREO, from: ref('sum.out') }],
  });
}

describe('flattening a graph', () => {
  it('leaves a graph without subgraphs as it was', () => {
    const described = graph([source('in'), sink('out')], [edge('in.out', 'out.in')]);
    expect(flat(described)).toEqual(described);
  });

  it('prefixes inner nodes with the subgraph’s identifier and rewires its boundary', () => {
    const flattened = flat(
      graph(
        [source('in'), pair('fx'), sink('out')],
        [edge('in.out', 'fx.in'), edge('fx.out', 'out.in')],
      ),
    );
    expect(flattened.nodes.map((one) => one.id)).toEqual([
      'in',
      'fx/left',
      'fx/right',
      'fx/sum',
      'out',
    ]);
    expect(edgesOf(flattened)).toEqual([
      'fx/left.out -> fx/sum.in-1',
      'fx/right.out -> fx/sum.in-2',
      'in.out -> fx/left.in',
      'in.out -> fx/right.in',
      'fx/sum.out -> out.in',
    ]);
  });

  it('gives two placements of one subgraph nodes of their own', () => {
    const flattened = flat(
      graph(
        [source('in'), pair('one'), pair('two'), sink('out')],
        [edge('in.out', 'one.in'), edge('one.out', 'two.in'), edge('two.out', 'out.in')],
      ),
    );
    expect(flattened.nodes.map((one) => one.id)).toContain('one/sum');
    expect(flattened.nodes.map((one) => one.id)).toContain('two/sum');
    expect(edgesOf(flattened)).toContain('one/sum.out -> two/left.in');
  });

  it('expands a subgraph nested in a subgraph, however deep', () => {
    const middle = graph([pair('inner')], []);
    const flattened = flat(
      graph(
        [
          source('in'),
          subgraph('outer', middle, {
            inputs: [{ name: 'in', layout: STEREO, to: [ref('inner.in')] }],
            outputs: [{ name: 'out', layout: STEREO, from: ref('inner.out') }],
          }),
          sink('out'),
        ],
        [edge('in.out', 'outer.in'), edge('outer.out', 'out.in')],
      ),
    );
    expect(new Set(flattened.nodes.map((one) => one.kind))).toEqual(new Set(['processing']));
    expect(edgesOf(flattened)).toEqual([
      'outer/inner/left.out -> outer/inner/sum.in-1',
      'outer/inner/right.out -> outer/inner/sum.in-2',
      'in.out -> outer/inner/left.in',
      'in.out -> outer/inner/right.in',
      'outer/inner/sum.out -> out.in',
    ]);
  });
});

describe('the boundary of a subgraph', () => {
  function withBoundary(boundary: Parameters<typeof subgraph>[2]): GraphDescriptor {
    return graph(
      [source('in'), subgraph('fx', PAIR, boundary), sink('out')],
      [edge('in.out', 'fx.in'), edge('fx.out', 'out.in')],
    );
  }

  it('refuses a boundary port that names no inner port', () => {
    const found = problems(
      withBoundary({
        inputs: [{ name: 'in', layout: STEREO, to: [ref('left.in'), ref('left.missing')] }],
        outputs: [{ name: 'out', layout: STEREO, from: ref('sum.in-1') }],
      }),
    );
    expect(found.map((one) => [one.code, one.node, one.port])).toEqual([
      ['subgraph-boundary-invalid', 'fx', 'in'],
      ['subgraph-boundary-invalid', 'fx', 'out'],
    ]);
    expect(found[0]?.message).toContain(
      'fx/left.missing, which is not an input port inside the subgraph',
    );
    expect(found[1]?.message).toContain('Name an inner output port that exists');
  });

  it('refuses a boundary port whose layout differs from the inner port behind it', () => {
    const [problem] = problems(
      withBoundary({
        inputs: [{ name: 'in', layout: MONO, to: [ref('left.in')] }],
        outputs: [{ name: 'out', layout: STEREO, from: ref('sum.out') }],
      }),
    );
    expect(problem).toMatchObject({ code: 'subgraph-boundary-invalid', node: 'fx', port: 'in' });
    expect(problem?.message).toContain(
      'declares 1 channel (mono), but fx/left.in carries 2 channels',
    );
    expect(problem?.message).toContain('insert a channel-map or matrix node inside the subgraph');
  });

  it('refuses a boundary input that feeds nothing, or a boundary name used twice', () => {
    const found = problems(
      withBoundary({
        inputs: [
          { name: 'in', layout: STEREO, to: [] },
          { name: 'in', layout: STEREO, to: [ref('left.in')] },
        ],
        outputs: [{ name: 'out', layout: STEREO, from: ref('sum.out') }],
      }),
    );
    expect(found.map((one) => one.message)).toEqual([
      expect.stringContaining('declares the boundary port "in" twice'),
      expect.stringContaining('feeds nothing inside the subgraph'),
    ]);
  });

  it('refuses an edge to a boundary port the subgraph does not declare', () => {
    const [problem] = problems(
      graph(
        [source('in'), pair('fx'), sink('out')],
        [edge('in.out', 'fx.side'), edge('fx.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'edge-port-missing', node: 'fx', port: 'side' });
    expect(problem?.message).toContain('has no boundary input named "side"');
  });

  it('refuses a subgraph that contains itself', () => {
    const nodes: NodeDescriptor[] = [];
    const looped = graph(nodes, []);
    nodes.push(subgraph('again', looped, { inputs: [], outputs: [] }));
    const [problem] = problems(graph([subgraph('top', looped, { inputs: [], outputs: [] })], []));
    expect(problem).toMatchObject({ code: 'subgraph-recursive', node: 'top/again' });
    expect(problem?.message).toContain('Place a copy of it instead');
  });
});
