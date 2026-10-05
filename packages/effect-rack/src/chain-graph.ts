/**
 * A chain as a processing graph (ADR-0060, REQ-ARCH-140).
 *
 * A rack is realised as the engine's own graph, so the graph's latency analysis
 * and delay compensation align every path and no central manager decides how
 * processors meet: a slot is its processor's node, or its group's branches
 * summed by a mix node and scaled by the summing law; a slot mixed with its
 * input is that node's output and its input, each through a gain node, summed.
 * The engine delays the dry input to meet the wet output. A bypassed slot is no
 * node at all, so it costs nothing and delays nothing; a slot fully wet has no
 * dry path, so its output is the processor's exactly.
 *
 * Every node takes its identity from the slot it realises, so a running
 * parameter change finds its node by the processor it was made for.
 */

import {
  appliedSlots,
  fail,
  failure,
  FailureKind,
  succeed,
  summingFactor,
  type ChainSlot,
  type ChannelLayout,
  type DomainResult,
  type EffectChain,
  type ProcessorGroupId,
  type ProcessorId,
  type QualitySettings,
} from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  nodeId,
  type EdgeDescriptor,
  type GraphDescriptor,
  type NodeId,
  type PortReference,
  type ProcessingNodeDescriptor,
} from '@audiogubbins/audio-graph';
import { BuiltInNodeType } from '@audiogubbins/audio-engine';
import {
  ProcessorPort,
  processorNodeSettings,
  processorNodeType,
  type ProcessorType,
} from '@audiogubbins/processors';

/** The port a built-in node with one input and one output takes and gives. */
const IN = 'in';
const OUT = 'out';

/** A chain's graph, and where it begins and ends. */
export interface ChainGraph {
  readonly graph: GraphDescriptor;
  readonly input: NodeId;
  readonly output: NodeId;
  /** The layout the chain makes of its input. */
  readonly layout: ChannelLayout;
  /** The node that runs each applied processor. */
  readonly processors: ReadonlyMap<ProcessorId, NodeId>;
  /** The wet and dry gain nodes of each slot mixed with its input. */
  readonly mixes: ReadonlyMap<
    ProcessorId | ProcessorGroupId,
    { readonly wet: NodeId; readonly dry: NodeId }
  >;
  /** The second sink a measuring graph delivers a processor's input to, and that processor's node. */
  readonly measure?: MeasureTap;
}

/** Where a measuring pass hears a processor's input, and the node it measures for. */
export interface MeasureTap {
  readonly sink: NodeId;
  readonly layout: ChannelLayout;
  readonly type: string;
  readonly settings: ProcessingNodeDescriptor['settings'];
}

/**
 * The measurements made so far, written into the nodes of the processors they
 * were made for, and the processor a measuring graph taps, if it is one.
 */
export interface Measuring {
  readonly measured: ReadonlyMap<ProcessorId, readonly number[]>;
  readonly at?: ProcessorId;
}

/** A point in the graph being built: a port and the layout it carries. */
interface Tap {
  readonly port: PortReference;
  readonly layout: ChannelLayout;
}

function idOf(text: string): NodeId {
  const made = nodeId(text);
  // Every name made here is a slot's identifier, lower-case hexadecimal and
  // hyphens, with a fixed prefix, which the pattern takes.
  if (!made.ok) throw new Error(`A node name "${text}" made from a slot is not one a graph takes.`);
  return made.value;
}

function unknownType(typeKey: string): DomainResult<never> {
  return fail(
    failure(
      'effect-rack.processor-unknown',
      FailureKind.Unrecoverable,
      `This build has no processor of type "${typeKey}" to run.`,
      { details: { typeKey } },
    ),
  );
}

/** The graph being built, its nodes and edges in the order they are made. */
class GraphBuilder {
  readonly nodes: ProcessingNodeDescriptor[] = [];
  readonly edges: EdgeDescriptor[] = [];
  readonly processors = new Map<ProcessorId, NodeId>();
  readonly mixes = new Map<
    ProcessorId | ProcessorGroupId,
    { readonly wet: NodeId; readonly dry: NodeId }
  >();
  measure: MeasureTap | undefined;
  readonly #types: ReadonlyMap<string, ProcessorType>;
  readonly #quality: QualitySettings;
  readonly #measuring: Measuring;

  constructor(
    types: ReadonlyMap<string, ProcessorType>,
    quality: QualitySettings,
    measuring: Measuring,
  ) {
    this.#types = types;
    this.#quality = quality;
    this.#measuring = measuring;
  }

  node(node: ProcessingNodeDescriptor): void {
    this.nodes.push(node);
  }

  wire(from: PortReference, to: PortReference): void {
    this.edges.push({ from, to });
  }

  /** A built-in node of one input and one output, fed by `from`. */
  simple(
    name: string,
    type: string,
    from: Tap,
    settings: ProcessingNodeDescriptor['settings'],
  ): Tap {
    const id = idOf(name);
    this.node({
      kind: 'processing',
      id,
      type,
      inputs: [{ name: IN, layout: from.layout }],
      outputs: [{ name: OUT, layout: from.layout }],
      settings,
    });
    this.wire(from.port, { node: id, port: IN });
    return { port: { node: id, port: OUT }, layout: from.layout };
  }

