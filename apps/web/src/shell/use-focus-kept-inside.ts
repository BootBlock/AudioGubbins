/**
 * Keeping focus inside a strip whose buttons come and go with what they answer
 * (REQ-UX-005).
 *
 * A button a person presses may go when its action settles, which is often
 * later, once storage has answered: Ask to change goes once the project is
 * handed over, Hand over once it is, and Take over… gives way to the button
 * that confirms it at once. Left alone, focus would fall to the page's body
 * with the button, and a keyboard or screen-reader user would be put back at
 * the top of the page. Once a button in the strip is pressed, focus that falls
 * to the body as the strip's contents change is put on the strip's first
 * button, or on the strip itself where none is left, until the person moves
 * focus out of the strip themselves.
 *
 * The strip's contents are watched rather than its renders, since a part of it
 * can change without the strip itself being drawn again.
 */

import { useEffect, useRef, type FocusEvent, type RefObject } from 'react';

/** What the strip wires up: its focus-out handler, and the call a press makes. */
export interface FocusKeptInside {
  readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
  readonly pressed: () => void;
}

/** Keeps focus in the strip `strip` holds, once a button in it was pressed. */
export function useFocusKeptInside(strip: RefObject<HTMLElement | null>): FocusKeptInside {
  const holding = useRef(false);

  useEffect(() => {
    const box = strip.current;
    if (box === null) return undefined;
    const watching = new MutationObserver(() => {
      const active = box.ownerDocument.activeElement;
      if (!holding.current || (active !== null && active !== box.ownerDocument.body)) return;
      (box.querySelector<HTMLElement>('button:not([disabled])') ?? box).focus();
    });
    watching.observe(box, { childList: true, subtree: true });
    return () => {
      watching.disconnect();
    };
  }, [strip]);

  return {
    onBlur: (event) => {
      const to = event.relatedTarget;
      if (to instanceof Node && !event.currentTarget.contains(to)) holding.current = false;
    },
    pressed: () => {
      holding.current = true;
    },
  };
}
