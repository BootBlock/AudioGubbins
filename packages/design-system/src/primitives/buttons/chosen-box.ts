/**
 * Where the chosen choice of a group of choices is drawn, so a mark under it
 * can move to the next choice rather than appear there.
 *
 * The design language moves a segmented control's wash to the chosen choice as
 * the choice changes (MotionSpec, state change). A wash drawn by each choice
 * could only fade out of one and into another, so the wash is one element of
 * the group's, placed over the chosen choice from that choice's own box, and
 * the stylesheet moves it at the full motion level and places it at once below.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';

/** The chosen choice's box inside its group, in CSS pixels. */
export interface ChosenBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The box of the element inside `group` that `selector` finds, kept current as
 * the choice changes and as the group or a choice changes size, or `undefined`
 * until it has been measured or while nothing is chosen.
 */
export function useChosenBox(
  group: RefObject<HTMLElement | null>,
  selector: string,
  chosen: string,
): ChosenBox | undefined {
  const [box, setBox] = useState<ChosenBox | undefined>(undefined);

  useLayoutEffect(() => {
    const root = group.current;
    if (root === null) return undefined;

    const measure = (): void => {
      const element = root.querySelector<HTMLElement>(selector);
      setBox((before) => {
        if (element === null) return undefined;
        const next = {
          left: element.offsetLeft,
          top: element.offsetTop,
          width: element.offsetWidth,
          height: element.offsetHeight,
        };
        // The same box is the same state, so an unchanged layout renders
        // nothing again.
        const same =
          before?.left === next.left &&
          before.top === next.top &&
          before.width === next.width &&
          before.height === next.height;
        return same ? before : next;
      });
    };

    measure();
    // A group laid out again, by a font arriving, a density change or its own
    // container resizing, moves its choices without changing which is chosen.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const child of root.children) observer.observe(child);
    return () => {
      observer.disconnect();
    };
  }, [group, selector, chosen]);

  return box;
}
