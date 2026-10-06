/**
 * A processor type: one object that states its descriptor and makes its
 * kernel (ADR-0061).
 *
 * A type is defined once, by its descriptor and the function that makes its
 * kernel from what a node holds, and `processorType` makes of that the node
 * implementation the engine runs: its contract checks a node by the
 * descriptor's parameters and layouts, its latency is the descriptor's for the
 * node's values, and its kernel is made from the same reading. A processor
 * therefore cannot be described by one table and run by another.
 *
 * A processor's node takes one input, `input`, and gives one output,
 * `output`; a type that listens to another signal, as a compressor keyed from
 * elsewhere does, may also take `side-chain`, whose layout it checks.
 */

import {
  FailureKind,
  MAXIMUM_QUALITY,
  fail,
  failure,
  layoutsMatch,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type ParameterValue,
  type ProcessorDescriptor,
  type ProcessorSettings,
  type ProcessorState,
  type QualitySettings,
  type SampleRate,
} from '@audiogubbins/domain';
import { NodeRole, type GraphDiagnostic, type SettingValue } from '@audiogubbins/audio-graph';
import {
  kernelRefusal,
  plannedShape,
  type CanonicalDsp,
  type NodeImplementation,
  type NodeKernel,
  type NodeProblem,
  type NodeShape,
  type PortShape,
} from '@audiogubbins/audio-engine';

import { readProcessorNode, type ProcessorNodeReading } from './processor-node.js';
import type { Measurement, Measurer } from './whole-pass.js';

/** The node type a processor type runs as, apart from the engine's own node types. */
export function processorNodeType(typeKey: string): string {
  return `processor.${typeKey}`;
}

/** The ports of a processor's node. */
export const ProcessorPort = {
  Input: 'input',
  SideChain: 'side-chain',
  Output: 'output',
} as const;

/** A processor's parameters by key, each read as the kind its descriptor declares. */
export interface ParameterReader {
  number(key: string): number;
  choice(key: string): string;
  toggle(key: string): boolean;
}

/** What a kernel is made from. */
export interface ProcessorRun {
  readonly parameters: ParameterReader;
  readonly input: ChannelLayout;
  readonly output: ChannelLayout;
  /** The layout of the side-chain input, where the node has one. */
  readonly sideChain?: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly blockFrames: number;
  readonly quality: QualitySettings;
  readonly state?: ProcessorState;
  /**
   * What a whole pass over the input measured, for a processor that needs
   * one; absent until the pass is made, when the kernel passes its input on
   * unchanged so the pass can be made through it. The kernel checks it is
   * the kind it takes.
   */
  readonly measured?: Measurement;
  readonly dsp: CanonicalDsp;
  /**
   * The frame of the stream its input carries in the first frame its first
   * `process` call is given: the frame the run starts at, part way through
   * for a preview, less the latency of the path that reaches the node, so
   * negative while what comes before it is still filling. A kernel that
   * plays back what a pass made of the whole stream starts there; one that
   * only hears its input has no use for it.
   */
  readonly start: number;
}

/**
 * What a measurer is made from: a kernel's run less the measurement it is
 * making and the start, since a pass hears the stream from its first frame.
 */
export type MeasuringRun = Omit<ProcessorRun, 'measured' | 'start'>;

/** What a processor type is defined by. */
export interface ProcessorDefinition {
  readonly descriptor: ProcessorDescriptor;

  /** Whether its node may take a side-chain input, and which layouts of it it takes. */
  readonly sideChain?: (input: ChannelLayout, sideChain: ChannelLayout) => boolean;

  /**
   * The kernel for a node of this type, or why it cannot run. A kernel reads
   * its input through `finiteSample`, and writes every frame of its output.
   */
  kernel(run: ProcessorRun): DomainResult<NodeKernel>;

  /** How a processor whose descriptor asks for a whole pass measures it. */
  readonly measure?: (run: MeasuringRun) => Measurer;
}

/** A processor type: the node implementation the engine runs, and the descriptor it states. */
export interface ProcessorType extends NodeImplementation {
  readonly descriptor: ProcessorDescriptor;
  /** What measures a node's whole input, for a type that needs it. */
  measurer?(
    settings: Readonly<Record<string, SettingValue>>,
    input: ChannelLayout,
    context: {
      readonly sampleRate: SampleRate;
      readonly blockFrames: number;
      readonly dsp: CanonicalDsp;
    },
  ): DomainResult<Measurer>;
}

