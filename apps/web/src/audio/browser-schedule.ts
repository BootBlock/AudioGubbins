/**
 * The page's timers, as the runtime's `Schedule` takes them, shared by the
 * audio context's lifecycle, which the page carries from the start, the engine,
 * which it loads only when audio is first used, and the editor's renderer,
 * which waits by them for a lost WebGL2 context.
 */

/** Runs `callback` after `milliseconds`, answering how to call it off. */
export function browserSchedule(callback: () => void, milliseconds: number): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => {
    clearTimeout(timer);
  };
}
