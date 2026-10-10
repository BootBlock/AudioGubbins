/**
 * The held space bar of an editor view, which makes any tool the hand while
 * the view has the keyboard, as in most editors (REQ-EDIT-065).
 */

/**
 * Listens on `host` for the space bar, telling `held` when it is pressed and
 * let go, and that it is let go when the view loses the keyboard, so a key
 * released elsewhere leaves no tool stuck as the hand. Returns the call that
 * stops listening.
 */
export function listenToSpaceBar(host: HTMLElement, held: (panning: boolean) => void): () => void {
  const key = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
    // The held space bar is the hand, and not the page scrolling.
    event.preventDefault();
    held(event.type === 'keydown');
  };
  const blurred = (): void => {
    held(false);
  };
  host.addEventListener('keydown', key);
  host.addEventListener('keyup', key);
  host.addEventListener('blur', blurred);
  return () => {
    host.removeEventListener('keydown', key);
    host.removeEventListener('keyup', key);
    host.removeEventListener('blur', blurred);
  };
}
