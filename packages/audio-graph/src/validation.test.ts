import { describe, expect, it } from 'vitest';

import type { GraphDescriptor } from './descriptor.js';
import type { GraphDiagnostic } from './diagnostic.js';
import {
  CATALOGUE,
  MONO,
  STEREO,
  SURROUND,
  delay,
  edge,
  graph,
  mix,
  node,
  port,
  sink,
  source,
} from './testing/test-graphs.js';
import { validateGraph, type ValidatedGraph } from './validation.js';

function valid(described: GraphDescriptor): ValidatedGraph {
  const validation = validateGraph(described, CATALOGUE);
  if (!validation.ok) throw new Error(JSON.stringify(validation.diagnostics));
  return validation.graph;
}

function problems(described: GraphDescriptor): readonly GraphDiagnostic[] {
  const validation = validateGraph(described, CATALOGUE);
  if (validation.ok) throw new Error('Expected the graph to be refused.');
  return validation.diagnostics;
}

/** The one problem a graph has, which the test is about. */
function onlyProblem(described: GraphDescriptor): GraphDiagnostic {
  const found = problems(described);
  expect(found.map((one) => one.code)).toHaveLength(1);
  return found[0]!;
}

const SERIAL = graph(
  [source('in'), delay('a', 1), sink('out')],
  [edge('in.out', 'a.in'), edge('a.out', 'out.in')],
);

describe('a graph that can run', () => {
  it('orders each node after every node feeding it', () => {
    const order = valid(
      graph(
        [sink('out'), delay('b', 0), delay('a', 0), source('in')],
        [edge('a.out', 'b.in'), edge('in.out', 'a.in'), edge('b.out', 'out.in')],
      ),
    ).nodes.map((one) => one.descriptor.id);
    expect(order).toEqual(['in', 'a', 'b', 'out']);
  });

  it('breaks a tie between nodes ready at once by declaration order', () => {
    const order = valid(
      graph(
        [source('z'), source('y'), mix('m', 2), sink('out')],
        [edge('y.out', 'm.in-2'), edge('z.out', 'm.in-1'), edge('m.out', 'out.in')],
      ),
    ).nodes.map((one) => one.descriptor.id);
    expect(order).toEqual(['z', 'y', 'm', 'out']);
  });

  it('lets an output fan out to several inputs, or feed none', () => {
    valid(
      graph(
        [node('in', 'source', { outputs: [port('out'), port('spare')] }), sink('a'), sink('b')],
        [edge('in.out', 'a.in'), edge('in.out', 'b.in')],
      ),
    );
  });

  it('keeps the source feeding each input, in port order', () => {
    const [, blend] = valid(
      graph(
        [source('in'), mix('blend', 2), sink('out')],
        [edge('in.out', 'blend.in-2'), edge('in.out', 'blend.in-1'), edge('blend.out', 'out.in')],
      ),
    ).nodes;
    expect(blend?.sources).toEqual([
      { node: 'in', port: 'out' },
      { node: 'in', port: 'out' },
    ]);
  });
});

