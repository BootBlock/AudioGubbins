/**
 * A table: a quiet head row over body rows split by hairlines, in a frame of
 * the control's radius (design language, section 10, "Tables").
 *
 * A real table, so a screen reader reads each cell with its column's head.
 * Wider than its panel, it scrolls inside its frame rather than being cut or
 * widening the panel, and every cell wraps rather than being cut short.
 */

import type { ReactNode } from 'react';

/** One column: its head, and how its cells are set. */
export interface TableColumn {
  /** Identifies the column, and names the cell each row gives it. */
  readonly id: string;

  readonly header: string;

  /**
   * How its cells are set. `numeric` aligns them to the end in tabular
   * figures; `verdict` holds a `Verdict`, which wraps at a tighter line height
   * with its glyph at the first line.
   */
  readonly kind?: 'text' | 'numeric' | 'verdict';

  /**
   * Whether each of its cells heads its row, as a check's name heads the
   * verdict and the values beside it: a screen reader then reads every other
   * cell of the row with it, as it reads each cell with its column's head.
   */
  readonly rowHeader?: boolean;
}

/** One row: a cell for each column, by the column's id. */
export interface TableRow {
  /** Identifies the row among its siblings, for React. */
  readonly id: string;

  readonly cells: Readonly<Record<string, ReactNode>>;
}

/** What a table takes. */
export interface TableProps {
  /** The table's accessible name. */
  readonly label: string;

  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
}

/** A table. */
export function Table({ label, columns, rows }: TableProps): ReactNode {
  return (
    <div className="ag-table-frame">
      <table className="ag-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" data-ag-kind={column.kind ?? 'text'}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) =>
                column.rowHeader === true ? (
                  <th key={column.id} scope="row" data-ag-kind={column.kind ?? 'text'}>
                    {row.cells[column.id]}
                  </th>
                ) : (
                  <td key={column.id} data-ag-kind={column.kind ?? 'text'}>
                    {row.cells[column.id]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
