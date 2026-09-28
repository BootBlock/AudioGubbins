/**
 * An element's height, published as a custom property for a rule elsewhere to
 * read.
 *
 * The status bar wraps its notices and grows to a third of the screen, and the
 * notice surface sits clear of it: a fixed offset is wrong at every size but
 * one, and CSS cannot ask an element how tall a different element is, so the
 * bar writes its own height where the notice's rule can read it. Here rather
 * than in the application because it is a presentation mechanism with nothing
 * of the application in it.
 */

import { useEffect, type RefObject } from 'react';

/**
 * Publishes `element`'s height on the document element as `property` while
 * the component that owns it is mounted, and removes it when that component
 * goes.
 *
 * `element` is read once, as its owner mounts: an element attached later is not
 * published, and one that is not there then publishes nothing. The one caller,
 * the status bar, always draws its element. Removed rather than left at its
 * last value: a rule reading the property has to see nothing when there is
 * nothing there, or it would keep reserving room for a surface that has gone.
 */
export function usePublishedBlockSize(
  element: RefObject<HTMLElement | null>,
  property: string,
): void {
  useEffect(() => {
    const box = element.current;
    const root = document.documentElement;
    if (box === null) {
      root.style.removeProperty(property);
      return undefined;
    }

    const write = (): void => {
      root.style.setProperty(property, `${String(box.getBoundingClientRect().height)}px`);
    };

    write();
    const watch = new ResizeObserver(write);
    watch.observe(box);
    return () => {
      watch.disconnect();
      root.style.removeProperty(property);
    };
  }, [element, property]);
}
