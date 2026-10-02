/**
 * The order of the History panel's rows, apart from what each row says, so a
 * history of any length is listed for the rows the panel shows (REQ-STOR-196).
 *
 * Rows run oldest first. At each node the alternative branches leaving it come
 * first, oldest first and one level deeper, and the line then continues at the
 * same depth, so a branch sits beside the point it left and a long linear
 * history is not indented at all. The line from the root is the active line.
 *
 * Ordering a history visits every node, so an order is carried from one
 * history to the next rather than worked out again. A change recorded at the
 * end of the active line adds its rows at the end; moving along the active
 * line, naming a branch and keeping a snapshot move no row. Anything else that
 * moves rows, a branch begun, another branch gone to or history removed,
 * orders the history afresh. An order that only adds to another shares its
 * lists, each order reading as many rows as it holds.
 */

import type { HistoryNodeId } from '@audiogubbins/project-format';

import { parentOf, type History, type HistoryNode } from './history.js';
import { activeLine, ancestry, continuationOf } from './lines.js';

/** The rows of a history in the panel's order, and what the panel says of it as a whole. */
export interface HistoryRowOrder {
  readonly history: History;
  readonly count: number;

  /** How many changes the history holds, and how many branches leave a point beside its line. */
  readonly changes: number;
  readonly branches: number;

  /** The node of the row at `index`, where there is one. */
  readonly nodeAt: (index: number) => HistoryNodeId | undefined;

  /** How many branches deep the row at `index` is: 0 on the active line. */
  readonly depthAt: (index: number) => number;

  /** The index of the row of `node`, or -1 where it has none. */
  readonly indexOf: (node: HistoryNodeId) => number;
}

/** The nodes listed and their depths, shared by orders where one only adds to another. */
interface Listing {
  readonly nodes: HistoryNodeId[];
  readonly depths: number[];
  readonly places: Map<HistoryNodeId, number>;
}

/** How many changes and branches a run of rows adds. */
interface Tally {
  changes: number;
  branches: number;
}

/** One order (see the module comment). */
class ListedOrder implements HistoryRowOrder {
  readonly history: History;
  readonly count: number;
  readonly changes: number;
  readonly branches: number;
  readonly listing: Listing;

  constructor(history: History, listing: Listing, tally: Tally) {
    this.history = history;
    this.listing = listing;
    this.count = listing.nodes.length;
    this.changes = tally.changes;
    this.branches = tally.branches;
  }

  readonly nodeAt = (index: number): HistoryNodeId | undefined =>
    index < this.count ? this.listing.nodes[index] : undefined;

  readonly depthAt = (index: number): number =>
    index < this.count ? (this.listing.depths[index] ?? 0) : 0;

  readonly indexOf = (node: HistoryNodeId): number => {
    const index = this.listing.places.get(node);
    return index === undefined || index >= this.count ? -1 : index;
  };
}

/** A node to list, and how deep. */
interface Pending {
  readonly id: HistoryNodeId;
  readonly depth: number;
}

/**
 * Lists `start` and every node beneath it, in order, into `listing`, each
 * line continuing as `nextOnLine` says where it names the node and as the
 * history prefers otherwise, and counts what the nodes listed add.
 */
function listFrom(
  history: History,
  start: Pending,
  nextOnLine: ReadonlyMap<HistoryNodeId, HistoryNodeId | undefined>,
  listing: Listing,
  tally: Tally,
): void {
  const pending: Pending[] = [start];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const node = history.nodes.get(next.id);
    if (node === undefined) continue;
    const children = history.children.get(node.id) ?? [];
    const continuation = nextOnLine.has(node.id)
      ? nextOnLine.get(node.id)
      : continuationOf(history, node.id);
    if (continuation !== undefined) pending.push({ id: continuation, depth: next.depth });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined && child !== continuation) {
        pending.push({ id: child, depth: next.depth + 1 });
      }
    }
    listing.places.set(node.id, listing.nodes.length);
    listing.nodes.push(node.id);
    listing.depths.push(next.depth);
    if (node.kind === 'change') tally.changes += 1;
    tally.branches += Math.max(0, children.length - 1);
  }
}

/** The next node on a line of `nodes`, for each node on it. */
function nextOf(
  nodes: readonly HistoryNode[],
): ReadonlyMap<HistoryNodeId, HistoryNodeId | undefined> {
  return new Map(nodes.map((node, index) => [node.id, nodes[index + 1]?.id]));
}

