/**
 * What compaction may remove from a history, given the nodes it must keep
 * (REQ-STOR-055, REQ-STOR-200).
 *
 * A history stays one tree, so keeping a node keeps the line from it up to the
 * lowest common ancestor of everything kept. The nodes above that ancestor form
 * the chain compaction can cut from the top by moving the root down, and every
 * subtree hanging from the kept part or the chain holds nothing that must be
 * kept and can go whole.
 */

import type { HistoryNodeId } from '@audiogubbins/project-format';

import type { History } from './history.js';
import { activeLine, ancestry, subtree } from './lines.js';

/** A subtree compaction can remove whole. */
export interface RemovableUnit {
  /** Its top node. */
  readonly first: HistoryNodeId;

  /** The node it hangs from. */
  readonly forkPoint: HistoryNodeId;
  readonly nodes: readonly HistoryNodeId[];

  /** When its newest node was made, in milliseconds since the epoch. */
  readonly latestAt: number;
}

/** How a history divides around what it must keep. */
export interface TreeShape {
  /** The lowest common ancestor of every node kept, which can become the root. */
  readonly lowest: HistoryNodeId;

  /** The nodes from the lowest common ancestor down to each node kept. */
  readonly kept: ReadonlySet<HistoryNodeId>;

  /** The nodes above the lowest common ancestor, the root first. */
  readonly chain: readonly HistoryNodeId[];

  /** Every subtree hanging from the chain or the kept nodes. */
  readonly units: readonly RemovableUnit[];
}

/**
 * The nodes no compaction removes: the cursor and the redo line after it, every
 * snapshot's node, and each protected node the history holds.
 */
export function pinnedNodes(
  history: History,
  protectedNodes: Iterable<HistoryNodeId>,
): Set<HistoryNodeId> {
  const pinned = new Set<HistoryNodeId>();
  let reached = false;
  for (const node of activeLine(history)) {
    reached ||= node.id === history.cursor;
    if (reached) pinned.add(node.id);
  }
  for (const snapshot of history.snapshots.values()) pinned.add(snapshot.node);
  for (const node of protectedNodes) if (history.nodes.has(node)) pinned.add(node);
  return pinned;
}

/** How the history divides around `pinned`, which holds at least the cursor. */
export function shapeOf(history: History, pinned: ReadonlySet<HistoryNodeId>): TreeShape {
  const marked = new Set<HistoryNodeId>();
  for (const id of pinned) {
    for (const node of ancestry(history, id)) {
      if (marked.has(node.id)) break;
      marked.add(node.id);
    }
  }

  const chain: HistoryNodeId[] = [];
  let lowest = history.root;
  for (;;) {
    if (pinned.has(lowest)) break;
    const onward = (history.children.get(lowest) ?? []).filter((child) => marked.has(child));
    const [only, ...others] = onward;
    if (only === undefined || others.length > 0) break;
    chain.push(lowest);
    lowest = only;
  }
  const kept = new Set(marked);
  for (const id of chain) kept.delete(id);

  const units: RemovableUnit[] = [];
  for (const forkPoint of [...chain, ...kept]) {
    for (const first of history.children.get(forkPoint) ?? []) {
      if (!marked.has(first)) units.push(unitOf(history, forkPoint, first));
    }
  }
  return { lowest, kept, chain, units };
}

/** The subtree from `first`, which hangs from `forkPoint`. */
export function unitOf(
  history: History,
  forkPoint: HistoryNodeId,
  first: HistoryNodeId,
): RemovableUnit {
  const nodes: HistoryNodeId[] = [];
  let latestAt = 0;
  for (const node of subtree(history, first)) {
    nodes.push(node.id);
    latestAt = Math.max(latestAt, node.at);
  }
  return { first, forkPoint, nodes, latestAt };
}
