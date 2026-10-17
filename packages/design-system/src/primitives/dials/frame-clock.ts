/**
 * The time a meter moves in, and the frames it draws on.
 *
 * A meter's ballistics are a function of time, so a meter takes its clock
 * rather than reaching for the browser's: a test drives it frame by frame
 * from a clock it holds, and the inventory holds a meter still at a reading.
 */

/** A source of the time and of the frames a meter draws on. */
export interface FrameClock {
  /** The time now, in milliseconds, from any fixed origin. */
  readonly now: () => number;

  /** Runs `draw` before the next frame is painted, and returns what cancels it. */
  readonly requestFrame: (draw: () => void) => number;

  readonly cancelFrame: (handle: number) => void;
}

/** The browser's clock and its frames. */
export const BROWSER_FRAME_CLOCK: FrameClock = {
  now: () => performance.now(),
  requestFrame: (draw) => requestAnimationFrame(draw),
  cancelFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
};
