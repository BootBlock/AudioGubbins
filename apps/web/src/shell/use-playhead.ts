/**
 * The frame the listener hears, read again on every frame the display draws
 * while playback moves.
 *
 * The position is not a stored value that changes: it is the context's clock
 * read through the transport, so it is read where it is shown, once a frame,
 * and not at all while nothing moves. A store written thirty times a second to
 * carry it would redraw every reader of the store for a number only one shows.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** `read()`, kept current once a display frame while `moving`. */
export function usePlayhead(read: () => number | undefined, moving: boolean): number | undefined {
  const subscribe = useCallback(
    (changed: () => void) => {
      if (!moving) return () => undefined;
      let request = requestAnimationFrame(function tick() {
        changed();
        request = requestAnimationFrame(tick);
      });
      return () => {
        cancelAnimationFrame(request);
      };
    },
    [moving],
  );
  return useSyncExternalStore(subscribe, read);
}
