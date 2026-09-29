/**
 * Planning a compaction of a history, and saying what recovery it would cost
 * before anything is removed (REQ-STOR-055, REQ-STOR-200).
 *
 * A plan is asked for by a retention policy, or by the person removing chosen
 * branches or everything before a point. It never removes the cursor or its
 * redo line, a snapshot's node or a node the caller protects, and it keeps the
 * history one tree. Alongside the nodes it would remove it lists each
 * capability lost, as records the interface words: undoing past the new root, a
 * branch, or the state an export was made from.
 *
 * Under a storage budget the least valuable history goes first: alternative
 * branches, least recently used first, and then the oldest changes of the line
 * the project is on, by moving the root down. A plan that moves the root names
 * the new root, whose state the storage layer must keep whole, because no
 * earlier state remains to reach it from.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  compareCodeUnits,
  type ExportRecord,
  type ExportRecordId,
  type HistoryLabel,
  type HistoryNodeId,
  type RetentionPolicy,
  type RetentionRule,
} from '@audiogubbins/project-format';

import { parentOf, unknownNode, type History, type HistoryNode } from './history.js';
import { ancestry, subtree } from './lines.js';
import {
  pinnedNodes,
  shapeOf,
  unitOf,
  type RemovableUnit,
  type TreeShape,
} from './compaction-shape.js';

const DAY_MILLISECONDS = 86_400_000;

/** What a compaction is asked to remove. */
export type CompactionRequest =
  | {
      /** What a retention policy lets go. */
      readonly kind: 'policy';
      readonly policy: RetentionPolicy;
    }
  | {
      /** The branches starting at these nodes, each whole. */
      readonly kind: 'branches';
      readonly firsts: readonly HistoryNodeId[];
    }
  | {
      /** Everything before this node, which becomes the root. */
      readonly kind: 'before';
      readonly node: HistoryNodeId;
    };

/** What the storage layer knows beside the history. */
export interface CompactionContext {
  /** The bytes a node alone holds in storage: its record and any state kept for it alone. */
  readonly sizeOf: (node: HistoryNode) => number;

  /** Now, in milliseconds since the epoch, from the injected clock. */
  readonly now: number;

  /** Nodes to keep beside those every compaction keeps. */
  readonly protectedNodes?: Iterable<HistoryNodeId>;

  /** The project's export log, to say which exports' states would be lost. */
  readonly exports?: readonly ExportRecord[];
}

/** A recovery capability a compaction would take away. */
export type LostCapability =
  | {
      /** Undoing past `root`, which `changes` earlier nodes allowed. */
      readonly kind: 'undo-before';
      readonly root: HistoryNodeId;
      readonly at: number;
      readonly changes: number;
    }
  | {
      /** A branch of `changes` nodes and every state along it. */
      readonly kind: 'branch';
      readonly first: HistoryNodeId;
      readonly forkPoint: HistoryNodeId;
      readonly name?: HistoryLabel;
      readonly changes: number;
      readonly latestAt: number;
    }
  | {
      /** Going back to the state an export was made from. */
      readonly kind: 'export-state';
      readonly export: ExportRecordId;
      readonly node: HistoryNodeId;
    };

/** A compaction, planned and not yet applied. */
export interface CompactionPlan {
  readonly project: ProjectId;

  /** The nodes to remove, sorted by identifier. */
  readonly removable: readonly HistoryNodeId[];

  /** The node that becomes the root, where the root moves. */
  readonly newRoot?: HistoryNodeId;
  readonly reclaimableBytes: number;
  readonly remainingBytes: number;

  /** False where a budget cannot be met without removing what must be kept. */
  readonly withinBudget: boolean;
  readonly lost: readonly LostCapability[];
}

/** A plan for a compaction, or why it cannot be made. */
export function planCompaction(
  history: History,
  request: CompactionRequest,
  context: CompactionContext,
): DomainResult<CompactionPlan> {
  const pinned = pinnedNodes(history, context.protectedNodes ?? []);
  switch (request.kind) {
    case 'policy':
      return succeed(policyPlan(history, request.policy, pinned, context));
    case 'branches':
      return branchesPlan(history, request.firsts, shapeOf(history, pinned), context);
    case 'before':
      return beforePlan(history, request.node, shapeOf(history, pinned), context);
  }
}

