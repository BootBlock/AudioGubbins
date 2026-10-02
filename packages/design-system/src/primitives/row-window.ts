/**
 * The rows of a long list that its viewport shows, so a list of any length
 * draws only the rows in sight and a few beside them, and room for the rest.
 *
 * A list of every change a project has had, or every command, can hold tens of
 * thousands of rows, and drawing each would cost the page a frame at every
 * change. The rows are of one height, which the window measures from a row it
 * draws, marked with {@link WINDOW_ROW}, and takes from the caller until one is
 * drawn; the viewport is the list's own scrolling box. The row a list keeps
 * active, such as the option a listbox's active descendant names, is drawn
 * wherever it is, so what a screen reader is pointed to always exists.
 *
 * The window changes only when another row comes into sight, not at every
 * pixel scrolled, so scrolling draws the list again only as rows come and go.
 */

import { useLayoutEffect, useState, type RefObject } from 'react';

/** The attribute a drawn row carries, so the window can measure its height. */
export const WINDOW_ROW = 'data-ag-window-row';

/** One row drawn, and the room above it for the rows between it and the last drawn. */
export interface WindowRow {
  readonly index: number;

  /** In pixels. */
  readonly before: number;
}

/** The rows to draw, and the room below the last for the rows after it. */
export interface RowWindow {
  readonly rows: readonly WindowRow[];

  /** In pixels. */
  readonly after: number;
}

/** What the window is drawn from. */
export interface RowWindowOptions {
  /** The height of a row, in pixels, until one is drawn to measure. */
  readonly estimate: number;

  /** The row drawn wherever it is, where there is one. */
  readonly keep?: number;

  /** How many rows beyond those in sight are drawn on each side. */
  readonly overscan?: number;
}

/** What is in sight: the first row, how many rows fit, and a row's height. */
interface Sight {
  readonly first: number;
  readonly fits: number;
  readonly size: number;
}

const OVERSCAN = 8;

/** What `box` shows, by the height of the row it draws or `estimate`. */
function sightOf(box: HTMLElement, estimate: number): Sight {
  const row = box.querySelector(`[${WINDOW_ROW}]`);
  const measured = row === null ? 0 : row.getBoundingClientRect().height;
  const size = measured > 0 ? measured : estimate;
  return {
    first: Math.floor(box.scrollTop / size),
    fits: Math.ceil(box.clientHeight / size),
    size,
  };
}

/** Whether two sights draw the same rows. */
function sameSight(one: Sight, other: Sight): boolean {
  return one.first === other.first && one.fits === other.fits && one.size === other.size;
}

/** The rows `sight` draws of `count`, `keep` among them. */
function windowOf(
  sight: Sight,
  count: number,
  keep: number | undefined,
  overscan: number,
): RowWindow {
  const start = Math.max(0, Math.min(sight.first, count - 1) - overscan);
  const end = Math.min(count, sight.first + sight.fits + overscan + 1);
  const indices: number[] = [];
  if (keep !== undefined && keep >= 0 && keep < start) indices.push(keep);
  for (let index = start; index < end; index += 1) indices.push(index);
  if (keep !== undefined && keep >= end && keep < count) indices.push(keep);
  let drawn = 0;
  const rows = indices.map((index) => {
    const row = { index, before: (index - drawn) * sight.size };
    drawn = index + 1;
    return row;
  });
  return { rows, after: Math.max(0, count - drawn) * sight.size };
}

/**
 * The rows of a list of `count` rows that `viewport`, its scrolling box, shows
 * (see the module comment).
 */
export function useRowWindow(
  viewport: RefObject<HTMLElement | null>,
  count: number,
  { estimate, keep, overscan = OVERSCAN }: RowWindowOptions,
): RowWindow {
  const [sight, setSight] = useState<Sight>({ first: 0, fits: 0, size: estimate });

  useLayoutEffect(() => {
    const box = viewport.current;
    if (box === null) return undefined;
    const look = (): void => {
      const seen = sightOf(box, estimate);
      setSight((last) => (sameSight(last, seen) ? last : seen));
    };
    look();
    box.addEventListener('scroll', look, { passive: true });
    const sizes = new ResizeObserver(look);
    sizes.observe(box);
    return () => {
      box.removeEventListener('scroll', look);
      sizes.disconnect();
    };
  }, [viewport, estimate]);

  return windowOf(sight, count, keep, overscan);
}
