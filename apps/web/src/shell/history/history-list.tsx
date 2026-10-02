/**
 * The points of the open project's history as one list, a single stop of the
 * Tab order: the arrow keys move between points, Home and End go to the first
 * and the last, and Enter goes to the point chosen (REQ-STOR-196, REQ-UX-005).
 *
 * The list is the history package's rows, in its order, so a branch sits beside
 * the point it left, a step further in; the point the project is at is marked,
 * and so is every snapshot, with its notes, branch name and export of a point,
 * and what each change affected. The choice of a point is the panel's own view
 * state; going to one is a command.
 *
 * A history can hold tens of thousands of points, so the list draws only the
 * rows in sight and the chosen one (`useRowWindow`), each row drawn again only
 * when what it shows changes, and brings the chosen point into view only when
 * the choice moves. Each row says where it stands in the whole list, so a
 * screen reader counts the rows not drawn.
 */

import {
  memo,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { WINDOW_ROW, useRowWindow } from '@audiogubbins/design-system';
import type { HistoryRow } from '@audiogubbins/history';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import { quoted } from '../../wording.js';
import { affectedPhrase, type EntityNames } from './entity-names.js';
import { describeExport, describeNode, when } from './history-words.js';

/** What the list reads and does. */
export interface HistoryListProps {
  readonly rows: readonly HistoryRow[];

  /** The names of the entities a change affected, in the state the project is in. */
  readonly names: EntityNames;

  /** The point chosen, where one is. */
  readonly chosen: HistoryNodeId | undefined;
  readonly onChoose: (node: HistoryNodeId) => void;

  /** Goes to a point, as Enter asks. */
  readonly onGo: (node: HistoryNodeId) => void;
}

/** The deepest a branch is drawn further in; deeper ones are drawn at it. */
const DEEPEST_DRAWN = 6;

/** The height of a row, in pixels, until one is drawn to measure. */
const ROW_ESTIMATE = 56;

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

/** What a row says under its description: what the change affected, and snapshot notes. */
function detailOf(row: HistoryRow, names: EntityNames): string {
  const notes = row.snapshots.flatMap((snapshot) =>
    snapshot.notes === undefined ? [] : [snapshot.notes],
  );
  const affected = affectedPhrase(row.node, names);
  return [...(affected === undefined ? [] : [affected]), ...notes].join(' · ');
}

/** What one row draws. */
interface RowProps {
  readonly row: HistoryRow;
  readonly detail: string;
  readonly id: string;
  readonly position: number;
  readonly total: number;
  readonly before: number;
  readonly chosen: boolean;
  readonly onChoose: (node: HistoryNodeId) => void;
}

/** One point of the history. */
function RowView({
  row,
  detail,
  id,
  position,
  total,
  before,
  chosen,
  onChoose,
}: RowProps): ReactNode {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the list takes the keys for every option, as a listbox does, and a click chooses one
    <li
      id={id}
      role="option"
      aria-selected={chosen}
      aria-posinset={position}
      aria-setsize={total}
      className="ag-history-row"
      style={before > 0 ? { marginBlockStart: `${String(before)}px` } : undefined}
      data-ag-depth={Math.min(row.depth, DEEPEST_DRAWN)}
      data-ag-current={row.isCurrent ? '' : undefined}
      {...{ [WINDOW_ROW]: '' }}
      onClick={() => {
        onChoose(row.node.id);
      }}
    >
      <span className="ag-history-row-line">
        <span className="ag-history-row-description">{describeNode(row.node)}</span>
        <span className="ag-history-row-time">{when(row.node.at)}</span>
        {marksOf(row).map((mark) => (
          <span key={mark} className="ag-history-row-mark">
            {mark}
          </span>
        ))}
      </span>
      {detail !== '' && <span className="ag-history-row-detail">{detail}</span>}
    </li>
  );
}

/** Whether two rows show the same: rows are made afresh, so their parts are compared. */
function sameRow(one: RowProps, other: RowProps): boolean {
  const a = one.row;
  const b = other.row;
  return (
    one.detail === other.detail &&
    one.id === other.id &&
    one.position === other.position &&
    one.total === other.total &&
    one.before === other.before &&
    one.chosen === other.chosen &&
    one.onChoose === other.onChoose &&
    a.node === b.node &&
    a.depth === b.depth &&
    a.isCurrent === b.isCurrent &&
    a.forkPoint === b.forkPoint &&
    a.branchName === b.branchName &&
    sameItems(a.snapshots, b.snapshots) &&
    sameItems(a.exports, b.exports)
  );
}

function sameItems(one: readonly unknown[], other: readonly unknown[]): boolean {
  return one.length === other.length && one.every((item, index) => item === other[index]);
}

const Row = memo(RowView, sameRow);

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

/** What the keys do: move the choice, or go to the point chosen. */
function keysOf(
  { rows, chosen, onChoose, onGo }: HistoryListProps,
  index: number,
): (event: KeyboardEvent<HTMLUListElement>) => void {
  return (event) => {
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
}

/** Brings the chosen row into view as the choice moves, and only then. */
function useChosenInView(
  list: RefObject<HTMLUListElement | null>,
  chosen: string | undefined,
  id: string,
): void {
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (chosen === undefined || chosen === shown.current) return;
    shown.current = chosen;
    list.current?.ownerDocument.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  });
}

/** The list (see the module comment). */
export function HistoryList(props: HistoryListProps): ReactNode {
  const { rows, names, chosen, onChoose } = props;
  const base = useId();
  const list = useRef<HTMLUListElement>(null);
  const index = rows.findIndex((row) => row.node.id === chosen);
  const idOf = (at: number): string => `${base}-${String(at)}`;
  const shown = useRowWindow(list, rows.length, {
    estimate: ROW_ESTIMATE,
    ...(index >= 0 ? { keep: index } : {}),
  });
  useChosenInView(list, index >= 0 ? chosen : undefined, idOf(index));

  return (
    <ul
      ref={list}
      role="listbox"
      aria-label="Points in the history"
      tabIndex={0}
      className="ag-history-list"
      style={shown.after > 0 ? { paddingBlockEnd: `${String(shown.after)}px` } : undefined}
      {...(index >= 0 ? { 'aria-activedescendant': idOf(index) } : {})}
      onKeyDown={keysOf(props, index)}
    >
      {shown.rows.map(({ index: at, before }) => {
        const row = rows[at];
        return row === undefined ? null : (
          <Row
            key={row.node.id}
            row={row}
            detail={detailOf(row, names)}
            id={idOf(at)}
            position={at + 1}
            total={rows.length}
            before={before}
            chosen={at === index}
            onChoose={onChoose}
          />
        );
      })}
    </ul>
  );
}