function policyPlan(
  history: History,
  policy: RetentionPolicy,
  pinned: Set<HistoryNodeId>,
  context: CompactionContext,
): CompactionPlan {
  switch (policy.kind) {
    case 'unlimited':
      return planOf(history, new Set(), undefined, context, undefined);
    case 'rules': {
      for (const rule of policy.rules) keepByRule(history, rule, pinned, context.now);
      const shape = shapeOf(history, pinned);
      const removed = new Set(shape.chain);
      for (const unit of shape.units) for (const id of unit.nodes) removed.add(id);
      const newRoot = shape.chain.length > 0 ? shape.lowest : undefined;
      return planOf(history, removed, newRoot, context, undefined);
    }
    case 'budget':
      return budgetPlan(history, policy.bytes, shapeOf(history, pinned), context);
  }
}

/** Adds to `pinned` every node a rule keeps. */
function keepByRule(
  history: History,
  rule: RetentionRule,
  pinned: Set<HistoryNodeId>,
  now: number,
): void {
  if (rule.kind === 'recent-changes') {
    // Undoing `count` changes needs the state before the oldest of them too.
    let left = rule.count + 1;
    for (const node of ancestry(history, history.cursor)) {
      if (left === 0) break;
      pinned.add(node.id);
      left -= 1;
    }
    return;
  }
  const since = now - rule.days * DAY_MILLISECONDS;
  for (const node of history.nodes.values()) if (node.at >= since) pinned.add(node.id);
}

function budgetPlan(
  history: History,
  budget: number,
  shape: TreeShape,
  context: CompactionContext,
): CompactionPlan {
  let remaining = 0;
  for (const node of history.nodes.values()) remaining += context.sizeOf(node);
  const removed = new Set<HistoryNodeId>();
  const remove = (id: HistoryNodeId): void => {
    const node = history.nodes.get(id);
    if (node === undefined || removed.has(id)) return;
    removed.add(id);
    remaining -= context.sizeOf(node);
  };

  const units = [...shape.units].sort(
    (left, right) => left.latestAt - right.latestAt || compareCodeUnits(left.first, right.first),
  );
  for (const unit of units) {
    if (remaining <= budget) break;
    for (const id of unit.nodes) remove(id);
  }

  const hanging = new Map<HistoryNodeId, RemovableUnit[]>();
  for (const unit of shape.units) {
    const held = hanging.get(unit.forkPoint);
    if (held === undefined) hanging.set(unit.forkPoint, [unit]);
    else held.push(unit);
  }
  let newRoot: HistoryNodeId | undefined;
  for (const [index, id] of shape.chain.entries()) {
    if (remaining <= budget) break;
    remove(id);
    for (const unit of hanging.get(id) ?? []) for (const member of unit.nodes) remove(member);
    newRoot = shape.chain[index + 1] ?? shape.lowest;
  }
  return planOf(history, removed, newRoot, context, budget);
}

/** The refusal of a node compaction must keep, or that is not where the request supposes. */
function notRemovable(code: string, summary: string, node: HistoryNodeId): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary, { details: { node } }));
}

function branchesPlan(
  history: History,
  firsts: readonly HistoryNodeId[],
  shape: TreeShape,
  context: CompactionContext,
): DomainResult<CompactionPlan> {
  const removed = new Set<HistoryNodeId>();
  for (const first of firsts) {
    if (!history.nodes.has(first)) return fail(unknownNode(first));
    if (shape.kept.has(first) || shape.chain.includes(first)) {
      return notRemovable(
        'compaction.branch-kept',
        'The branch holds the current state, a snapshot or a protected point, so it is kept.',
        first,
      );
    }
    for (const node of subtree(history, first)) removed.add(node.id);
  }
  return succeed(planOf(history, removed, undefined, context, undefined));
}

