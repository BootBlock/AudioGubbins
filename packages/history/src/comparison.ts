/**
 * Whole-project A/B comparison of two states of one project's history
 * (REQ-STOR-195).
 *
 * A comparison is a value: its two sides, each a node and the snapshot it was
 * chosen by, and which side is being listened to. Switching sides makes a new
 * value and touches neither the history nor either state, so auditioning never
 * mutates what is auditioned. Promoting a side is a move of the cursor to its
 * node, which keeps the other state where it was in the tree, so neither is
 * destroyed. Hearing a side is the audio engine's; this module says which state
 * to play.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import type {
  HistoryLabel,
  HistoryNodeId,
  ProjectState,
  SnapshotId,
  StateFingerprint,
} from '@audiogubbins/project-format';

import { unknownNode, type History } from './history.js';
import { moveTo, type Navigation } from './navigation.js';
import { unknownSnapshot } from './snapshots.js';
import { diffStates, type StateDifference } from './state-diff.js';

/** What a side is chosen by: a node of the history, or a snapshot. */
export type ComparisonSource =
  | { readonly kind: 'node'; readonly node: HistoryNodeId }
  | { readonly kind: 'snapshot'; readonly snapshot: SnapshotId };

/** One state being compared. */
export interface ComparisonSide {
  readonly project: ProjectId;
  readonly node: HistoryNodeId;

  /** The snapshot the side was chosen by, and its name, where it was. */
  readonly snapshot?: SnapshotId;
  readonly name?: HistoryLabel;
  readonly stateFingerprint?: StateFingerprint;
}

/** Which of the two sides. */
export type SideName = 'a' | 'b';

/** Two states of one project, and the one being listened to. */
export interface Comparison {
  readonly a: ComparisonSide;
  readonly b: ComparisonSide;
  readonly listening: SideName;
}

/** The side a node or a snapshot of the history gives. */
export function comparisonSide(
  history: History,
  source: ComparisonSource,
): DomainResult<ComparisonSide> {
  if (source.kind === 'node') {
    const node = history.nodes.get(source.node);
    if (node === undefined) return fail(unknownNode(source.node));
    return succeed({
      project: history.project,
      node: node.id,
      ...(node.stateFingerprint === undefined ? {} : { stateFingerprint: node.stateFingerprint }),
    });
  }
  const snapshot = history.snapshots.get(source.snapshot);
  if (snapshot === undefined) return fail(unknownSnapshot(source.snapshot));
  return succeed({
    project: history.project,
    node: snapshot.node,
    snapshot: snapshot.id,
    name: snapshot.name,
    stateFingerprint: snapshot.stateFingerprint,
  });
}

/**
 * A comparison of two sides, listening to `a` first. Refused where the sides
 * are of different projects, which are not comparable, or are the same node.
 */
export function startComparison(a: ComparisonSide, b: ComparisonSide): DomainResult<Comparison> {
  if (a.project !== b.project) {
    return fail(
      failure(
        'comparison.incompatible',
        FailureKind.Rejected,
        'Only two states of the same project can be compared.',
      ),
    );
  }
  if (a.node === b.node) {
    return fail(
      failure(
        'comparison.same-state',
        FailureKind.Rejected,
        'A comparison needs two different points of the history.',
      ),
    );
  }
  return succeed({ a, b, listening: 'a' });
}

/** The comparison listening to `side`, or to the other side where none is named. */
export function switchSide(comparison: Comparison, side?: SideName): Comparison {
  const listening = side ?? (comparison.listening === 'a' ? 'b' : 'a');
  return listening === comparison.listening ? comparison : { ...comparison, listening };
}

/** The side being listened to. */
export function listenedSide(comparison: Comparison): ComparisonSide {
  return comparison[comparison.listening];
}

/**
 * What differs from side `a`'s state to side `b`'s. Refused where a state given
 * is not of the comparison's project.
 */
export function comparedDifference(
  comparison: Comparison,
  stateA: ProjectState,
  stateB: ProjectState,
): DomainResult<StateDifference> {
  if (stateA.project.id !== comparison.a.project || stateB.project.id !== comparison.b.project) {
    return fail(
      failure(
        'comparison.incompatible',
        FailureKind.Rejected,
        "A state given is not of the comparison's project.",
      ),
    );
  }
  return succeed(diffStates(stateA, stateB));
}

/**
 * The move that makes `side` the current state. The other side's node stays in
 * the history, reachable as a branch, so promoting destroys neither.
 */
export function promotion(
  history: History,
  comparison: Comparison,
  side: SideName,
): DomainResult<Navigation> {
  const chosen = comparison[side];
  if (chosen.project !== history.project) {
    return fail(
      failure(
        'comparison.incompatible',
        FailureKind.Rejected,
        "The comparison is not of this history's project.",
      ),
    );
  }
  return moveTo(history, chosen.node);
}
