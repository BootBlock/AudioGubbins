/**
 * Which path each node of a plan runs: its canonical kernel, or an accelerated
 * path its type declares, and why.
 *
 * An accelerator is optional (ADR-0003): a node type may declare a path it can
 * run on one beside its canonical kernel, never instead of it. The choice is
 * made here, once per node, from what the host was told it may use, which it
 * is given and never probes (REQ-EXEC-136.4). A final render never takes an
 * accelerated path: an offline render is held to the canonical bits
 * (ADR-0032), which a GPU's arithmetic does not promise. So the answer is the
 * canonical path wherever the accelerator is missing, the node declares none,
 * or the output must be canonical, and the host reports the answer as it is.
 */

import type { ExecutionPlan, NodeId } from '@audiogubbins/audio-graph';

import { ProcessingPurpose } from '../profiles/processing-mode.js';
import type { Accelerator } from './accelerator.js';
import type { NodeImplementations } from './node-implementation.js';

/**
 * Whether the host may use each accelerator, one field for each, so a new
 * accelerator is a field every host must answer; the runtime's capabilities
 * are one.
 */
export type AvailableAccelerators = Readonly<Record<Accelerator, boolean>>;

/** Why a node runs the path it runs. */
export const PathReason = {
  /** Its type declares no accelerated path, so its canonical kernel is its only one. */
  NoneDeclared: 'none-declared',
  /** Its type declares one, and the output must be canonical: a final render. */
  CanonicalOutput: 'canonical-output',
  /** Its type declares one, and this device offers no such accelerator. */
  Unavailable: 'unavailable',
  /** Its type declares one, the device offers it, and the purpose allows it. */
  Accelerated: 'accelerated',
} as const;

export type PathReason = (typeof PathReason)[keyof typeof PathReason];

/** The path one node runs, and why: an accelerator, or `undefined` for its canonical kernel. */
export type NodePath =
  | {
      readonly node: NodeId;
      readonly accelerator: undefined;
      readonly reason: Exclude<PathReason, typeof PathReason.Accelerated>;
    }
  | {
      readonly node: NodeId;
      readonly accelerator: Accelerator;
      readonly reason: typeof PathReason.Accelerated;
    };

/** The path of every step of `plan`, in the plan's order, for `purpose`. */
export function selectNodePaths(
  plan: ExecutionPlan,
  implementations: NodeImplementations,
  available: AvailableAccelerators,
  purpose: ProcessingPurpose,
): readonly NodePath[] {
  return plan.steps.map(({ node, type }): NodePath => {
    const declared = implementations.get(type)?.accelerators ?? [];
    if (declared.length === 0) {
      return { node, accelerator: undefined, reason: PathReason.NoneDeclared };
    }
    if (purpose === ProcessingPurpose.FinalRender) {
      return { node, accelerator: undefined, reason: PathReason.CanonicalOutput };
    }
    const offered = declared.find((one) => available[one]);
    if (offered === undefined) {
      return { node, accelerator: undefined, reason: PathReason.Unavailable };
    }
    return { node, accelerator: offered, reason: PathReason.Accelerated };
  });
}