function beforePlan(
  history: History,
  node: HistoryNodeId,
  shape: TreeShape,
  context: CompactionContext,
): DomainResult<CompactionPlan> {
  if (!history.nodes.has(node)) return fail(unknownNode(node));
  const index = shape.chain.indexOf(node);
  if (node !== shape.lowest && index === -1) {
    return notRemovable(
      'compaction.history-needed',
      'History before this point holds the current state, a snapshot or a protected point.',
      node,
    );
  }
  if (node === history.root)
    return succeed(planOf(history, new Set(), undefined, context, undefined));

  const keptFrom = new Set<HistoryNodeId>();
  for (const member of subtree(history, node)) keptFrom.add(member.id);
  const removed = new Set<HistoryNodeId>();
  for (const id of history.nodes.keys()) if (!keptFrom.has(id)) removed.add(id);
  return succeed(planOf(history, removed, node, context, undefined));
}

/** The plan removing `removed`, with what it reclaims and what it costs. */
function planOf(
  history: History,
  removed: ReadonlySet<HistoryNodeId>,
  newRoot: HistoryNodeId | undefined,
  context: CompactionContext,
  budget: number | undefined,
): CompactionPlan {
  let reclaimable = 0;
  let total = 0;
  for (const node of history.nodes.values()) {
    const size = context.sizeOf(node);
    total += size;
    if (removed.has(node.id)) reclaimable += size;
  }
  return {
    project: history.project,
    removable: [...removed].sort(compareCodeUnits),
    ...(newRoot === undefined ? {} : { newRoot }),
    reclaimableBytes: reclaimable,
    remainingBytes: total - reclaimable,
    withinBudget: budget === undefined || total - reclaimable <= budget,
    lost: lostCapabilities(history, removed, newRoot, context.exports ?? []),
  };
}

type BranchLoss = Extract<LostCapability, { readonly kind: 'branch' }>;

function lostCapabilities(
  history: History,
  removed: ReadonlySet<HistoryNodeId>,
  newRoot: HistoryNodeId | undefined,
  exports: readonly ExportRecord[],
): readonly LostCapability[] {
  const lost: LostCapability[] = [];
  const above = new Set<HistoryNodeId>();
  if (newRoot !== undefined) {
    for (const node of ancestry(history, newRoot)) if (node.id !== newRoot) above.add(node.id);
    const root = history.nodes.get(newRoot);
    lost.push({ kind: 'undo-before', root: newRoot, at: root?.at ?? 0, changes: above.size });
  }

  // A branch lost is a removed subtree whose top hangs from a node kept, or
  // from a node removed with the chain above the new root.
  const branches: BranchLoss[] = [];
  for (const id of removed) {
    const node = history.nodes.get(id);
    const forkPoint = node === undefined ? undefined : parentOf(node);
    if (above.has(id) || forkPoint === undefined) continue;
    if (removed.has(forkPoint) && !above.has(forkPoint)) continue;
    branches.push(branchLoss(history, unitOf(history, forkPoint, id)));
  }
  branches.sort(
    (left, right) => left.latestAt - right.latestAt || compareCodeUnits(left.first, right.first),
  );
  lost.push(...branches);

  // An export record names its node as text; the removed nodes are found by it.
  const removedByText = new Map<string, HistoryNodeId>();
  for (const id of removed) removedByText.set(id, id);
  const exported = [...exports].sort((left, right) => compareCodeUnits(left.id, right.id));
  for (const record of exported) {
    const node =
      record.historyNodeId === undefined ? undefined : removedByText.get(record.historyNodeId);
    if (node !== undefined) lost.push({ kind: 'export-state', export: record.id, node });
  }
  return lost;
}

function branchLoss(history: History, unit: RemovableUnit): BranchLoss {
  const name = history.branchNames.get(unit.first);
  return {
    kind: 'branch',
    first: unit.first,
    forkPoint: unit.forkPoint,
    ...(name === undefined ? {} : { name }),
    changes: unit.nodes.length,
    latestAt: unit.latestAt,
  };
}
