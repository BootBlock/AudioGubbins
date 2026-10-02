/**
 * Applying a planned compaction to a history (REQ-STOR-055, REQ-STOR-200).
 *
 * The plan is checked against the history it is applied to, because the history
 * may have moved on since it was planned: a plan that would remove the current
 * node or a snapshot's node, or leave a node without its parent, is refused as
 * stale rather than applied in part. The new root keeps its change for the
 * History panel, but loses its parent, so undo stops there.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import type { CompactionPlan } from './compaction-plan.js';
import { parentOf, type History, type HistoryNode } from './history.js';
import { persistentMapOf } from './persistent-map.js';

function stale(summary: string): DomainResult<never> {
  return fail(failure('compaction.stale-plan', FailureKind.Conflict, summary));
}

/** The node as the root of a history: without a parent. */
function asRoot(node: HistoryNode): HistoryNode {
  if (node.kind === 'origin' || node.parent === undefined) return node;
  const { kind, id, at, description, forward, inverse, affects, stateFingerprint } = node;
  return {
    kind,
    id,
    at,
    description,
    forward,
    inverse,
    affects,
    ...(stateFingerprint === undefined ? {} : { stateFingerprint }),
  };
}

/** The history with the plan's nodes removed and its root moved, where it moves. */
export function applyCompaction(history: History, plan: CompactionPlan): DomainResult<History> {
  if (plan.project !== history.project) return stale('The plan is for another project.');
  const removed = new Set<HistoryNodeId>(plan.removable);
  for (const id of removed) {
    if (!history.nodes.has(id)) {
      return stale('The plan removes a node the history no longer holds.');
    }
  }
  const root = plan.newRoot ?? history.root;
  if (!history.nodes.has(root) || removed.has(root)) {
    return stale('The plan keeps no root the history holds.');
  }
  if (removed.has(history.cursor)) return stale('The plan removes the current state.');
  for (const snapshot of history.snapshots.values()) {
    if (removed.has(snapshot.node)) return stale("The plan removes a snapshot's state.");
  }

  const kept: [HistoryNodeId, HistoryNode][] = [];
  for (const node of history.nodes.values()) {
    if (removed.has(node.id)) continue;
    const parent = parentOf(node);
    if (node.id !== root && (parent === undefined || removed.has(parent))) {
      return stale('The plan would leave a node without its parent.');
    }
    kept.push([node.id, node.id === root ? asRoot(node) : node]);
  }

  const children: [HistoryNodeId, readonly HistoryNodeId[]][] = [];
  for (const [id] of kept) {
    const held = (history.children.get(id) ?? []).filter((child) => !removed.has(child));
    if (held.length > 0) children.push([id, held]);
  }
  const preferred = [...history.preferred.entries()].filter(
    ([node, child]) => !removed.has(node) && !removed.has(child),
  );
  const branchNames = new Map([...history.branchNames].filter(([node]) => !removed.has(node)));
  return succeed({
    ...history,
    root,
    nodes: persistentMapOf(kept),
    children: persistentMapOf(children),
    preferred: persistentMapOf(preferred),
    branchNames,
  });
}