describe('the diagnostics of a graph that cannot run', () => {
  it('refuses two nodes of one identifier', () => {
    const problem = onlyProblem(
      graph(
        [source('in'), delay('a', 0), delay('a', 0), sink('out')],
        [edge('in.out', 'a.in'), edge('a.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'node-id-duplicate', node: 'a' });
    expect(problem.message).toContain('Give each node in the graph its own identifier');
  });

  it('refuses a type no contract provides, and says nothing of a sink it might have been', () => {
    const problem = onlyProblem(
      graph(
        [source('in'), node('out', 'speaker', { inputs: [port('in')] })],
        [edge('in.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'node-type-unknown', node: 'out' });
    expect(problem.message).toContain('Choose an available type');
  });

  it('reports what a contract finds wrong with a node’s settings, on that node', () => {
    const problem = onlyProblem(
      graph(
        [
          source('in'),
          node('t', 'trim', {
            inputs: [port('in')],
            outputs: [port('out')],
            settings: { gain: 'loud' },
          }),
          sink('out'),
        ],
        [edge('in.out', 't.in'), edge('t.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'node-settings-invalid', node: 't' });
    expect(problem.message).toContain('Set one');
  });

  it('reports a layout a contract does not support', () => {
    const problem = onlyProblem(
      graph(
        [
          source('in'),
          node('m', 'mono-only', { inputs: [port('in')], outputs: [port('out', MONO)] }),
          sink('out', MONO),
        ],
        [edge('in.out', 'm.in'), edge('m.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'layout-unsupported', node: 'm', port: 'in' });
    expect(problem.message).toContain('insert a channel-map node');
  });

  it('refuses two ports of one name on one side', () => {
    const problem = onlyProblem(
      graph(
        [
          source('in'),
          node('m', 'mix', { inputs: [port('in'), port('in')], outputs: [port('out')] }),
          sink('out'),
        ],
        [edge('in.out', 'm.in'), edge('m.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'port-name-duplicate', node: 'm', port: 'in' });
    expect(problem.message).toContain('its own name');
  });

  it('refuses ports a node’s role cannot have', () => {
    const found = problems(
      graph(
        [
          node('in', 'source', { inputs: [port('in')], outputs: [port('out')] }),
          node('out', 'sink', { inputs: [port('in')], outputs: [port('out')] }),
          node('p', 'gain', { inputs: [port('in')] }),
        ],
        [edge('in.out', 'out.in'), edge('out.out', 'in.in'), edge('in.out', 'p.in')],
      ),
    );
    const roles = found.filter((one) => one.code === 'role-ports-invalid');
    expect(roles.map((one) => one.node)).toEqual(['in', 'out', 'p']);
    expect(roles[0]?.message).toContain('is a source of type "source", which cannot have input');
    expect(roles[2]?.message).toContain('needs at least one output');
  });

  it('refuses an edge to a node that is not in the graph', () => {
    const found = problems(
      graph([source('in'), sink('out')], [edge('in.out', 'ghost.in'), edge('in.out', 'out.in')]),
    );
    expect(found).toEqual([expect.objectContaining({ code: 'edge-node-missing', node: 'ghost' })]);
    expect(found[0]?.message).toContain('Add the node, or remove the edge');
  });

  it('refuses an edge to a port the node does not have, and says when it runs the wrong way', () => {
    const found = problems(
      graph(
        [source('in'), delay('a', 0), sink('out')],
        [edge('in.out', 'a.in'), edge('a.in', 'out.in'), edge('a.out', 'out.nothing')],
      ),
    );
    expect(found.map((one) => [one.code, one.node, one.port])).toEqual([
      ['edge-port-missing', 'a', 'in'],
      ['edge-port-missing', 'out', 'nothing'],
      ['input-unconnected', 'out', 'in'],
    ]);
    expect(found[0]?.message).toContain('an edge runs from an output to an input');
    expect(found[1]?.message).toContain('Connect the edge to a port the node declares');
  });

  it('refuses an edge between layouts that differ, rather than downmix or truncate', () => {
    const problem = onlyProblem(
      graph([source('in', SURROUND), sink('out', STEREO)], [edge('in.out', 'out.in')]),
    );
    expect(problem).toMatchObject({ code: 'layout-mismatch', node: 'out', port: 'in' });
    expect(problem.message).toContain(
      '6 channels (left, right, centre, low-frequency, surround-left, surround-right)',
    );
    expect(problem.message).toContain('2 channels (left, right)');
    expect(problem.message).toContain('insert a channel-map or matrix node');
  });

  it('refuses an input nothing feeds', () => {
    const problem = onlyProblem(
      graph(
        [source('in'), mix('m', 2), sink('out')],
        [edge('in.out', 'm.in-1'), edge('m.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'input-unconnected', node: 'm', port: 'in-2' });
    expect(problem.message).toContain('Connect an output to it');
  });

  it('refuses an input two edges feed, and points to a mix node', () => {
    const problem = onlyProblem(
      graph(
        [source('a'), source('b'), sink('out')],
        [edge('a.out', 'out.in'), edge('b.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'input-connected-twice', node: 'out', port: 'in' });
    expect(problem.message).toContain('feed them to a mix node');
  });

  it('refuses a cycle, naming the nodes on it and not those downstream of it', () => {
    const problem = onlyProblem(
      graph(
        [source('in'), mix('m', 2), delay('fb', 1), delay('after', 0), sink('out')],
        [
          edge('in.out', 'm.in-1'),
          edge('m.out', 'fb.in'),
          edge('fb.out', 'm.in-2'),
          edge('fb.out', 'after.in'),
          edge('after.out', 'out.in'),
        ],
      ),
    );
    expect(problem).toMatchObject({ code: 'cycle', node: 'm' });
    expect(problem.message).toContain('m → fb → m');
    expect(problem.message).not.toContain('after');
    expect(problem.message).toContain('Break the loop');
  });

  it('refuses a node feeding itself', () => {
    const problem = onlyProblem(
      graph(
        [source('in'), mix('m', 2), sink('out')],
        [edge('in.out', 'm.in-1'), edge('m.out', 'm.in-2'), edge('m.out', 'out.in')],
      ),
    );
    expect(problem).toMatchObject({ code: 'cycle', node: 'm' });
    expect(problem.message).toContain('m → m');
  });

  it('refuses a graph with no sink', () => {
    const problem = onlyProblem(
      graph(
        [source('in'), node('meter', 'meter', { inputs: [port('in')] })],
        [edge('in.out', 'meter.in')],
      ),
    );
    expect(problem.code).toBe('no-sink');
    expect(problem.message).toContain('Connect the final output to a sink node');
  });

  it('places a contract’s diagnostic on the node it checked, whatever node it named', () => {
    const catalogue = new Map(CATALOGUE);
    catalogue.set('gain', {
      ...CATALOGUE.get('gain')!,
      check: () => [
        { code: 'node-settings-invalid', message: 'Wrong.', node: SERIAL.nodes[0]!.id },
      ],
    });
    const validation = validateGraph(
      graph(
        [
          source('in'),
          node('g', 'gain', { inputs: [port('in')], outputs: [port('out')] }),
          sink('out'),
        ],
        [edge('in.out', 'g.in'), edge('g.out', 'out.in')],
      ),
      catalogue,
    );
    expect(validation.ok ? [] : validation.diagnostics.map((one) => one.node)).toEqual(['g']);
  });
});

describe('diagnostics are deterministic', () => {
  const BROKEN = graph(
    [
      source('in'),
      delay('a', 0),
      delay('a', 0),
      mix('m', 3),
      node('x', 'nothing'),
      sink('out', MONO),
    ],
    [
      edge('in.out', 'a.in'),
      edge('a.out', 'm.in-1'),
      edge('a.out', 'm.in-1'),
      edge('m.out', 'out.in'),
      edge('in.out', 'gone.in'),
    ],
  );

  it('reports every problem, in the order the rules and the declarations give', () => {
    expect(
      problems(BROKEN).map((one) => `${one.code} ${one.node ?? ''}.${one.port ?? ''}`),
    ).toEqual([
      'node-id-duplicate a.',
      'node-type-unknown x.',
      'layout-mismatch out.in',
      'edge-node-missing gone.',
      'input-connected-twice m.in-1',
      'input-unconnected m.in-2',
      'input-unconnected m.in-3',
    ]);
  });

  it('gives the same diagnostics for the same graph every time', () => {
    expect(problems(BROKEN)).toEqual(problems(BROKEN));
    expect(problems(structuredClone(BROKEN))).toEqual(problems(BROKEN));
  });

  it('validates the same graph to the same order every time', () => {
    expect(valid(SERIAL).nodes.map((one) => one.descriptor)).toEqual(
      valid(structuredClone(SERIAL)).nodes.map((one) => one.descriptor),
    );
  });
});
