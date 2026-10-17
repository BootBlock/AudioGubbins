/**
 * A key cap: one key of a shortcut, in the numeric family on a quiet fill
 * (design language, section 10).
 */

import type { ReactNode } from 'react';

/** What a key cap takes. */
export interface KeyCapProps {
  /** The key's name as the reader's keyboard shows it, such as "Ctrl". */
  readonly children: ReactNode;
}

/** One key of a shortcut. */
export function KeyCap({ children }: KeyCapProps): ReactNode {
  return <kbd className="ag-key-cap">{children}</kbd>;
}
