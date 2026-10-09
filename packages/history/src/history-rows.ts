/**
 * The rows of the History panel: the tree in the order `history-row-order.ts`
 * lists it, each row saying where it sits, whether it is current or on the
 * active line, its branch's name, its snapshots and the exports made from it,
 * filtered by a search and a scope (REQ-STOR-196).
 *
 * The panel draws these and calls this package to act on them, so no branching
 * rule lives in a component (REQ-STOR-193). A row is made when it is read, so
 * the panel pays for the rows it shows, and a search or a scope for the rows it
 * looks through. Exports are shown on the node they were made from, as
 * provenance and never as a change (REQ-STOR-198).
 */

import type {
  ExportRecord,
  HistoryLabel,
  HistoryNodeId,
  NamedSnapshot,
} from '@audiogubbins/project-format';

import { parentOf, type HistoryNode } from './history.js';
import type { HistoryRowOrder } from './history-row-order.js';
import { snapshotsByNode } from './snapshots.js';

/** The kinds of entity a change can affect, as the panel names them. */
export type EntityKind =
  'asset' | 'track' | 'bus' | 'clip' | 'region' | 'marker' | 'effect-chain' | 'take-stack';

/** One entity of the project. */
export interface EntityReference {
  readonly kind: EntityKind;
  readonly id: string;
}

/** Which rows to show. */
export interface RowQuery {
  /**
   * Words to find, without regard to case, in a change's description, a
   * branch's name, a snapshot's name or notes, or the name of an entity the
   * change affected.
   */
  readonly text?: string;

  /** Every node, the active line alone, or the nodes with a snapshot. */
  readonly scope?: 'all' | 'active-line' | 'snapshots';

  /** Only the changes that affected this entity. */
  readonly affecting?: EntityReference;
}

/** What the panel knows beside the history. */
export interface RowContext {
  /** The name a person knows an entity by, where the current state has it. */
  readonly nameOf?: (entity: EntityReference) => string | undefined;

  /** The project's export log. */
  readonly exports?: readonly ExportRecord[];
}

/** One row of the History panel. */
export interface HistoryRow {
  readonly node: HistoryNode;

  /** How many branches deep the row is: 0 on the line from the root. */
  readonly depth: number;
  readonly isCurrent: boolean;
  readonly isOnActiveLine: boolean;

  /** The node the row's branch leaves from, on the row that starts a branch. */
  readonly forkPoint?: HistoryNodeId;
  readonly branchName?: HistoryLabel;
  readonly snapshots: readonly NamedSnapshot[];
  readonly exports: readonly ExportRecord[];
  readonly childCount: number;
}

/** The rows a query shows, each read as it is wanted. */
export interface HistoryRowModel {
  readonly count: number;

  /** The row at `index`, where there is one. */
  readonly rowAt: (index: number) => HistoryRow | undefined;

  /** The index of the row of `node`, or -1 where the query shows none. */
  readonly indexOf: (node: HistoryNodeId) => number;
}

const AFFECTED_LISTS = [
  ['asset', 'assets'],
  ['track', 'tracks'],
  ['bus', 'buses'],
  ['clip', 'clips'],
  ['region', 'regions'],
  ['marker', 'markers'],
  ['effect-chain', 'effectChains'],
  ['take-stack', 'takeStacks'],
] as const;

