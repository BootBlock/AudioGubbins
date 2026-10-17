/**
 * The panel: one sheet of glass holding a header and a body (design language,
 * sections 6 and 11).
 *
 * The one-inset rule lives here. The panel insets everything it holds by
 * `--ag-space-inset` on every side, so its header's title sits as far from the
 * panel's top as from its side, and its radius is its content's radius plus
 * that inset, so the corners nest.
 */

import type { ReactNode } from 'react';

/** What a panel takes. */
export interface PanelProps {
  /** Its header, a `PanelHeader`, in the panel's inset. */
  readonly header?: ReactNode;

  /** Its body: sections, a property grid, a list, a display, or a state. */
  readonly children: ReactNode;
}

/** A panel: glass, its header and its body, each one inset in. */
export function Panel({ header, children }: PanelProps): ReactNode {
  return (
    <section className="ag-glass-panel">
      {header}
      <div className="ag-panel-body">{children}</div>
    </section>
  );
}
