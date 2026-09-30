/**
 * What a key pressed in an editor's surface changed, said once it settles.
 *
 * The surface is an application region, so a screen reader passes its keys
 * through and reads nothing of what they do: the arrows, Home, End and the
 * page keys moved the playhead, the zoom and the stretch shown, and the
 * readings beside the canvas changed in silence. Their text is not a live
 * region, since the playhead's changes every frame while the asset plays.
 *
 * So what a run of keys changed is said, politely, once the keys stop, as
 * `use-settled.ts` waits for anything a live region reports while the user is
 * still working. Only after a key pressed in the surface: a drag shows what it
 * does under the pointer, and playback would say the playhead every frame.
 */

import { useEffect, useRef, type RefObject } from 'react';

/** How long the keys must stop before what they changed is said. */
const QUIET_MS = 500;

/** What an editor view's readings say, each as the panel writes it. */
export interface Readings {
  readonly playhead: string;
  readonly zoom: string;
  readonly showing: string;
}

/** The sentence saying what changed between `from` and `to`, or none where nothing did. */
function changeSaid(from: Readings, to: Readings): string | undefined {
  const said: string[] = [];
  if (to.playhead !== from.playhead) said.push(`Playhead at ${to.playhead}.`);
  if (to.zoom !== from.zoom) said.push(`Zoom ${to.zoom}, showing ${to.showing}.`);
  else if (to.showing !== from.showing) said.push(`Showing ${to.showing}.`);
  return said.length === 0 ? undefined : said.join(' ');
}

/**
 * Says what the keys pressed in `surface` changed of `readings`, through
 * `announce`, once they have stopped for {@link QUIET_MS}: measured from the
 * readings as they were at the first key of the run.
 */
export function useReadingsSaid(
  surface: RefObject<HTMLElement | null>,
  readings: Readings,
  announce: (text: string) => void,
): void {
  // Read when the keys settle, rather than listened again for each: a run of
  // keys renders the readings anew at each, and would lose where it started.
  const latest = useRef({ readings, announce });
  useEffect(() => {
    latest.current = { readings, announce };
  }, [readings, announce]);

  useEffect(() => {
    const element = surface.current;
    if (element === null) return undefined;
    let from: Readings | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = (): void => {
      const said = from === undefined ? undefined : changeSaid(from, latest.current.readings);
      from = undefined;
      if (said !== undefined) latest.current.announce(said);
    };
    const pressed = (): void => {
      from ??= latest.current.readings;
      clearTimeout(timer);
      timer = setTimeout(settled, QUIET_MS);
    };
    element.addEventListener('keydown', pressed);
    return () => {
      element.removeEventListener('keydown', pressed);
      clearTimeout(timer);
    };
  }, [surface]);
}
