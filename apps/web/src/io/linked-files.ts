/**
 * Finding again the file a linked asset was recorded from, through the handle
 * AudioGubbins kept for it (REQ-STOR-104, REQ-STOR-053).
 *
 * A port, so the stores that look at linked files are tested without a browser
 * (REQ-EXEC-136.4), and shared by the check of what became of each linked file
 * and by the copying of linked files into the project, so both find a file the
 * same way. A file found is handed over as itself, for the storage worker to
 * read (`page-files.ts`). The browser asks the person again for leave to read a
 * file whose handle was taken back out of storage, and asks only in answer to
 * their gesture: `look` never asks, which a look at the project as it opens
 * needs, and `ask` is made from the control the person pressed.
 */

import {
  reopenKeptFile,
  requestKeptFileAccess,
  type FileHandleKeeper,
  type KeptFileAccess,
} from '@audiogubbins/browser-storage';
import type { AbsenceReason } from '@audiogubbins/media-store';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { PageFile } from '@audiogubbins/storage-runtime';

import { pageFileOf } from './page-files.js';

/** What became of a linked file: the file, as the page lends it, or why it cannot be read. */
export type LinkedFileAccess =
  | { readonly kind: 'available'; readonly file: PageFile }
  | Exclude<KeptFileAccess, { readonly kind: 'available' }>;

/**
 * How the file a linked asset was recorded from is found again. Each takes the
 * signal of the work that wants the file, and stops where that work was given
 * up.
 */
export interface LinkedFilesPort {
  /** The file, as far as it can be reached without asking the person. */
  look(identity: ExternalSourceIdentity, signal?: AbortSignal): Promise<LinkedFileAccess>;

  /** The file, asking the person for leave to read it where the browser needs it. */
  ask(identity: ExternalSourceIdentity, signal?: AbortSignal): Promise<LinkedFileAccess>;
}

/** A kept file that could not be read, as the media store names why. */
export function absenceOf(
  access: Exclude<LinkedFileAccess, { readonly kind: 'available' }>,
): AbsenceReason {
  switch (access.kind) {
    case 'missing':
      return 'not-found';
    case 'permission-needed':
      return 'access-needed';
    case 'denied':
      return 'permission-refused';
  }
}

const MISSING: LinkedFileAccess = { kind: 'missing' };

/** A kept file's access, its file as the page lends it. */
function lent(access: KeptFileAccess): LinkedFileAccess {
  return access.kind === 'available'
    ? { kind: 'available', file: pageFileOf(access.file) }
    : access;
}

/**
 * The browser's linked files, found by the handles `keeper` holds; where it
 * keeps none, no linked file can be found again.
 */
export function browserLinkedFiles(keeper: FileHandleKeeper | undefined): LinkedFilesPort {
  const reach =
    (open: typeof reopenKeptFile) =>
    async (identity: ExternalSourceIdentity, signal?: AbortSignal): Promise<LinkedFileAccess> => {
      signal?.throwIfAborted();
      if (keeper === undefined || identity.handleKey === undefined) return MISSING;
      // The browser cannot call off finding a kept file, so a look given up
      // meanwhile is given up once it is found.
      const access = await open(keeper, identity.handleKey);
      signal?.throwIfAborted();
      return lent(access);
    };
  return { look: reach(reopenKeptFile), ask: reach(requestKeptFileAccess) };
}
