/**
 * The page's timers, as the runtime's `Schedule` takes them, shared by the
 * audio context's lifecycle, which the page carries from the start, and the
 * engine, which it loads only when audio is first used.
 */

/** Runs `callback` after `milliseconds`, answering how to call it off. */
export function browserSchedule(callback: () => void, milliseconds: number): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(timer);
  };
}