/** The order of `history`, worked out afresh. */
function ordered(history: History): HistoryRowOrder {
  const listing: Listing = { nodes: [], depths: [], places: new Map() };
  const tally: Tally = { changes: 0, branches: 0 };
  listFrom(history, { id: history.root, depth: 0 }, nextOf(activeLine(history)), listing, tally);
  return new ListedOrder(history, listing, tally);
}

/** The order of `history` (see the module comment), carried on from `previous` where it can be. */
export function historyRowOrder(history: History, previous?: HistoryRowOrder): HistoryRowOrder {
  if (previous?.history === history) return previous;
  return (
    (previous instanceof ListedOrder ? carried(previous, history) : undefined) ?? ordered(history)
  );
}

/**
 * The order of `later` from `earlier`'s, where `later` moves none of its rows:
 * the rows of what was added beneath its last row listed after them, or none
 * where nothing was. `undefined` where anything else changed.
 */
function carried(earlier: ListedOrder, later: History): HistoryRowOrder | undefined {
  const before = earlier.history;
  const { listing } = earlier;
  // Another order carried on from this one already added to the lists.
  if (listing.nodes.length !== earlier.count) return undefined;
  if (later.project !== before.project || later.root !== before.root) return undefined;
  const last = earlier.nodeAt(earlier.count - 1);
  const added = addedBeneath(before, later, last);
  if (added === undefined || last === undefined) return undefined;
  const onLine = earlier.indexOf(later.cursor);
  const cursorStays = onLine >= 0 && earlier.depthAt(onLine) === 0;
  if (!cursorStays && !added.has(later.cursor)) return undefined;
  const tally: Tally = { changes: earlier.changes, branches: earlier.branches };
  if (added.size === 0) return new ListedOrder(later, listing, tally);
  const lastIndex = earlier.count - 1;
  // The last row is listed again by the walk beneath it, so it is taken off,
  // and counted off, first.
  if (later.nodes.get(last)?.kind === 'change') tally.changes -= 1;
  listing.nodes.pop();
  listing.depths.pop();
  listing.places.delete(last);
  const start = { id: last, depth: earlier.depthAt(lastIndex) };
  listFrom(later, start, lineBeneath(later, last, added), listing, tally);
  return new ListedOrder(later, listing, tally);
}

/**
 * The nodes `later` adds beneath `last`, the last row of `earlier`'s order,
 * where it changes nothing else that places a row: no node, child or
 * preference gone, and children and preferences changed only for `last` and
 * the nodes added. `undefined` where it changes more.
 */
function addedBeneath(
  earlier: History,
  later: History,
  last: HistoryNodeId | undefined,
): ReadonlySet<HistoryNodeId> | undefined {
  const nodes = later.nodes.changesSince(earlier.nodes);
  const children = later.children.changesSince(earlier.children);
  const preferred = later.preferred.changesSince(earlier.preferred);
  if (nodes.removed.length + children.removed.length + preferred.removed.length > 0) {
    return undefined;
  }
  const added = new Set<HistoryNodeId>();
  for (const [id] of nodes.set) if (!earlier.nodes.has(id)) added.add(id);
  for (const id of added) {
    const node = later.nodes.get(id);
    const parent = node === undefined ? undefined : parentOf(node);
    if (parent === undefined || (parent !== last && !added.has(parent))) return undefined;
  }
  for (const [parent] of [...children.set, ...preferred.set]) {
    if (!added.has(parent) && parent !== last) return undefined;
  }
  return added;
}

/**
 * The active line of `later` beneath `last`, which ends `earlier`'s active
 * line: the way down to the cursor where it was added, and the line continued
 * from there.
 */
function lineBeneath(
  later: History,
  last: HistoryNodeId,
  added: ReadonlySet<HistoryNodeId>,
): ReadonlyMap<HistoryNodeId, HistoryNodeId | undefined> {
  const line: HistoryNode[] = [];
  if (added.has(later.cursor)) {
    for (const node of ancestry(later, later.cursor)) {
      line.push(node);
      if (node.id === last) break;
    }
    line.reverse();
  } else {
    const node = later.nodes.get(last);
    if (node !== undefined) line.push(node);
  }
  const end = line.at(-1)?.id;
  for (
    let next = end === undefined ? undefined : continuationOf(later, end);
    next !== undefined;
    next = continuationOf(later, next)
  ) {
    const node = later.nodes.get(next);
    if (node === undefined) break;
    line.push(node);
  }
  return nextOf(line);
}
