/**
 * The points of the open project's history as one list, a single stop of the
 * Tab order: the arrow keys move between points, Home and End go to the first
 * and the last, and Enter goes to the point chosen (REQ-STOR-196, REQ-UX-005).
 *
 * The list is the history package's rows, in its order, so a branch sits beside
 * the point it left, a step further in; the point the project is at is marked,
 * and so is every snapshot, branch name and export of a point. The choice of a
 * point is the panel's own view state; going to one is a command.
 */

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import type { HistoryRow } from '@audiogubbins/history';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import { quoted } from '../../wording.js';
import { describeExport, describeNode, when } from './history-words.js';

/** What the list reads and does. */
export interface HistoryListProps {
  readonly rows: readonly HistoryRow[];

  /** The point chosen, where one is. */
  readonly chosen: HistoryNodeId | undefined;
  readonly onChoose: (node: HistoryNodeId) => void;

  /** Goes to a point, as Enter asks. */
  readonly onGo: (node: HistoryNodeId) => void;
}

/** The deepest a branch is drawn further in; deeper ones are drawn at it. */
const DEEPEST_DRAWN = 6;

/** What is said of a row beside its description. */
function marksOf(row: HistoryRow): readonly string[] {
  return [
    row.isCurrent ? 'Current' : '',
    row.branchName === undefined ? '' : `Branch ${quoted(row.branchName)}`,
    row.depth > 0 && row.forkPoint !== undefined && row.branchName === undefined ? 'Branch' : '',
    ...row.snapshots.map((snapshot) => `Snapshot ${quoted(snapshot.name)}`),
    ...row.exports.map(describeExport),
  ].filter((mark) => mark !== '');
}

/** One point of the history. */
function Row({
  row,
  id,
  chosen,
  onChoose,
}: {
  readonly row: HistoryRow;
  readonly id: string;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}): ReactNode {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the list takes the keys for every option, as a listbox does, and a click chooses one
    <li
      id={id}
      role="option"
      aria-selected={chosen}
      className="ag-history-row"
      data-ag-depth={Math.min(row.depth, DEEPEST_DRAWN)}
      data-ag-current={row.isCurrent ? '' : undefined}
      onClick={onChoose}
    >
      <span className="ag-history-row-description">{describeNode(row.node)}</span>
      <span className="ag-history-row-time">{when(row.node.at)}</span>
      {marksOf(row).map((mark) => (
        <span key={mark} className="ag-history-row-mark">
          {mark}
        </span>
      ))}
    </li>
  );
}

/** Which row a key moves the choice to, or `undefined` where it moves none. */
function rowAfter(key: string, index: number, last: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return Math.min(index + 1, last);
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return undefined;
  }
}

/** The list (see the module comment). */
export function HistoryList({ rows, chosen, onChoose, onGo }: HistoryListProps): ReactNode {
  const base = useId();
  const list = useRef<HTMLUListElement>(null);
  const index = rows.findIndex((row) => row.node.id === chosen);
  const idOf = (at: number): string => `${base}-${String(at)}`;

  // The chosen point kept in view as the keys move it.
  useEffect(() => {
    if (index < 0) return;
    list.current?.ownerDocument.getElementById(idOf(index))?.scrollIntoView({ block: 'nearest' });
  });

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const to = rowAfter(event.key, index, rows.length - 1);
    if (to !== undefined) {
      event.preventDefault();
      const row = rows[to];
      if (row !== undefined) onChoose(row.node.id);
    } else if (event.key === 'Enter' && chosen !== undefined) {
      event.preventDefault();
      onGo(chosen);
    }
  };

  return (
    <ul
      ref={list}
      role="listbox"
      aria-label="Points in the history"
      tabIndex={0}
      className="ag-history-list"
      {...(index >= 0 ? { 'aria-activedescendant': idOf(index) } : {})}
      onKeyDown={onKeyDown}
    >
      {rows.map((row, at) => (
        <Row
          key={row.node.id}
          row={row}
          id={idOf(at)}
          chosen={at === index}
          onChoose={() => {
            onChoose(row.node.id);
          }}
        />
      ))}
    </ul>
  );
}
