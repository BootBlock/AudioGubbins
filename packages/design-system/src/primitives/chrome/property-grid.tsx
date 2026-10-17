/**
 * A property grid: labels down one edge and their values down the other
 * (design language, section 10, "Property grids").
 *
 * A value is never cut short: one that does not fit its column wraps,
 * breaking a long path or token anywhere rather than overflowing the panel.
 */

import type { ReactNode } from 'react';

import { SourceChip, type ValueSource } from './source-chip.js';

/** One property: what it is, its value, and where the value comes from. */
export interface PropertyRow {
  /** Identifies the row among its siblings, for React. */
  readonly id: string;

  readonly label: string;
  readonly value: ReactNode;

  /** Where the value comes from, shown as a chip beside it. */
  readonly source?: {
    readonly kind: ValueSource;
    readonly label: string;
  };
}

/** What a property grid takes. */
export interface PropertyGridProps {
  readonly rows: readonly PropertyRow[];
}

/** A property grid. */
export function PropertyGrid({ rows }: PropertyGridProps): ReactNode {
  return (
    <dl className="ag-property-grid">
      {rows.map((row) => (
        <div key={row.id} className="ag-property-row">
          <dt className="ag-property-label">{row.label}</dt>
          <dd className="ag-property-value">
            <span className="ag-property-value-text">{row.value}</span>
            {row.source !== undefined && (
              <SourceChip source={row.source.kind}>{row.source.label}</SourceChip>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
