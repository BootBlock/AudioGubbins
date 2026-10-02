/**
 * The lines through a history: a node's ancestry, the subtree under a node and
 * the active line the project is on (REQ-STOR-193).
 *
 * The active line runs from the root through the cursor and on along each
 * node's continuation, the child redo would follow. Every other subtree hanging
 * from it is an alternative branch, kept until compaction removes it. Each walk
 * here is a loop over an explicit stack, never recursion, so a history of any
 * depth is walked without exhausting the stack.
 */

import type { HistoryNodeId } from '@audiogubbins/project-format';

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
