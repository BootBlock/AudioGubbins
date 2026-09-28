/**
 * Draws the component again at a given time.
 *
 * For a state that ends on its own without telling anyone. Diagnostic mode is
 * one: the centre ends it lazily, the next time it is asked, so nothing would
 * ask and the status bar would go on saying "Diagnostic mode" after it had
 * stopped collecting. REQ-PRIV-165 requires a clear indication while it is
 * active, and an indication that outlives the mode is not a clear one.
 */

import { useEffect, useState } from 'react';

import type { Clock } from '@audiogubbins/diagnostics';

/** Redraws the calling component at `at`, on `clock`, or never when `at` is `undefined`. */
export function useRedrawAt(at: number | undefined, clock: Clock): void {
  const [, redraw] = useState(0);

  useEffect(() => {
    if (at === undefined) return undefined;
    const timer = setTimeout(
      () => {
        redraw((count) => count + 1);
      },
      Math.max(0, at - clock.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [at, clock]);
}
