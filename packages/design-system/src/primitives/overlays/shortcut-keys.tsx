/**
 * A shortcut drawn as key caps: one cap for each press of a chord.
 */

import { Fragment, type ReactNode } from 'react';

/**
 * What joins the presses of a chord in a shortcut written for the platform.
 *
 * Every keyboard convention joins presses this way (`describeShortcut` in the
 * commands package), so splitting at it gives the presses whatever the
 * platform. A key whose label is a comma stays whole: its comma is followed by
 * the joining comma, not by the space.
 */
const CHORD_JOIN = ', ';

/** The presses of a shortcut written for the platform, in order. */
function pressesOf(shortcut: string): readonly string[] {
  return shortcut.split(CHORD_JOIN);
}

/** What a shortcut's key caps take. */
export interface ShortcutKeysProps {
  /** The shortcut, already written for the platform (REQ-UX-066). */
  readonly shortcut: string;

  readonly className?: string;
}

/**
 * The key caps of a shortcut.
 *
 * The joining comma is kept between the caps out of sight, so the text a
 * screen reader reads, and that the entry's accessible name is made of, is the
 * shortcut exactly as the platform writes it.
 */
export function ShortcutKeys({ shortcut, className }: ShortcutKeysProps): ReactNode {
  return (
    <span className={className === undefined ? 'ag-keys' : `ag-keys ${className}`}>
      {pressesOf(shortcut).map((press, index) => (
        // A chord can press one key twice, so the place is part of the key.
        <Fragment key={`${String(index)}-${press}`}>
          {index > 0 && <span className="ag-visually-hidden">{CHORD_JOIN}</span>}
          <kbd className="ag-key">{press}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