/** Text as it is searched: compatibility-composed and in lower case. */
function folded(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** Whether `query` shows fewer rows than every one. */
function narrows(query: RowQuery): boolean {
  const scoped = query.scope !== undefined && query.scope !== 'all';
  const searched = query.text !== undefined && query.text.trim() !== '';
  return scoped || searched || query.affecting !== undefined;
}

/** Reads the row at an index of `order`, as it is wanted. */
function rowReader(
  order: HistoryRowOrder,
  exports: readonly ExportRecord[],
): (index: number) => HistoryRow | undefined {
  const { history } = order;
  const snapshots = snapshotsByNode(history);
  const exported = exportsByNode(exports);
  return (index) => {
    const id = order.nodeAt(index);
    const node = id === undefined ? undefined : history.nodes.get(id);
    if (node === undefined) return undefined;
    const depth = order.depthAt(index);
    const parent = parentOf(node);
    // A row a level deeper than its parent's starts a branch that leaves it.
    const leaves = parent !== undefined && depth > order.depthAt(order.indexOf(parent));
    const branchName = history.branchNames.get(node.id);
    return {
      node,
      depth,
      isCurrent: node.id === history.cursor,
      isOnActiveLine: depth === 0,
      ...(leaves ? { forkPoint: parent } : {}),
      ...(branchName === undefined ? {} : { branchName }),
      snapshots: snapshots.get(node.id) ?? [],
      exports: exported.get(node.id) ?? [],
      childCount: history.children.get(node.id)?.length ?? 0,
    };
  };
}

/**
 * The rows of the History panel that `query` asks for, of `order`: every row,
 * read only as it is wanted, or those a search, a scope or an entity find,
 * found by looking through every row.
 */
export function historyRowModel(
  order: HistoryRowOrder,
  query: RowQuery = {},
  context: RowContext = {},
): HistoryRowModel {
  const rowAt = rowReader(order, context.exports ?? []);
  if (!narrows(query)) return { count: order.count, rowAt, indexOf: order.indexOf };
  const matches = rowMatcher(query, context);
  const shown: number[] = [];
  for (let index = 0; index < order.count; index += 1) {
    const row = rowAt(index);
    if (row !== undefined && matches(row)) shown.push(index);
  }
  return {
    count: shown.length,
    rowAt: (index) => {
      const at = shown[index];
      return at === undefined ? undefined : rowAt(at);
    },
    indexOf: (node) => placeIn(shown, order.indexOf(node)),
  };
}

/** Where `index` is in `sorted`, an ascending list, or -1 where it is not. */
function placeIn(sorted: readonly number[], index: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = sorted[middle] ?? index;
    if (at === index) return middle;
    if (at < index) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

function exportsByNode(
  records: readonly ExportRecord[],
): ReadonlyMap<string, readonly ExportRecord[]> {
  const byNode = new Map<string, ExportRecord[]>();
  for (const record of records) {
    if (record.historyNodeId === undefined) continue;
    const held = byNode.get(record.historyNodeId);
    if (held === undefined) byNode.set(record.historyNodeId, [record]);
    else held.push(record);
  }
  return byNode;
}

/** Whether a row is one the query asks for. */
function rowMatcher(query: RowQuery, context: RowContext): (row: HistoryRow) => boolean {
  const needle = query.text === undefined ? '' : folded(query.text.trim());
  const { affecting } = query;
  return (row) => {
    if (query.scope === 'active-line' && !row.isOnActiveLine) return false;
    if (query.scope === 'snapshots' && row.snapshots.length === 0) return false;
    if (affecting !== undefined && !affects(row.node, affecting)) return false;
    if (needle === '') return true;
    for (const text of searchedText(row, context)) {
      if (folded(text).includes(needle)) return true;
    }
    return false;
  };
}

function affects(node: HistoryNode, entity: EntityReference): boolean {
  if (node.kind !== 'change') return false;
  const found = AFFECTED_LISTS.find(([kind]) => kind === entity.kind);
  if (found === undefined) return false;
  const ids: readonly string[] = node.affects[found[1]];
  return ids.includes(entity.id);
}

/**
 * Every entity a change affected, kind by kind in the order the panel lists
 * kinds; the start of the project affected none.
 */
export function* affectedEntities(node: HistoryNode): Generator<EntityReference> {
  if (node.kind !== 'change') return;
  for (const [kind, list] of AFFECTED_LISTS) {
    for (const id of node.affects[list]) yield { kind, id };
  }
}

/** Every text of a row a search looks in. */
function* searchedText(row: HistoryRow, context: RowContext): Generator<string> {
  const { node } = row;
  if (node.kind === 'change') yield node.description;
  if (row.branchName !== undefined) yield row.branchName;
  for (const snapshot of row.snapshots) {
    yield snapshot.name;
    if (snapshot.notes !== undefined) yield snapshot.notes;
  }
  const { nameOf } = context;
  if (nameOf === undefined) return;
  for (const entity of affectedEntities(node)) {
    const name = nameOf(entity);
    if (name !== undefined) yield name;
  }
}
