/**
 * A value read again on every frame the display draws while it moves.
 *
 * Where playback is, and what the meters read, change many times a second and
 * are not stored values that change: the position is the context's clock read
 * through the transport, and the meters are the processor's latest report. So
 * each is read where it is shown, once a display frame, and not at all while
 * nothing moves. A store written thirty times a second to carry them would
 * redraw every reader of the store for numbers only one part shows.
 *
 * `read` answers the same value, by identity, until it changes, as
 * `useSyncExternalStore` asks.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** `read()`, kept current once a display frame while `moving`. */
export function useDisplayFrame<TValue>(read: () => TValue, moving: boolean): TValue {
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
