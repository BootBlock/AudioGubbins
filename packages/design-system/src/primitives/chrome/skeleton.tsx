/**
 * A skeleton: the shape of content that is on its way, drawn as quiet lines
 * that shimmer (design language, section 9, "Loading").
 *
 * The lines are decoration; the words say what is loading, to a screen reader,
 * and the container says it is busy.
 */

import type { CSSProperties, ReactNode } from 'react';

/** What a skeleton takes. */
export interface SkeletonProps {
  /** What is on its way, such as "Loading the history". */
  readonly label: string;

  /**
   * The content's shape: one line for each entry, its width a share of the
   * whole from 0 to 1.
   */
  readonly lines: readonly number[];
}

/** One line's width, read by the stylesheet. */
interface LineStyle extends CSSProperties {
  readonly '--ag-skeleton-width': string;
}

/** A skeleton. */
export function Skeleton({ label, lines }: SkeletonProps): ReactNode {
  return (
    <div className="ag-skeleton" aria-busy="true">
      <span className="ag-visually-hidden">{label}</span>
      {lines.map((width, index) => {
        const style: LineStyle = {
          '--ag-skeleton-width': String(Math.min(1, Math.max(0, width))),
        };
        // A line has no identity but its place: the shape is drawn whole and
        // never reordered, so its index is its key.
        return <span key={index} className="ag-skeleton-line" aria-hidden="true" style={style} />;
      })}
    </div>
  );
}
