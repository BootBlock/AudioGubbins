/**
 * Reading a node's ports and settings, once, for both of its checkers.
 *
 * ADR-0030 makes a node type one object so that what the graph accepts and
 * what the kernel runs cannot disagree. Each built-in type therefore reads a
 * node with a single function: the graph asks it through the contract's
 * `check`, with the descriptor, and the kernel through `createKernel`, with
 * the plan step made from that descriptor. This module is the vocabulary those
 * readers share: the shape both forms have, the problems a reading finds, and
 * how those problems reach each caller.
 */

import {
  failure,
  FailureKind,
  fail,
  layoutsMatch,
  type ChannelLayout,
  type DomainFailureResult,
} from '@audiogubbins/domain';
import type {
  GraphDiagnostic,
  GraphDiagnosticCode,
  NodeId,
  PlanStep,
  SettingValue,
} from '@audiogubbins/audio-graph';

/** One port of a node, as a descriptor and a plan step both describe it. */
export interface PortShape {
  readonly name: string;
  readonly layout: ChannelLayout;
}

/** What a node type reads of a node: its ports and its settings. */
export interface NodeShape {
  readonly id: NodeId;
  readonly type: string;
  readonly inputs: readonly PortShape[];
  readonly outputs: readonly PortShape[];
  readonly settings: Readonly<Record<string, SettingValue>>;
}

/** The diagnostics a node type's own reading may raise. */
export type NodeProblemCode = Extract<
  GraphDiagnosticCode,
  'node-settings-invalid' | 'role-ports-invalid' | 'layout-unsupported'
>;

/** One problem a node type found with a node. */
export interface NodeProblem extends GraphDiagnostic {
  readonly code: NodeProblemCode;
}

/**
 * What a node type made of a node, or every problem it found.
 *
 * A refusal may carry no problem of its own: a side the node's role requires
 * but that has no port is reported by the graph's role check, and saying it
 * twice would only bury the other problems.
 */
export type NodeReading<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly problems: readonly NodeProblem[] };

/** The reading of a node with nothing wrong with it. */
export function accepted<TValue>(value: TValue): NodeReading<TValue> {
  return { ok: true, value };
}

/** The reading of a node with the problems found. */
export function refused<TValue>(problems: readonly NodeProblem[]): NodeReading<TValue> {
  return { ok: false, problems };
}

/** A plan step as the shape its descriptor had, for the same reader to read. */
export function plannedShape(step: PlanStep): NodeShape {
  return {
    id: step.node,
    type: step.type,
    inputs: step.inputs.map(({ port, layout }) => ({ name: port, layout })),
    outputs: step.outputs.map(({ port, layout }) => ({ name: port, layout })),
    settings: step.settings,
  };
}

/** What the graph is told of a reading: its problems, or none. */
export function problemsOf(reading: NodeReading<unknown>): readonly NodeProblem[] {
  return reading.ok ? [] : reading.problems;
}

/** The failure code a kernel refuses with, for each problem a reading may find. */
const FAILURE_CODES: Readonly<Record<NodeProblemCode, string>> = {
  'node-settings-invalid': 'node.settings-invalid',
  'role-ports-invalid': 'node.ports-invalid',
  'layout-unsupported': 'node.layout-unsupported',
};

/**
 * Why a kernel cannot be made for a node its reader refused.
 *
 * A plan is made only from a graph that passed its checks, so this is reached
 * by a step built some other way, and it says what the checks would have.
 */
export function kernelRefusal(
  shape: NodeShape,
  problems: readonly NodeProblem[],
): DomainFailureResult {
  const [first, ...rest] = problems.map((problem) =>
    failure(FAILURE_CODES[problem.code], FailureKind.Rejected, problem.message, {
      details: { node: shape.id },
    }),
  );
  return first === undefined
    ? fail(
        failure(
          'node.ports-invalid',
          FailureKind.Rejected,
          `Node ${shape.id} lacks a port its role requires. Give it the ports its type declares.`,
          { details: { node: shape.id } },
        ),
      )
    : fail(first, ...rest);
}

/** How a side of a node is written in a message, one port and several. */
const SIDE_WORDS = {
  inputs: { one: 'input', many: 'inputs' },
  outputs: { one: 'output', many: 'outputs' },
} as const;

/**
 * The only port on one side of a node, or `undefined` with the problem noted.
 *
 * Only a second port is this type's to report. No port at all is the role
 * check's, which the graph runs on every node before its contract's.
 */
export function onlyPort(
  shape: NodeShape,
  side: 'inputs' | 'outputs',
  problems: NodeProblem[],
): PortShape | undefined {
  const ports = shape[side];
  if (ports.length > 1) {
    const words = SIDE_WORDS[side];
    problems.push({
      code: 'role-ports-invalid',
      message: `Node ${shape.id} is a ${shape.type} node, which has exactly one ${words.one}, but it has ${String(ports.length)} ${words.many}. Remove all but one.`,
      node: shape.id,
    });
    return undefined;
  }
  return ports[0];
}

/**
 * Notes a problem if an input and an output of a node carry different layouts,
 * for a type that works on each channel where it stands and so cannot change
 * what a channel means.
 */
export function requireSameLayout(
  shape: NodeShape,
  input: PortShape,
  output: PortShape,
  problems: NodeProblem[],
): void {
  if (layoutsMatch(input.layout, output.layout)) return;
  problems.push({
    code: 'layout-unsupported',
    message: `Node ${shape.id} is a ${shape.type} node, whose input "${input.name}" and output "${output.name}" need the same layout, but they differ. Give both the same layout, and convert between layouts with a channel-map or matrix node first.`,
    node: shape.id,
    port: output.name,
  });
}
