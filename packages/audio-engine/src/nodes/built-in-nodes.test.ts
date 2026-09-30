import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  compileGraph,
  type EdgeDescriptor,
  type GraphDescriptor,
  type NodeDescriptor,
} from '@audiogubbins/audio-graph';

import { RATE, id, nodeOf, port } from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { BUILT_IN_NODES } from './built-in-nodes.js';
import { NamedMatrix } from './named-matrices.js';

const STEREO = StandardLayouts.stereo;
const SURROUND = StandardLayouts.surround5_1;

function edge(from: string, to: string): EdgeDescriptor {
  const [fromNode = '', fromPort = ''] = from.split('.');
  const [toNode = '', toPort = ''] = to.split('.');
  return { from: { node: id(fromNode), port: fromPort }, to: { node: id(toNode), port: toPort } };
}

function graph(
  nodes: readonly NodeDescriptor[],
  edges: readonly EdgeDescriptor[],
): GraphDescriptor {
  return { version: GRAPH_DESCRIPTOR_VERSION, nodes, edges };
}

/**
 * A 5.1 input downmixed, trimmed and metered, mixed with a tone behind a
 * lookahead delay, and delivered to the output.
 */
function wellFormed(gainSetting: number | string = 0.5): GraphDescriptor {
  return graph(
    [
      nodeOf(BuiltInNodeType.GraphInput, { outputs: [port('out', SURROUND)] }, 'input'),
      nodeOf(
        BuiltInNodeType.Matrix,
        {
          inputs: [port('in', SURROUND)],
          outputs: [port('out', STEREO)],
          settings: { named: NamedMatrix.Bs775FiveOneToStereo },
        },
        'downmix',
      ),
      nodeOf(
        BuiltInNodeType.Gain,
        {
          inputs: [port('in', STEREO)],
          outputs: [port('out', STEREO)],
          settings: { gain: gainSetting },
        },
        'trim',
      ),
      nodeOf(BuiltInNodeType.Meter, { inputs: [port('in', STEREO)] }, 'level'),
      nodeOf(
        BuiltInNodeType.Tone,
        { outputs: [port('out', STEREO)], settings: { frequency: 997 } },
        'tone',
      ),
      nodeOf(
        BuiltInNodeType.Delay,
        {
          inputs: [port('in', STEREO)],
          outputs: [port('out', STEREO)],
          settings: { frames: 64, 'as-latency': true },
        },
        'lookahead',
      ),
      nodeOf(
        BuiltInNodeType.Mix,
        {
          inputs: [port('in-1', STEREO), port('in-2', STEREO)],
          outputs: [port('out', STEREO)],
          settings: { gains: [1, 0.25] },
        },
        'bus',
      ),
      nodeOf(BuiltInNodeType.Output, { inputs: [port('in', STEREO)] }, 'speakers'),
    ],
    [
      edge('input.out', 'downmix.in'),
      edge('downmix.out', 'trim.in'),
      edge('trim.out', 'level.in'),
      edge('trim.out', 'bus.in-1'),
      edge('tone.out', 'lookahead.in'),
      edge('lookahead.out', 'bus.in-2'),
      edge('bus.out', 'speakers.in'),
    ],
  );
}

describe('the built-in node types', () => {
  it('are every built-in type, each under its own name', () => {
    expect([...BUILT_IN_NODES.keys()].toSorted()).toEqual(
      Object.values(BuiltInNodeType).toSorted(),
    );
    for (const [type, implementation] of BUILT_IN_NODES) expect(implementation.type).toBe(type);
  });

  it('serve as the catalogue a graph compiles against, lookahead compensated', () => {
    const compiled = compileGraph(wellFormed(), BUILT_IN_NODES, RATE);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const bus = compiled.plan.steps.find((step) => step.node === id('bus'));
    expect(bus?.inputs.map((input) => input.delay)).toEqual([64, 0]);
    expect(compiled.plan.latency).toMatchObject({ frames: 64 });
  });

  it('refuse a graph whose node is malformed, saying so once for each problem', () => {
    const refused = compileGraph(wellFormed('loud'), BUILT_IN_NODES, RATE);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.diagnostics.map(({ code, node }) => ({ code, node }))).toEqual([
      { code: 'node-settings-invalid', node: id('trim') },
    ]);

    const inputless = wellFormed();
    const withoutInput = graph(
      inputless.nodes.map((node) =>
        node.kind === 'processing' && node.id === id('level') ? { ...node, inputs: [] } : node,
      ),
      inputless.edges.filter((one) => one.to.node !== id('level')),
    );
    const noPort = compileGraph(withoutInput, BUILT_IN_NODES, RATE);
    expect(noPort.ok).toBe(false);
    if (noPort.ok) return;
    expect(noPort.diagnostics.map(({ code, node }) => ({ code, node }))).toEqual([
      { code: 'role-ports-invalid', node: id('level') },
    ]);
  });
});
