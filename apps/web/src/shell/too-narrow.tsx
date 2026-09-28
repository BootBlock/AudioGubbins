import type { ReactNode } from 'react';

/**
 * The smallest viewport width AudioGubbins draws a docking workspace at, in CSS
 * pixels (REQ-UX-057.1).
 *
 * Written here for the message and in `shell.css` for the rule that shows it: a
 * media query cannot read a custom property, so the two cannot share a token.
 * The rule there is written as a range rather than as this number minus one,
 * because a media query's width is fractional where the device pixel ratio is
 * not a whole number: a Firefox page whose `window.innerWidth` is 639 can
 * report a media width just above it, which a rule written as the number minus
 * one would not match, so the notice would never appear. The number itself is
 * not repeated here, because a rule holds the places it is written equal and a
 * doc is not one of them. The browser test that drives the page to either side
 * of the width holds the two together, because it reads the message and the
 * rule at once.
 */
export const SMALLEST_WORKSPACE_WIDTH = 640;

/**
 * What the workspace shows when the window is too narrow to dock panels in.
 *
 * Three docked columns at a panel's declared minimum, with the splitters
 * between them, need more than six hundred pixels. Drawn anyway, the dock would
 * clip its panels or scroll in two directions, and the shell is `100dvh` with
 * `overflow: hidden`, so nothing could be scrolled back into view. Declining to
 * draw one, and saying so, is what Phase 01 does; a workspace that adapts to a
 * narrow viewport is owned with the responsive layouts.
 *
 * Shown and hidden by a media query rather than by measuring here, so it
 * follows the window with no listener and no re-render, and the dock stays
 * mounted behind it: widening the window brings the arrangement back untouched.
 * The menus, the palette, the settings and the status bar keep working, so a
 * reader who arrives here can still reach every command.
 */
export function TooNarrowNotice(): ReactNode {
  return (
    <div className="ag-too-narrow" role="note">
      {/* Focusable, so that crossing the width can put the reader at the head
          of what has replaced the workspace rather than at the top of the
          document (`use-workspace-width.ts`).

          The page rather than the window, here and in every sentence below. The
          rule fires on the width of the page, which a high zoom shrinks while
          the window stays as it was: at 200 per cent in a 1280-pixel window,
          "this window is too narrow" is false of the reader's machine, and the
          paragraph under it, which is about the page, would say so in the next
          breath. */}
      <h2 className="ag-too-narrow-heading" tabIndex={-1}>
        The page is too narrow for the workspace
      </h2>
      <p>
        AudioGubbins arranges panels side by side, and the page is not wide enough for that. Your
        panels are still here, and come back as soon as there is room.
      </p>
      {/*
        Written for a width rather than for a device. The rule fires on width
        alone, so this is reached on a desktop with a restored window and at a
        high browser zoom: told to turn their device, a desktop reader would
        have no device to turn, and told to zoom out, a reader at 200 per cent
        would be told to give up the magnification they need. The zoom is named
        as what it is, and the rotation is offered as the conditional it is.
      */}
      <p>
        {`It is the width of the page that counts, so a high zoom leaves less of it: ${String(SMALLEST_WORKSPACE_WIDTH)} pixels of page width is what a workspace needs. Make the window wider or zoom out a step. On a phone or a tablet, turning it to landscape may be enough.`}
      </p>
      <p>The menus, the command palette and the settings all still work.</p>
    </div>
  );
}
