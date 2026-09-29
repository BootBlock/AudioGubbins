/**
 * The rows of the History panel: the tree flattened in a stable order, each row
 * saying where it sits, whether it is current or on the active line, its
 * branch's name, its snapshots and the exports made from it, filtered by a
 * search and a scope (REQ-STOR-196).
 *
 * The panel draws these and calls this package to act on them, so no branching
 * rule lives in a component (REQ-STOR-193). Rows run oldest first. At each node
 * the alternative branches leaving it come first, oldest first and one level
 * deeper, and the line then continues at the same depth, so a branch sits
 * beside the point it left and a long linear history is not indented at all.
 * Exports are shown on the node they were made from, as provenance and never as
 * a change (REQ-STOR-198).
 */

import type {
  ExportRecord,
  HistoryLabel,
  HistoryNodeId,
  NamedSnapshot,
} from '@audiogubbins/project-format';

import type { History, HistoryNode } from './history.js';
import { activeLine, continuationOf } from './lines.js';
import { snapshotsByNode } from './snapshots.js';

/** The kinds of entity a change can affect, as the panel names them. */
export type EntityKind = 'asset' | 'track' | 'bus' | 'clip' | 'region' | 'marker' | 'effect-chain';

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

interface Pending {
  readonly id: HistoryNodeId;
  readonly depth: number;
  readonly forkPoint?: HistoryNodeId;
}

const AFFECTED_LISTS = [
  ['asset', 'assets'],
  ['track', 'tracks'],
  ['bus', 'buses'],
  ['clip', 'clips'],
  ['region', 'regions'],
  ['marker', 'markers'],
  ['effect-chain', 'effectChains'],
] as const;

/** Text as it is searched: compatibility-composed and in lower case. */
function folded(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** The rows of the History panel that `query` asks for. */
export function historyRows(
  history: History,
  query: RowQuery = {},
  context: RowContext = {},
): readonly HistoryRow[] {
  const line = activeLine(history);
  const nextOnLine = new Map(line.map((node, index) => [node.id, line[index + 1]?.id]));
  const snapshots = snapshotsByNode(history);
  const exports = exportsByNode(context.exports ?? []);
  const matches = rowMatcher(query, context);

  const rows: HistoryRow[] = [];
  const pending: Pending[] = [{ id: history.root, depth: 0 }];
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
      if (child === undefined || child === continuation) continue;
      pending.push({ id: child, depth: next.depth + 1, forkPoint: node.id });
    }

    const branchName = history.branchNames.get(node.id);
    const row: HistoryRow = {
      node,
      depth: next.depth,
      isCurrent: node.id === history.cursor,
      isOnActiveLine: nextOnLine.has(node.id),
      ...(next.forkPoint === undefined ? {} : { forkPoint: next.forkPoint }),
      ...(branchName === undefined ? {} : { branchName }),
      snapshots: snapshots.get(node.id) ?? [],
      exports: exports.get(node.id) ?? [],
      childCount: children.length,
    };
    if (matches(row)) rows.push(row);
  }
  return rows;
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
  if (node.kind !== 'change' || nameOf === undefined) return;
  for (const [kind, list] of AFFECTED_LISTS) {
    for (const id of node.affects[list]) {
      const name = nameOf({ kind, id });
      if (name !== undefined) yield name;
    }
  }
}
