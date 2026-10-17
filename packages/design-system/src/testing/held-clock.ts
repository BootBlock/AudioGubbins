/**
 * A clock the meters' tests hold, so a meter's ballistics run frame by frame at
 * times the test chooses rather than on the machine's timers.
 */

import type { FrameClock } from '../primitives/dials/frame-clock.js';

/** A clock that stands still until the test moves it. */
export interface HeldClock {
  readonly clock: FrameClock;

  /** Moves the time on by `milliseconds` and draws the frames that were waiting. */
  readonly advance: (milliseconds: number) => void;

  /** How many frames are waiting to be drawn. */
  readonly waiting: () => number;
}

/** A clock at time 0 whose frames are drawn only when the test moves it. */
export function heldClock(): HeldClock {
  let time = 0;
  let next = 1;
  const frames = new Map<number, () => void>();
  return {
    clock: {
      now: () => time,
      requestFrame: (draw) => {
        const handle = next;
        next += 1;
        frames.set(handle, draw);
        return handle;
      },
      cancelFrame: (handle) => {
        frames.delete(handle);
      },
    },
    advance: (milliseconds) => {
      time += milliseconds;
      const due = [...frames.values()];
      frames.clear();
      for (const draw of due) draw();
    },
    waiting: () => frames.size,
  };
}
