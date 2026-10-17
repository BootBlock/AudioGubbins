import type { ReactNode } from 'react';

/** One component in one state, as the inventory draws it. */
export interface Specimen {
  /** The component's name, as exported from the design system, e.g. "Knob". */
  readonly component: string;
  /** The state shown: default, hover, focus-visible, active, pressed, disabled, error, loading, or a named variant such as "on" or "clipping". */
  readonly state: string;
  /** Draws it. Hover, focus-visible, active and pressed are forced through the data-ag-force-state attribute on the specimen's wrapper (the harness sets it; style the state with :is(:hover, [data-ag-force-state='hover'] *) or by passing a prop), never by a real pointer. */
  readonly render: () => ReactNode;
}
