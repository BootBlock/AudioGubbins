/**
 * Whether the page is visible, and its changes.
 *
 * A browser may suspend capture in a page sent to the background or behind a
 * lock screen, so a controlled recording watches the page's visibility, with
 * the track's mute and end events, to stop and keep what it has and say why
 * (ADR-0070, REQ-REC-097). Read from a document given as an argument, so a
 * test states the page it describes.
 */

import { offered } from './browser-reads.js';

/** Whether the page can be seen. */
export type PageVisibility = 'visible' | 'hidden';

/** The members of a document that visibility reads. */
export interface VisibilityDocument extends EventTarget {
  readonly visibilityState?: string | undefined;
}

/** The page's visibility now, or `undefined` where the document does not say. */
export function readPageVisibility(documentLike: VisibilityDocument): PageVisibility | undefined {
  const state = offered(() => documentLike.visibilityState);
  return state === 'visible' || state === 'hidden' ? state : undefined;
}

/**
 * Calls `changed` whenever the page's visibility changes, with what it has
 * become, and answers how to stop.
 */
export function watchPageVisibility(
  documentLike: VisibilityDocument,
  changed: (visibility: PageVisibility) => void,
): () => void {
  const listener = (): void => {
    const visibility = readPageVisibility(documentLike);
    if (visibility !== undefined) changed(visibility);
  };
  documentLike.addEventListener('visibilitychange', listener);
  return () => {
    documentLike.removeEventListener('visibilitychange', listener);
  };
}
