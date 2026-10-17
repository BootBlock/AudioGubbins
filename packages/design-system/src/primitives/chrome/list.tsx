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

import { useId, type ReactNode } from 'react';

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

  /**
   * What pressing the row does, for a row that is itself a button, such as a
   * project to open or a page to go to. The whole row takes the press, by
   * pointer or by keyboard, and its actions stay buttons of their own beside
   * it, never inside it, where a button in a button is neither reachable nor
   * said.
   */
  readonly onPress?: () => void;
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
  onPress,
}: ListRowProps): ReactNode {
  const nameId = useId();
  const detailId = useId();
  const body = (
    <>
      {leading !== undefined && <span className="ag-list-row-leading">{leading}</span>}
      <span className="ag-list-row-text">
        <span className="ag-list-row-name" id={nameId}>
          {name}
        </span>
        {detail !== undefined && (
          <span className="ag-list-row-detail" id={detailId}>
            {detail}
          </span>
        )}
      </span>
    </>
  );
  // Said by what a reader lands on: the row's button where it has one.
  const current = chosen ? 'true' : undefined;
  return (
    <li
      className="ag-list-row ag-lit-row"
      data-ag-lines={detail === undefined ? 'one' : 'two'}
      data-ag-lit={chosen ? '' : undefined}
      data-ag-refused={refused ? '' : undefined}
      data-ag-nested={nested ? '' : undefined}
      data-ag-pressable={onPress === undefined ? undefined : ''}
      aria-current={onPress === undefined ? current : undefined}
    >
      {onPress === undefined ? (
        body
      ) : (
        <button
          type="button"
          className="ag-list-row-press ag-touch-sized"
          // Named by the row's name and described by its second line, so a
          // reader hears what the row is before its details, and the two are
          // not run together into one word.
          aria-labelledby={nameId}
          {...(detail === undefined ? {} : { 'aria-describedby': detailId })}
          aria-current={current}
          onClick={onPress}
        >
          {body}
        </button>
      )}
      {actions !== undefined && <span className="ag-list-row-actions">{actions}</span>}
    </li>
  );
}
