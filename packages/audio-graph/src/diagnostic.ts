/**
 * What is wrong with a graph, said so that someone can put it right.
 *
 * REQ-ARCH-140 requires an invalid graph to be refused deterministically with
 * actionable diagnostics. Deterministic means the same graph gives the same
 * diagnostics in the same order, so a message can be compared, cached or
 * tested. Actionable means each message says what to change, not only what
 * the checker disliked.
 */

import type { NodeId } from './node-id.js';

/** Which rule a diagnostic reports. */
export type GraphDiagnosticCode =
  | 'node-id-duplicate'
  | 'node-type-unknown'
  | 'node-settings-invalid'
  | 'port-name-duplicate'
  | 'role-ports-invalid'
  | 'layout-unsupported'
  | 'edge-node-missing'
  | 'edge-port-missing'
  | 'layout-mismatch'
  | 'input-unconnected'
  | 'input-connected-twice'
  | 'cycle'
  | 'no-sink'
  | 'unknown-latency-at-merge'
  | 'latency-out-of-range'
  | 'subgraph-boundary-invalid'
  | 'subgraph-recursive';

/** One problem with a graph. */
export interface GraphDiagnostic {
  readonly code: GraphDiagnosticCode;

  /** British English, saying what is wrong and what to do about it. */
  readonly message: string;

  /** The node the problem is on, where it is on one. */
  readonly node?: NodeId;

  /** The port of that node, where the problem is on one. */
  readonly port?: string;
}

/** Every problem found, which is at least one. */
export type GraphDiagnostics = readonly [GraphDiagnostic, ...GraphDiagnostic[]];

/** A graph refused, with every reason. */
export interface GraphRefusal {
  readonly ok: false;
  readonly diagnostics: GraphDiagnostics;
}

/** The refusal of the problems found, or `undefined` when none was. */
export function refusalOf(found: readonly GraphDiagnostic[]): GraphRefusal | undefined {
  const [first, ...rest] = found;
  return first === undefined ? undefined : { ok: false, diagnostics: [first, ...rest] };
}
