/**
 * A heading at the level its place in the page gives it.
 *
 * A component that titles part of a surface (an empty state, a section) cannot
 * know how deep in the surface's outline it sits, so its caller gives the
 * level: fixed, a heading would break the outline a screen reader moves
 * through by heading, skipping a level or claiming one it is not.
 */

import type { ReactNode } from 'react';

/**
 * The levels below a surface's own title, which is the one `h1` of the page or
 * an `h2` of a panel.
 */
export type HeadingLevel = 2 | 3 | 4 | 5 | 6;

/** The element of each level. */
const ELEMENT = { 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const;

/** A heading element of `level`. */
export function Heading({
  level,
  className,
  children,
}: {
  readonly level: HeadingLevel;
  readonly className: string;
  readonly children: ReactNode;
}): ReactNode {
  const Element = ELEMENT[level];
  return <Element className={className}>{children}</Element>;
}
