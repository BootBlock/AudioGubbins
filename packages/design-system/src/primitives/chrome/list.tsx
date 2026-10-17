/**
 * A list and its rows (design language, section 10, "Lists").
 *
 * A row is one line, or two where it has a second line, at the control's height
 * or the two-line row's. A chosen row is drawn with the lit edge, the
 * language's one indicator for a chosen row (`styles/lit-edge.css`, which every
 * lit row shares), and says it is the current one to a screen reader as well,
 * so the choice is never told by light alone. At the compact density a row's
 * second line moves up beside its name.
 */

import type { ReactNode } from 'react';

/** What a list takes. */
export interface ListProps {
  /** The list's accessible name, where nothing beside it names it. */
  readonly label?: string;

  /** Its rows, each a `ListRow`. */
  readonly children: ReactNode;
}

/** A list of rows. */
export function List({ label, children }: ListProps): ReactNode {
  return (
    <ul className="ag-list" aria-label={label}>
      {children}
    </ul>
  );
}

/** What a list row takes. */
export interface ListRowProps {
  /** What the row is, at 550. It wraps rather than being cut short. */
  readonly name: string;

  /** A second line at label size, in tabular figures. */
  readonly detail?: ReactNode;

  /** A glyph or a thumbnail before the name. */
  readonly leading?: ReactNode;

  /** Buttons at the row's trailing end. */
  readonly actions?: ReactNode;

  /** Whether it is the chosen row, drawn with the lit edge. */
  readonly chosen?: boolean;

  /**
   * Whether the thing it stands for was refused, as an import that failed:
   * its glyph and second line take the error colour, and it keeps its place.
   */
  readonly refused?: boolean;

  /** Whether it sits under the row before it, indented one step. */
  readonly nested?: boolean;
}

/** A row of a list. */
export function ListRow({
  name,
  detail,
  leading,
  actions,
  chosen = false,
  refused = false,
  nested = false,
}: ListRowProps): ReactNode {
  return (
    <li
      className="ag-list-row ag-lit-row"
      data-ag-lines={detail === undefined ? 'one' : 'two'}
      data-ag-lit={chosen ? '' : undefined}
      data-ag-refused={refused ? '' : undefined}
      data-ag-nested={nested ? '' : undefined}
      aria-current={chosen ? 'true' : undefined}
    >
      {leading !== undefined && <span className="ag-list-row-leading">{leading}</span>}
      <span className="ag-list-row-text">
        <span className="ag-list-row-name">{name}</span>
        {detail !== undefined && <span className="ag-list-row-detail">{detail}</span>}
      </span>
      {actions !== undefined && <span className="ag-list-row-actions">{actions}</span>}
    </li>
  );
}
