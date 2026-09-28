/**
 * Reading the browser's layout map again when the user comes back to the tab.
 *
 * A user can change keyboard layout while AudioGubbins is running, and no
 * browser offers an event for it. Chromium's map is read at start-up, and were
 * it read only then, it would stand: the layout would become a mixture of the
 * map as it was and the keys the user has typed since, and a binding could move
 * under them. Returning to the tab is the one moment worth asking again, and
 * the dock already watches the same two events for its own reasons.
 *
 * A browser with no map answers with nothing, which adopts nothing, so this
 * costs Firefox and Safari a resolved promise per return to the tab. What it
 * cannot do there is notice the change at all: with no map, a layout learned
 * on another keyboard is kept from the last visit and corrected only as the
 * user types.
 */

import type { LayoutMapPairs } from '@audiogubbins/capabilities';

import type { KeyboardLayoutStore } from './keyboard-layout-store.js';

/** What this needs of the page, so a test can stand in for it. */
export interface PageVisibility {
  readonly isVisible: () => boolean;
  readonly listen: (event: 'visibilitychange' | 'focus', handler: () => void) => () => void;
}

/** The real page: the document's visibility, and the two events that say the user is back. */
export function browserVisibility(): PageVisibility {
  return {
    isVisible: () => document.visibilityState === 'visible',
    listen: (event, handler) => {
      const target: EventTarget = event === 'focus' ? window : document;
      target.addEventListener(event, handler);
      return () => {
        target.removeEventListener(event, handler);
      };
    },
  };
}

/**
 * Adopts the layout map again each time the user returns to the tab, and
 * returns the function that stops watching.
 *
 * One read at a time. Both events can fire for the same return, and a browser
 * with no map answers at once, so an unguarded handler would ask twice for
 * every switch between windows.
 */
export function adoptLayoutMapOnReturn(
  layout: Pick<KeyboardLayoutStore, 'adopt'>,
  read: () => Promise<LayoutMapPairs>,
  onProblem: (error: unknown) => void,
  page: PageVisibility,
): () => void {
  let reading = false;

  const reread = (): void => {
    if (reading || !page.isVisible()) return;
    reading = true;
    read().then(
      (pairs) => {
        reading = false;
        layout.adopt(pairs);
      },
      (error: unknown) => {
        reading = false;
        onProblem(error);
      },
    );
  };

  const stop = [page.listen('visibilitychange', reread), page.listen('focus', reread)];
  return () => {
    for (const one of stop) one();
  };
}
