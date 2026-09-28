/**
 * Where focus goes back to when a dialogue closes.
 *
 * Apart from the dialogue because it is a concept of its own: it reads only the
 * element focus must not be remembered inside, and the dialogue reads only its
 * answer.
 */

import { useEffect, useRef, type RefObject } from 'react';

/**
 * How many earlier focus positions a dialogue remembers.
 *
 * More than one, because the most recent is very often gone by the time the
 * dialogue closes. A Radix select, popover or menu renders into the document
 * body rather than inside the dialogue, so using the Theme select records a
 * portalled option as the latest position to go back to, and that option is
 * removed when the select closes. Opening a dialogue from the command palette
 * does the same: the palette closes and the dialogue opens in one commit, so
 * the last position outside the dialogue is an element that no longer exists.
 *
 * Eight is enough to pass a select, a menu and the palette and still find the
 * control the user actually started from.
 */
const REMEMBERED_FOCUS_POSITIONS = 8;

/**
 * Remembers where focus has been, outside `inside`, and returns a function
 * that puts it back.
 *
 * Radix returns focus to the dialogue's trigger, and an AudioGubbins dialogue
 * usually has none: every one of them is opened by a command, which the user
 * may have run from a shortcut, the palette or a menu. With no trigger to
 * return to, focus would fall to the document body, which drops a keyboard user
 * out of the application entirely.
 *
 * Watching the document rather than reading the focus as the dialogue opens is
 * what makes this work at all: by the time the dialogue's effects run, the
 * dialogue has already taken the focus it is asking about. It also means the
 * history starts at mount, so a dialogue has to stay mounted while it is shut
 * to remember anything: one that mounts as it opens learns nothing.
 */
export function useFocusReturn(inside: RefObject<HTMLElement | null>): () => boolean {
  const restoreTo = useRef<readonly HTMLElement[]>([]);

  useEffect(() => {
    const remember = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (inside.current?.contains(target) === true) return;

      restoreTo.current = [target, ...restoreTo.current.filter((one) => one !== target)].slice(
        0,
        REMEMBERED_FOCUS_POSITIONS,
      );
    };

    document.addEventListener('focusin', remember, true);
    return () => {
      document.removeEventListener('focusin', remember, true);
    };
  }, [inside]);

  // Puts focus back, and says whether it managed to. Each candidate is tried
  // by focusing it and asking where focus actually went. An element can be in
  // the document and still refuse focus (hidden, disabled, or inside a subtree
  // the browser has made inert), and checking the outcome covers all of those
  // without probing for the APIs that would describe them (REQ-EXEC-216).
  return (): boolean =>
    restoreTo.current.some((candidate) => {
      if (!candidate.isConnected) return false;
      candidate.focus();
      return document.activeElement === candidate;
    });
}
