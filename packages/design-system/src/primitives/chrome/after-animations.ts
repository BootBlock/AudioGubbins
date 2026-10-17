/**
 * Waiting for an element's leaving animation before it is taken away.
 *
 * React removes an element the moment it stops being rendered, so a surface
 * that leaves with an animation (a notice sliding out) is rendered in its
 * closing state first, and taken away once that animation has run. The
 * animation is the stylesheet's, chosen by the motion level, so the wait is
 * read from the element rather than timed here: at the Minimal level the
 * animation lasts a millisecond, and where none is running, as in an engine
 * without the Web Animations API, nothing is waited for at all.
 */

/**
 * Calls `then` once every animation running on `element` has finished or
 * been cancelled, at once if none is.
 *
 * Returns a function that stops the call being made, for an effect's cleanup:
 * an element that is shown again before its animation ends is not taken away.
 */
export function afterAnimations(element: Element | null, then: () => void): () => void {
  const running =
    element !== null && typeof element.getAnimations === 'function' ? element.getAnimations() : [];

  if (running.length === 0) {
    then();
    return () => undefined;
  }

  let wanted = true;
  // A cancelled animation rejects `finished`; it has ended either way, and the
  // element goes.
  void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
    if (wanted) then();
  });
  return () => {
    wanted = false;
  };
}
