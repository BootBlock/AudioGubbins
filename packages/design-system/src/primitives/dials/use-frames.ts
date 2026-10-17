/**
 * The frames a meter draws on: one draw at once when a reading arrives, so a
 * rise is seen in the frame it arrives, and one a frame after it until what
 * the meter shows stands still, so a meter at rest costs nothing.
 *
 * Drawing writes the meter's custom properties onto its elements rather than
 * rendering it again, so a meter moving at the frame rate costs no React work.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { FrameClock } from './frame-clock.js';

/**
 * Draws what a meter shows at a time, and says whether it now stands still
 * until another reading arrives.
 */
export type Draw = (now: number) => boolean;

/** What wakes a meter's frames: call it as a reading arrives. */
export type Wake = () => void;

/** The frames `draw` runs on, from `clock`, stopped when the meter goes. */
export function useFrames(clock: FrameClock, draw: Draw): Wake {
  // The draw of the latest render, taken before the meter's own effects run
  // and wake the frames, which are declared after this.
  const latest = useRef(draw);
  useLayoutEffect(() => {
    latest.current = draw;
  });
  const pending = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    if (pending.current !== undefined) clock.cancelFrame(pending.current);
    pending.current = undefined;
  }, [clock]);

  const frame = useCallback(() => {
    pending.current = undefined;
    if (!latest.current(clock.now())) pending.current = clock.requestFrame(frame);
  }, [clock]);

  useEffect(() => stop, [stop]);

  return useCallback(() => {
    stop();
    frame();
  }, [stop, frame]);
}
