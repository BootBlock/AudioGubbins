import { FIRST_ORDER_AMBIX, StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { readGraphDescriptor } from './descriptor-reading.js';
import type { GraphDescriptor } from './descriptor.js';
import {
  AMBISONIC,
  MID,
  STEREO,
  SURROUND,
  delay,
  edge,
  graph,
  node,
  port,
  ref,
  sink,
  source,
  subgraph,
} from './testing/test-graphs.js';

const INNER = graph([delay('d', 4)], []);

/** A graph using every kind of node, setting and layout the descriptor has. */
const COMPLETE: GraphDescriptor = graph(
  [
    source('in', SURROUND),
    node('shape', 'matrix', {
      inputs: [port('in', SURROUND)],
      outputs: [port('out', STEREO), port('mid', MID), port('sphere', AMBISONIC)],
      settings: { gain: -3.5, bypass: false, preset: 'bs-775', coefficients: [0.5, -1, 0.25] },
    }),
    subgraph('fx', INNER, {
      inputs: [{ name: 'in', layout: STEREO, to: [ref('d.in')] }],
      outputs: [{ name: 'out', layout: STEREO, from: ref('d.out') }],
    }),
    sink('out'),
  ],
  [edge('in.out', 'shape.in'), edge('shape.out', 'fx.in'), edge('fx.out', 'out.in')],
);

/** A copy of the complete graph as untyped data, to be broken by a test. */
function data(): Record<string, unknown> {
  return structuredClone(COMPLETE) as unknown as Record<string, unknown>;
}

/** The failures of reading a value, as `code at path`. */
function failures(value: unknown): readonly string[] {
  const result = readGraphDescriptor(value);
  if (result.ok) throw new Error('Expected the value to be refused.');
  return result.failures.map((one) => `${one.code} at ${String(one.details?.['path'])}`);
}

describe('reading a graph descriptor', () => {
  it('reads a descriptor that crossed a thread boundary back to the same graph', () => {
    expect(expectSuccess(readGraphDescriptor(data()))).toEqual(COMPLETE);
  });

  it('builds a new value, leaving behind a field the descriptor does not have', () => {
    const value = data();
    value['extra'] = 'ignored';
    const read = expectSuccess(readGraphDescriptor(value));
    expect(read).toEqual(COMPLETE);
    expect(read).not.toHaveProperty('extra');
  });

  it('refuses a version this build does not read', () => {
    const value = data();
    value['version'] = 2;
    expect(expectFailureCode(readGraphDescriptor(value))).toBe('graph.version-unsupported');
    const summary = readGraphDescriptor(value);
    expect(summary.ok ? '' : summary.failures[0].summary).toContain(
      'send the descriptor from a build of the same version',
    );
  });

  it('refuses a value of the wrong shape, saying where', () => {
    expect(failures(null)).toEqual(['graph.shape-invalid at graph']);
    expect(failures({ version: 1, nodes: {}, edges: [] })).toEqual([
      'graph.shape-invalid at graph.nodes',
    ]);
    expect(failures({ version: 1, nodes: [{ kind: 'effect' }], edges: [] })).toEqual([
      'graph.shape-invalid at graph.nodes[0].kind',
    ]);
    expect(failures({ version: 1, nodes: [], edges: [{ from: 'a.out', to: {} }] })).toEqual([
      'graph.shape-invalid at graph.edges[0].from',
      'graph.shape-invalid at graph.edges[0].to.node',
      'graph.name-invalid at graph.edges[0].to.port',
    ]);
  });

  it('refuses an identifier or a name that is not well formed', () => {
    const value = data();
    const nodes = value['nodes'] as Record<string, unknown>[];
    nodes[0]!['id'] = 'Input One';
    (nodes[1]!['inputs'] as Record<string, unknown>[])[0]!['name'] = '';
    expect(failures(value)).toEqual([
      'graph.node-id-invalid at graph.nodes[0].id',
      'graph.name-invalid at graph.nodes[1].inputs[0].name',
    ]);
  });

  it('refuses a number that is not finite, in a setting or a list of them', () => {
    const value = data();
    const settings = (value['nodes'] as Record<string, Record<string, unknown>>[])[1]!['settings']!;
    settings['gain'] = Number.NaN;
    settings['coefficients'] = [1, Number.POSITIVE_INFINITY];
    settings['ramp'] = { to: 1 };
    expect(failures(value)).toEqual([
      'graph.number-not-finite at graph.nodes[1].settings.gain',
      'graph.number-not-finite at graph.nodes[1].settings.coefficients[1]',
      'graph.shape-invalid at graph.nodes[1].settings.ramp',
    ]);
  });

  it('rebuilds each layout through the domain, so a forged one cannot pass', () => {
    const value = data();
    const ports = (value['nodes'] as Record<string, unknown>[])[1]!['outputs'] as Record<
      string,
      unknown
    >[];
    ports[0]!['layout'] = { roles: ['centre', 'centre'] };
    ports[1]!['layout'] = { roles: ['ambisonic'] };
    ports[2]!['layout'] = { ...StandardLayouts.stereo, ambisonic: FIRST_ORDER_AMBIX };
    const result = readGraphDescriptor(value);
    expect(failures(value)).toEqual([
      'graph.layout-invalid at graph.nodes[1].outputs[0].layout',
      'graph.layout-invalid at graph.nodes[1].outputs[1].layout',
      'graph.layout-invalid at graph.nodes[1].outputs[2].layout',
    ]);
    expect(result.ok ? [] : result.failures.map((one) => one.cause?.code)).toEqual([
      'channel.layout-duplicate-role',
      'channel.layout-ambisonic-without-convention',
      undefined,
    ]);
  });

  it('refuses a channel role or ambisonic convention it does not know', () => {
    const value = data();
    const ports = (value['nodes'] as Record<string, unknown>[])[1]!['outputs'] as Record<
      string,
      unknown
    >[];
    ports[0]!['layout'] = { roles: ['left', 'upstairs'] };
    ports[2]!['layout'] = {
      roles: ['ambisonic'],
      ambisonic: { order: 0, ordering: 'acn', normalisation: 'loud' },
    };
    expect(failures(value)).toEqual([
      'graph.shape-invalid at graph.nodes[1].outputs[0].layout.roles[1]',
      'graph.shape-invalid at graph.nodes[1].outputs[2].layout.ambisonic.normalisation',
    ]);
  });

  it('refuses a subgraph that contains itself, which a structured clone can carry', () => {
    const value = data();
    const inner = (value['nodes'] as Record<string, unknown>[])[2]!;
    inner['graph'] = value;
    expect(failures(structuredClone(value))).toEqual([
      'graph.subgraph-recursive at graph.nodes[2].graph',
    ]);
  });

  it('reports every problem in one pass, in the order of the value', () => {
    expect(
      failures({
        version: 0,
        nodes: [{ kind: 'processing', id: 'a', type: '', inputs: [], outputs: [], settings: [] }],
        edges: 'none',
      }),
    ).toEqual([
      'graph.version-unsupported at graph.version',
      'graph.shape-invalid at graph.nodes[0].type',
      'graph.shape-invalid at graph.nodes[0].settings',
      'graph.shape-invalid at graph.edges',
    ]);
  });
});
