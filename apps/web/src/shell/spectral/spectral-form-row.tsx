/**
 * A row of the Spectral panel's forms: a short word in the form's label
 * column and the controls beside it, as the language's panel form lays them
 * out. A typed value in the row keeps its own full label as its accessible
 * name, hidden from sight, so the short word is drawn only for the eye.
 */

import type { ReactNode } from 'react';

/** A form row, its controls under `label`, or under an empty label cell where it has none. */
export function SpectralFormRow({
  label,
  children,
}: {
  readonly label?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="ag-spectral-form-row">
      <span className="ag-spectral-form-label" aria-hidden="true">
        {label}
      </span>
      <div className="ag-spectral-form-controls">{children}</div>
    </div>
  );
}
