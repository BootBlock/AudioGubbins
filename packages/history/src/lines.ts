/**
 * The lines through a history: a node's ancestry, the subtree under a node, the
 * active line the project is on, and the alternative branches retained beside
 * it (REQ-STOR-193).
 *
 * The active line runs from the root through the cursor and on along each
 * node's continuation, the child redo would follow. Every other subtree hanging
 * from it is an alternative branch, kept until compaction removes it. Each walk
 * here is a loop over an explicit stack, never recursion, so a history of any
 * depth is walked without exhausting the stack.
 */

import type { HistoryLabel, HistoryNodeId } from '@audiogubbins/project-format';

import { parentOf, type History, type HistoryNode } from './history.js';

/**
 * The child a line continues through from `id`: the child visited most
 * recently, or the newest where none has been visited since the node was read.
 */
export function continuationOf(history: History, id: HistoryNodeId): HistoryNodeId | undefined {
  return history.preferred.get(id) ?? history.children.get(id)?.at(-1);
}

/** The node and each of its ancestors, from the node up to the root. */
export function* ancestry(history: History, id: HistoryNodeId): Generator<HistoryNode> {
  let current = history.nodes.get(id);
  while (current !== undefined) {
    yield current;
    const parent = parentOf(current);
    current = parent === undefined ? undefined : history.nodes.get(parent);
  }
}

/** The node and every node under it, each parent before its children. */
export function* subtree(history: History, id: HistoryNodeId): Generator<HistoryNode> {
  const pending = [id];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const node = history.nodes.get(next);
    if (node === undefined) continue;
    yield node;
    for (const child of history.children.get(next) ?? []) pending.push(child);
  }
}

/**
 * The active line: from the root through the cursor, then on through each
 * continuation to the newest change redo can reach.
 */
export function activeLine(history: History): readonly HistoryNode[] {
  const line = [...ancestry(history, history.cursor)].reverse();
  for (
    let next = continuationOf(history, history.cursor);
    next !== undefined;
    next = continuationOf(history, next)
  ) {
    const node = history.nodes.get(next);
    if (node === undefined) break;
    line.push(node);
  }
  return line;
}

/** A subtree hanging from the active line, retained beside it. */
export interface AlternativeBranch {
  /** The node on the active line the branch leaves from. */
  readonly forkPoint: HistoryNodeId;

  /** The branch's first change. */
  readonly first: HistoryNodeId;
  readonly name?: HistoryLabel;

  /** How many changes the branch holds, its own branches included. */
  readonly changes: number;

  /** When its newest change was made, in milliseconds since the epoch. */
  readonly latestAt: number;
}

/**
 * Every alternative branch, in the order of their fork points along the active
 * line and, at one fork point, oldest first.
 */
export function alternativeBranches(history: History): readonly AlternativeBranch[] {
  const line = activeLine(history);
  const branches: AlternativeBranch[] = [];
  for (const [index, node] of line.entries()) {
    const onLine = line[index + 1]?.id;
    for (const first of history.children.get(node.id) ?? []) {
      if (first === onLine) continue;
      let changes = 0;
      let latestAt = 0;
      for (const member of subtree(history, first)) {
        changes += 1;
        latestAt = Math.max(latestAt, member.at);
      }
      const name = history.branchNames.get(first);
      branches.push({
        forkPoint: node.id,
        first,
        ...(name === undefined ? {} : { name }),
        changes,
        latestAt,
      });
    }
  }
  return branches;
}
