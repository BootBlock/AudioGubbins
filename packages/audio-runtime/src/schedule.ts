/**
 * Waking later, as the host decides.
 *
 * The feed pumps, the playback clock and the render host each wait between
 * steps. They take this rather than calling `setTimeout`, so a test advances
 * their time itself and sees the same order every run; production passes
 * `setTimeout` and `clearTimeout`.
 */

/** Calls `callback` after `delayMs`, and answers how to cancel it. */
export type Schedule = (callback: () => void, delayMs: number) => () => void;