function parameterReader(
  descriptor: ProcessorDescriptor,
  values: ProcessorNodeReading['values'],
): ParameterReader {
  const byKey = new Map<string, ParameterValue>();
  for (const parameter of descriptor.parameters) {
    const value = values.get(parameter.id);
    if (value !== undefined) byKey.set(parameter.key, value);
  }
  const read = <T>(
    key: string,
    kind: string,
    accept: (value: ParameterValue) => value is T & ParameterValue,
  ): T => {
    const value = byKey.get(key);
    if (value === undefined || !accept(value)) {
      // A kernel names only the parameters its own descriptor declares, and the
      // node was read against that descriptor, so this is a fault in the type.
      throw new Error(`Processor "${descriptor.typeKey}" has no ${kind} parameter "${key}".`);
    }
    return value;
  };
  return {
    number: (key) => read(key, 'numeric', (value): value is number => typeof value === 'number'),
    choice: (key) => read(key, 'choice', (value): value is string => typeof value === 'string'),
    toggle: (key) => read(key, 'toggle', (value): value is boolean => typeof value === 'boolean'),
  };
}

/** A node read as a processor of `definition`: its reading and ports, or every problem. */
interface ReadNode {
  readonly reading: ProcessorNodeReading;
  readonly input: PortShape;
  readonly output: PortShape;
  readonly sideChain?: PortShape;
}

function problem(
  shape: NodeShape,
  code: NodeProblem['code'],
  message: string,
  port?: string,
): NodeProblem {
  return {
    code,
    message: `Node ${shape.id} (${shape.type}): ${message}.`,
    node: shape.id,
    ...(port === undefined ? {} : { port }),
  };
}

/** A processor node's ports, or the problem with them. */
function portsOf(
  definition: ProcessorDefinition,
  shape: NodeShape,
): Omit<ReadNode, 'reading'> | NodeProblem {
  const input = shape.inputs.find((port) => port.name === ProcessorPort.Input);
  const sideChain = shape.inputs.find((port) => port.name === ProcessorPort.SideChain);
  const output = shape.outputs.find((port) => port.name === ProcessorPort.Output);
  const known = shape.inputs.every(
    (port) =>
      port.name === ProcessorPort.Input ||
      (port.name === ProcessorPort.SideChain && definition.sideChain !== undefined),
  );
  // The engine gives a kernel its input blocks in the order the node declares
  // its ports, and a kernel reads "input" first and "side-chain" second, so a
  // node that declared them the other way round would key on its programme.
  const ordered = shape.inputs[0] === input;
  if (input === undefined || output === undefined || shape.outputs.length !== 1 || !known) {
    const optional = definition.sideChain === undefined ? '' : ' and may take "side-chain"';
    return problem(
      shape,
      'role-ports-invalid',
      `a processor takes the input "input"${optional}, and gives the output "output"`,
    );
  }
  if (!ordered) {
    return problem(shape, 'role-ports-invalid', 'its input "input" must come before "side-chain"');
  }
  return { input, output, ...(sideChain === undefined ? {} : { sideChain }) };
}

/** The problems with the layouts of a node whose settings and ports were read. */
function layoutProblems(
  definition: ProcessorDefinition,
  shape: NodeShape,
  ports: Omit<ReadNode, 'reading'>,
  reading: ProcessorNodeReading,
): NodeProblem[] {
  const { input, output, sideChain } = ports;
  const problems: NodeProblem[] = [];
  const made = definition.descriptor.outputLayout(input.layout, reading.values);
  if (!made.ok) {
    problems.push(problem(shape, 'layout-unsupported', made.failures[0].summary, input.name));
  } else if (!layoutsMatch(made.value, output.layout)) {
    const message = 'its output does not have the layout the processor makes of its input';
    problems.push(problem(shape, 'layout-unsupported', message, output.name));
  }
  if (sideChain !== undefined && definition.sideChain?.(input.layout, sideChain.layout) === false) {
    const message = 'it does not take a side-chain of that layout';
    problems.push(problem(shape, 'layout-unsupported', message, sideChain.name));
  }
  return problems;
}