  /** The slots of one list in series, applied ones only. */
  series(slots: readonly ChainSlot[], from: Tap): DomainResult<Tap> {
    let tap = from;
    for (const slot of appliedSlots(slots)) {
      const made = this.#slot(slot, tap);
      if (!made.ok) return made;
      tap = made.value;
    }
    return succeed(tap);
  }

  #slot(slot: ChainSlot, from: Tap): DomainResult<Tap> {
    const wet = slot.kind === 'processor' ? this.#processor(slot, from) : this.#group(slot, from);
    if (!wet.ok || slot.mix === 1) return wet;
    const wetGain = this.simple(`wet-${slot.id}`, BuiltInNodeType.Gain, wet.value, {
      gain: slot.mix,
    });
    const dryGain = this.simple(`dry-${slot.id}`, BuiltInNodeType.Gain, from, {
      gain: 1 - slot.mix,
    });
    this.mixes.set(slot.id, { wet: wetGain.port.node, dry: dryGain.port.node });
    return succeed(this.#sum(`blend-${slot.id}`, [dryGain, wetGain], [1, 1]));
  }

  #processor(slot: Extract<ChainSlot, { kind: 'processor' }>, from: Tap): DomainResult<Tap> {
    const type = this.#types.get(slot.typeKey);
    if (type === undefined) return unknownType(slot.typeKey);
    const layout = type.descriptor.outputLayout(from.layout, slot.values);
    if (!layout.ok) return layout;
    const id = idOf(`processor-${slot.id}`);
    const settings = processorNodeSettings(
      slot,
      type.descriptor,
      this.#quality,
      this.#measuring.measured.get(slot.id),
    );
    this.node({
      kind: 'processing',
      id,
      type: processorNodeType(slot.typeKey),
      inputs: [{ name: ProcessorPort.Input, layout: from.layout }],
      outputs: [{ name: ProcessorPort.Output, layout: layout.value }],
      settings,
    });
    this.wire(from.port, { node: id, port: ProcessorPort.Input });
    if (this.#measuring.at === slot.id) {
      const sink = idOf('measure-tap');
      this.node({
        kind: 'processing',
        id: sink,
        type: BuiltInNodeType.Output,
        inputs: [{ name: IN, layout: from.layout }],
        outputs: [],
        settings: {},
      });
      this.wire(from.port, { node: sink, port: IN });
      this.measure = { sink, layout: from.layout, type: processorNodeType(slot.typeKey), settings };
    }
    this.processors.set(slot.id, id);
    return succeed({ port: { node: id, port: ProcessorPort.Output }, layout: layout.value });
  }

  #group(slot: Extract<ChainSlot, { kind: 'group' }>, from: Tap): DomainResult<Tap> {
    const ends: Tap[] = [];
    for (const branch of slot.branches) {
      const end = this.series(branch.slots, from);
      if (!end.ok) return end;
      ends.push(end.value);
    }
    const factor = summingFactor(slot.summing, slot.branches.length);
    return succeed(
      this.#sum(
        `sum-${slot.id}`,
        ends,
        ends.map(() => factor),
      ),
    );
  }

  /** A mix node summing `taps`, each scaled by its gain. */
  #sum(name: string, taps: readonly Tap[], gains: readonly number[]): Tap {
    const id = idOf(name);
    const layout = taps[0]?.layout;
    if (layout === undefined) throw new Error('A sum is made of at least one path.');
    this.node({
      kind: 'processing',
      id,
      type: BuiltInNodeType.Mix,
      inputs: taps.map((_, index) => ({ name: `${IN}-${String(index)}`, layout })),
      outputs: [{ name: OUT, layout }],
      settings: { gains },
    });
    taps.forEach((tap, index) => {
      this.wire(tap.port, { node: id, port: `${IN}-${String(index)}` });
    });
    return { port: { node: id, port: OUT }, layout };
  }
}

/**
 * The graph that runs `chain` on audio of `input`, its processors given the
 * quality settings `quality` and the measurements `measuring` holds, or why
 * it cannot run: a processor this build does not have, or a layout one of
 * them does not take.
 */
export function chainGraph(
  chain: Pick<EffectChain, 'slots'>,
  types: ReadonlyMap<string, ProcessorType>,
  input: ChannelLayout,
  quality: QualitySettings,
  measuring: Measuring,
): DomainResult<ChainGraph> {
  const builder = new GraphBuilder(types, quality, measuring);
  const inputId = idOf('chain-input');
  const outputId = idOf('chain-output');
  builder.node({
    kind: 'processing',
    id: inputId,
    type: BuiltInNodeType.GraphInput,
    inputs: [],
    outputs: [{ name: OUT, layout: input }],
    settings: {},
  });
  const end = builder.series(chain.slots, { port: { node: inputId, port: OUT }, layout: input });
  if (!end.ok) return end;
  builder.node({
    kind: 'processing',
    id: outputId,
    type: BuiltInNodeType.Output,
    inputs: [{ name: IN, layout: end.value.layout }],
    outputs: [],
    settings: {},
  });
  builder.wire(end.value.port, { node: outputId, port: IN });
  return succeed({
    graph: { version: GRAPH_DESCRIPTOR_VERSION, nodes: builder.nodes, edges: builder.edges },
    input: inputId,
    output: outputId,
    layout: end.value.layout,
    processors: builder.processors,
    mixes: builder.mixes,
    ...(builder.measure === undefined ? {} : { measure: builder.measure }),
  });
}
