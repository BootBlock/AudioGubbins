/**
 * Where a value comes from: set here, inherited from something above, or not
 * set at all (design language, section 10, "Property grids").
 */

import type { ReactNode } from 'react';

/** Where a value comes from. */
export const ValueSource = {
  /** Set on the thing being inspected: the accent on its fill. */
  Set: 'set',

  /** Taken from something above it: quiet. */
  Inherited: 'inherited',

  /** Not set anywhere: disabled text in a dashed edge. */
  Unset: 'unset',
} as const;

/** Where a value comes from. */
export type ValueSource = (typeof ValueSource)[keyof typeof ValueSource];

/** What a source chip takes. */
export interface SourceChipProps {
  readonly source: ValueSource;

  /** The words, such as "Inherited from Footsteps". */
  readonly children: ReactNode;
}

/** A chip saying where a value comes from. */
export function SourceChip({ source, children }: SourceChipProps): ReactNode {
  return (
    <span className="ag-source-chip" data-ag-source={source}>
      {children}
    </span>
  );
}