function readNode(
  definition: ProcessorDefinition,
  shape: NodeShape,
): { readonly node?: ReadNode; readonly problems: readonly NodeProblem[] } {
  const read = readProcessorNode(definition.descriptor, shape.settings, MAXIMUM_QUALITY.settings);
  const problems = read.problems.map((message) => problem(shape, 'node-settings-invalid', message));
  const ports = portsOf(definition, shape);
  if ('code' in ports) return { problems: [...problems, ports] };
  if (read.reading === undefined) return { problems };
  problems.push(...layoutProblems(definition, shape, ports, read.reading));
  return problems.length > 0
    ? { problems }
    : { node: { ...ports, reading: read.reading }, problems };
}

function settingsOf(reading: ProcessorNodeReading, sampleRate: SampleRate): ProcessorSettings {
  return { values: reading.values, sampleRate, quality: reading.quality };
}

/** The node implementation of the processor type `definition` defines. */
export function processorType(definition: ProcessorDefinition): ProcessorType {
  const { descriptor } = definition;
  return {
    descriptor,
    type: processorNodeType(descriptor.typeKey),
    role: NodeRole.Processor,
    check: (node): readonly GraphDiagnostic[] => readNode(definition, node).problems,
    latency: (node, sampleRate) => {
      const read = readNode(definition, node);
      return read.node === undefined
        ? { kind: 'unknown', reason: 'the node does not hold a processor its type can run' }
        : descriptor.latency(settingsOf(read.node.reading, sampleRate));
    },
    createKernel: (step, context) => {
      const shape = plannedShape(step);
      const read = readNode(definition, shape);
      if (read.node === undefined) return kernelRefusal(shape, read.problems);
      const { reading, input, output, sideChain } = read.node;
      const arrival = step.inputArrival;
      if (arrival.kind !== 'known') {
        // Only a run whose latency is known reaches a kernel through the rack,
        // so this is a graph built elsewhere that no stream position fits.
        return fail(
          failure(
            'processor.start-unknown',
            FailureKind.Rejected,
            `A ${descriptor.label} node cannot tell which frame of its stream it hears, since the latency before it is not known.`,
            { details: { node: shape.id } },
          ),
        );
      }
      return definition.kernel({
        parameters: parameterReader(descriptor, reading.values),
        input: input.layout,
        output: output.layout,
        ...(sideChain === undefined ? {} : { sideChain: sideChain.layout }),
        sampleRate: context.sampleRate,
        blockFrames: context.blockFrames,
        quality: reading.quality,
        ...(reading.state === undefined ? {} : { state: reading.state }),
        ...(reading.measured === undefined ? {} : { measured: reading.measured }),
        dsp: context.dsp,
        start: reading.start - arrival.frames,
      });
    },
    ...(definition.measure === undefined
      ? {}
      : { measurer: measurerOf(definition, definition.measure) }),
  };
}

/** What makes the measurer of a node of `definition`. */
function measurerOf(
  definition: ProcessorDefinition,
  measure: NonNullable<ProcessorDefinition['measure']>,
): NonNullable<ProcessorType['measurer']> {
  const { descriptor } = definition;
  return (settings, input, context) => {
    const read = readProcessorNode(descriptor, settings, MAXIMUM_QUALITY.settings);
    if (read.reading === undefined) {
      return fail(
        failure(
          'processor.node-unreadable',
          FailureKind.Rejected,
          `A ${descriptor.label} node cannot be measured: ${read.problems.join('; ')}.`,
        ),
      );
    }
    const output = descriptor.outputLayout(input, read.reading.values);
    if (!output.ok) return output;
    return succeed(
      measure({
        parameters: parameterReader(descriptor, read.reading.values),
        input,
        output: output.value,
        sampleRate: context.sampleRate,
        blockFrames: context.blockFrames,
        quality: read.reading.quality,
        ...(read.reading.state === undefined ? {} : { state: read.reading.state }),
        dsp: context.dsp,
      }),
    );
  };
}

/** The descriptors of `types`, by type key: the catalogue the domain checks chains against. */
export function catalogueOf(
  types: readonly ProcessorType[],
): ReadonlyMap<string, ProcessorDescriptor> {
  return new Map(types.map((type) => [type.descriptor.typeKey, type.descriptor]));
}
