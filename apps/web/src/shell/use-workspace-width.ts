/**
 * Watching the width at which the workspace stops being drawn, so that
 * crossing it is something the user is told about.
 *
 * Below REQ-UX-057.1's width a media query takes every child of the workspace
 * out of the box tree. Unwatched, a user whose focus was inside a dock panel
 * when the window narrowed, the device was rotated or the page was zoomed would
 * have the focused element removed from under them: the browser drops focus to
 * the document body, nothing would move it anywhere, and a screen-reader user
 * would be told neither that the workspace had gone nor that a message had
 * taken its place. Widening again would bring the dock back and leave focus
 * where it had fallen.
 *
 * The same query as the stylesheet, and the number from the same module the
 * message reads, so the watcher and the rule cannot disagree about where the
 * workspace stops.
 */

import { useEffect } from 'react';

import { watchMediaQuery } from '@audiogubbins/capabilities';

import { SMALLEST_WORKSPACE_WIDTH } from './too-narrow.js';

/** What a crossing says, each way. */
const SAID = {
  narrow: 'The page is too narrow for the workspace. Your panels are still here.',
  wide: 'The workspace is back.',
} as const;

/** Where focus last was, as far as the width watch needs it. */
interface FocusMemory {
  /**
   * Whether the element focus last went to was in the workspace, until the
   * reader takes focus somewhere no element is: whether the body stands in for
   * the workspace. Asked as focus arrives, because an element the workspace
   * has taken away may be in no document by the time it matters.
   */
  readonly wasInTheWorkspace: () => boolean;

  /** Stops listening. */
  readonly stop: () => void;
}

/** Starts remembering where focus was, for {@link useWorkspaceWidth}. */
function rememberWhereFocusWas(): FocusMemory {
  let wasInTheWorkspace = false;

  /** The question `left` asks a task later, while it is waiting. */
  let asking: ReturnType<typeof setTimeout> | undefined;

  const entered = (event: FocusEvent): void => {
    clearTimeout(asking);
    wasInTheWorkspace =
      event.target instanceof Element && event.target.closest('.ag-workspace') !== null;
  };

  // Left for no element while the element is still drawn is the reader's own
  // doing, a click on nothing focusable, unless the page itself lost focus:
  // the browser's menu, its address bar and another window take it the same
  // way, and a reader who zooms from the browser's menu has not left the
  // workspace. Asked a task later, once the engine has settled where focus
  // went. Left because it stopped being drawn is the drop the watch exists
  // for, and some engines say nothing of that at all, so it is what is left
  // standing.
  const left = (event: FocusEvent): void => {
    if (
      event.relatedTarget === null &&
      event.target instanceof Element &&
      event.target.getClientRects().length > 0
    ) {
      clearTimeout(asking);
      asking = setTimeout(() => {
        if (document.hasFocus()) wasInTheWorkspace = false;
      }, 0);
    }
  };

  document.addEventListener('focusin', entered);
  document.addEventListener('focusout', left);

  return {
    wasInTheWorkspace: () => wasInTheWorkspace,
    stop: () => {
      document.removeEventListener('focusin', entered);
      document.removeEventListener('focusout', left);
      clearTimeout(asking);
    },
  };
}

/**
 * Says which side of the width the window has crossed to, and moves focus to
 * what has taken the workspace's place.
 *
 * Focus goes to the notice's heading rather than to the notice, because a
 * heading is what a reader arriving at a new region looks for. Going the other
 * way it goes to the workspace itself, which is where the dock comes back.
 *
 * The crossing is always said, and focus is moved only where the reader is in
 * the workspace to begin with, or where the browser has dropped it to the body
 * because the workspace took their element with it. A modal dialogue holds
 * focus and hides the rest of the document from assistive technology, so
 * focusing something outside it would send a reader to what they have been told
 * is not there, and the dialogue's focus scope would pull them back to its
 * container rather than to the control they were using. Zooming the page is how
 * a reader with low vision reads a dialogue, and zooming a 1280-pixel window to
 * 200 per cent crosses this width, so that is the ordinary case rather than an
 * exotic one. A menu the reader has open and a status-bar button are not
 * dialogues and are not modal, and are left alone by the same rule.
 *
 * Widening moves back only what narrowing moved. Moved whatever the reader was
 * doing, a reader who had gone on to the status bar or the menu bar would be
 * pulled into the workspace by a change of window size.
 *
 * The watch answers a crossing and nothing else, so a window that opens narrow
 * says nothing: a page announcing its own width as it opens would say it over
 * whatever the reader came for.
 */
export function useWorkspaceWidth(announce: (text: string, urgent?: boolean) => void): void {
  useEffect(() => {
    /** What this watch put focus on when the window narrowed, while it holds it. */
    let moved: HTMLElement | undefined;

    const focus = rememberWhereFocusWas();

    const stop = watchMediaQuery(`(width < ${String(SMALLEST_WORKSPACE_WIDTH)}px)`, (tooNarrow) => {
      announce(tooNarrow ? SAID.narrow : SAID.wide);

      const focused = document.activeElement;

      if (tooNarrow) {
        // Only where the reader is in the workspace to begin with, which is
        // what the width is about to take from them. A modal dialogue is not
        // the only place a reader can be that is not the workspace: an open
        // menu and a status-bar button are neither modal nor in it, and moved
        // from there, a reader in one of those would be pulled to the notice
        // with the menu closed under them.
        //
        // The body counts as the workspace where it stands in for an element of
        // the workspace. The same media query this answers takes the
        // workspace's children out of the box tree, and a browser drops focus
        // to the body when the focused element goes with them, which is the
        // case this whole watch exists for. Counted whatever put it there, it
        // would move a reader who had just opened the page, or had clicked on
        // the menu bar's empty space, as well.
        const onTheBody = focused === null || focused === document.body;
        const leaving = onTheBody
          ? focus.wasInTheWorkspace()
          : focused.closest('.ag-workspace') !== null;
        if (!leaving) return;
      } else {
        // The element this watch focused, or the body it fell to when that
        // element left the page as the workspace came back.
        const stillOurs = moved !== undefined && (focused === moved || focused === document.body);
        moved = undefined;
        if (!stillOurs) return;
      }

      const target = document.querySelector<HTMLElement>(
        tooNarrow ? '.ag-too-narrow-heading' : '.ag-workspace',
      );
      target?.focus();
      if (tooNarrow) moved = target ?? undefined;
    });

    return () => {
      stop();
      focus.stop();
    };
  }, [announce]);
}
