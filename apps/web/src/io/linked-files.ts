/**
 * Finding again the file a linked asset was recorded from, through the handle
 * AudioGubbins kept for it (REQ-STOR-104, REQ-STOR-053).
 *
 * A port, so the stores that look at linked files are tested without a browser
 * (REQ-EXEC-136.4), and shared by the check of what became of each linked file
 * and by the copying of linked files into the project, so both find a file the
 * same way. The browser asks the person again for leave to read a file whose
 * handle was taken back out of storage, and asks only in answer to their
 * gesture: `look` never asks, which a look at the project as it opens needs,
 * and `ask` is made from the control the person pressed.
 */

import {
  reopenKeptFile,
  requestKeptFileAccess,
  type FileHandleKeeper,
  type KeptFileAccess,
} from '@audiogubbins/browser-storage';
import type { AbsenceReason } from '@audiogubbins/media-store';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';

/** How the file a linked asset was recorded from is found again. */
export interface LinkedFilesPort {
  /** The file, as far as it can be reached without asking the person. */
  look(identity: ExternalSourceIdentity): Promise<KeptFileAccess>;

  /** The file, asking the person for leave to read it where the browser needs it. */
  ask(identity: ExternalSourceIdentity): Promise<KeptFileAccess>;
}

/** A kept file that could not be read, as the media store names why. */
export function absenceOf(access: Exclude<KeptFileAccess, { kind: 'available' }>): AbsenceReason {
  switch (access.kind) {
    case 'missing':
      return 'not-found';
    case 'permission-needed':
      return 'access-needed';
    case 'denied':
      return 'permission-refused';
  }
}

const MISSING: KeptFileAccess = { kind: 'missing' };

/**
 * The browser's linked files, found by the handles `keeper` holds; where it
 * keeps none, no linked file can be found again.
 */
export function browserLinkedFiles(keeper: FileHandleKeeper | undefined): LinkedFilesPort {
  const reach =
    (open: typeof reopenKeptFile) =>
    async (identity: ExternalSourceIdentity): Promise<KeptFileAccess> =>
      keeper === undefined || identity.handleKey === undefined
        ? MISSING
        : await open(keeper, identity.handleKey);
  return { look: reach(reopenKeptFile), ask: reach(requestKeptFileAccess) };
}
