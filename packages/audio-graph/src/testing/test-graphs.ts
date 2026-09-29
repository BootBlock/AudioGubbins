/**
 * Small node contracts and graph builders for this package's tests.
 *
 * The graph defines no node type, so its tests bring their own: each contract
 * here is the least a node type could be while still exercising one rule, a
 * latency, a role or a check. The builders keep a test to the shape it is
 * about, a graph written as nodes and `node.port` edges.
 */

import {
  FIRST_ORDER_AMBIX,
  StandardLayouts,
  ambisonicLayout,
  labelledLayout,
  sampleCount,
  sampleRate,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import {
  GRAPH_DESCRIPTOR_VERSION,
  type EdgeDescriptor,
  type GraphDescriptor,
  type NodeDescriptor,
  type PortDescriptor,
  type ProcessingNodeDescriptor,
  type SettingValue,
  type SubgraphNodeDescriptor,
} from '../descriptor.js';
import type { GraphDiagnostic } from '../diagnostic.js';
import {
  NodeRole,
  type NodeCatalogue,
  type NodeContract,
  type ProcessorLatency,
} from '../node-contract.js';
import { nodeId, type NodeId, type PortReference } from '../node-id.js';

export const RATE: SampleRate = expectSuccess(sampleRate(48_000));
export const MONO: ChannelLayout = StandardLayouts.mono;
export const STEREO: ChannelLayout = StandardLayouts.stereo;
export const SURROUND: ChannelLayout = StandardLayouts.surround5_1;
export const AMBISONIC: ChannelLayout = expectSuccess(ambisonicLayout(FIRST_ORDER_AMBIX));
export const MID: ChannelLayout = expectSuccess(labelledLayout(['mid']));
export const SIDE: ChannelLayout = expectSuccess(labelledLayout(['side']));

function id(value: string): NodeId {
  return expectSuccess(nodeId(value));
}

export function port(name: string, layout: ChannelLayout = STEREO): PortDescriptor {
  return { name, layout };
}

/** A `node.port` reference, split at the last dot. */
export function ref(text: string): PortReference {
  const dot = text.lastIndexOf('.');
  return { node: id(text.slice(0, dot)), port: text.slice(dot + 1) };
}

export function edge(from: string, to: string): EdgeDescriptor {
  return { from: ref(from), to: ref(to) };
}

export function graph(
  nodes: readonly NodeDescriptor[],
  edges: readonly EdgeDescriptor[],
): GraphDescriptor {
  return { version: GRAPH_DESCRIPTOR_VERSION, nodes, edges };
}

interface NodeShape {
  readonly inputs?: readonly PortDescriptor[];
  readonly outputs?: readonly PortDescriptor[];
  readonly settings?: Readonly<Record<string, SettingValue>>;
}

export function node(
  identifier: string,
  type: string,
  shape: NodeShape = {},
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id: id(identifier),
    type,
    inputs: shape.inputs ?? [],
    outputs: shape.outputs ?? [],
    settings: shape.settings ?? {},
  };
}

/** A source with one output named `out`. */
export function source(
  identifier: string,
  layout: ChannelLayout = STEREO,
): ProcessingNodeDescriptor {
  return node(identifier, 'source', { outputs: [port('out', layout)] });
}

/** A sink with one input named `in`. */
export function sink(identifier: string, layout: ChannelLayout = STEREO): ProcessingNodeDescriptor {
  return node(identifier, 'sink', { inputs: [port('in', layout)] });
}

/** A processor of one input `in` and one output `out`, of `frames` latency. */
export function delay(
  identifier: string,
  frames: number,
  layout: ChannelLayout = STEREO,
): ProcessingNodeDescriptor {
  return node(identifier, 'delay', {
    inputs: [port('in', layout)],
    outputs: [port('out', layout)],
    settings: { frames },
  });
}

/** A mix of inputs `in-1` to `in-n` into one output `out`. */
export function mix(
  identifier: string,
  count: number,
  layout: ChannelLayout = STEREO,
): ProcessingNodeDescriptor {
  return node(identifier, 'mix', {
    inputs: Array.from({ length: count }, (_, index) => port(`in-${String(index + 1)}`, layout)),
    outputs: [port('out', layout)],
  });
}

export function subgraph(
  identifier: string,
  inner: GraphDescriptor,
  boundary: Pick<SubgraphNodeDescriptor, 'inputs' | 'outputs'>,
): SubgraphNodeDescriptor {
  return { kind: 'subgraph', id: id(identifier), graph: inner, ...boundary };
}

/** A contract of one role, whose latency is the node's `frames` setting where it has one. */
function contract(
  type: string,
  role: NodeContract['role'],
  extra: Partial<Pick<NodeContract, 'check' | 'latency'>> = {},
): NodeContract {
  return {
    type,
    role,
    check: extra.check ?? (() => []),
    latency:
      extra.latency ??
      ((described): ProcessorLatency => {
        const frames = described.settings['frames'];
        return {
          kind: 'known',
          frames: expectSuccess(sampleCount(typeof frames === 'number' ? frames : 0)),
        };
      }),
  };
}

function settingsCheck(described: ProcessingNodeDescriptor): readonly GraphDiagnostic[] {
  return typeof described.settings['gain'] === 'number'
    ? []
    : [
        {
          code: 'node-settings-invalid',
          message: 'A trim needs a numeric "gain" setting, in decibels. Set one.',
        },
      ];
}

function monoCheck(described: ProcessingNodeDescriptor): readonly GraphDiagnostic[] {
  return [...described.inputs, ...described.outputs].flatMap((one) =>
    one.layout.roles.length === 1
      ? []
      : [
          {
            code: 'layout-unsupported' as const,
            message: `This processor handles one channel; insert a channel-map node to extract one from "${one.name}".`,
            port: one.name,
          },
        ],
  );
}

/**
 * The test catalogue: sources, sinks and meters; a delay whose latency is its
 * `frames` setting; a mix, a matrix, a cache and a side-chained compressor of
 * no latency; a plug-in host that cannot say its latency; an oversampler whose
 * latency depends on the rate; and two whose checks refuse a node.
 */
export const CATALOGUE: NodeCatalogue = new Map(
  [
    contract('source', NodeRole.Source),
    contract('sink', NodeRole.Sink),
    contract('meter', NodeRole.Analysis),
    contract('delay', NodeRole.Processor),
    contract('gain', NodeRole.Processor),
    contract('mix', NodeRole.Processor),
    contract('matrix', NodeRole.Processor),
    contract('cache', NodeRole.Processor),
    contract('compressor', NodeRole.Processor),
    contract('plugin-host', NodeRole.Processor, {
      latency: () => ({ kind: 'unknown', reason: 'the plug-in reports no latency' }),
    }),
    contract('oversampler', NodeRole.Processor, {
      latency: (_, rate) => ({ kind: 'known', frames: expectSuccess(sampleCount(rate / 1000)) }),
    }),
    contract('trim', NodeRole.Processor, { check: settingsCheck }),
    contract('mono-only', NodeRole.Processor, { check: monoCheck }),
  ].map((one) => [one.type, one]),
);
