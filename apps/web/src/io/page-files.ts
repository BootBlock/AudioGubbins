/**
 * A file the browser handed the page, as the page lends it to the storage
 * worker: as itself, with the handle it came through where it came through
 * one, so the worker reads and hashes it where it is and the page spends
 * nothing on a long file (ADR-0022, REQ-STOR-104).
 */

import type { ChosenFile } from '@audiogubbins/browser-storage';
import type { PageFile } from '@audiogubbins/storage-runtime';

/** The file the person chose, as the page lends it. */
export function pageFileOf(chosen: ChosenFile): PageFile {
  const { file, handle, ...described } = chosen;
  return {
    ...described,
    bytes: { kind: 'file', file, ...(handle === undefined ? {} : { handle }) },
  };
}
