/**
 * Finding again the file a linked asset was recorded from, through the handle
 * AudioGubbins kept for it (REQ-STOR-104, REQ-STOR-053).
 *
 * Shared by the check of what became of each linked file and by the copying of
 * linked files into the project, so both find a file the same way. Only what
 * the browser allows without asking is tried: leave to read a file again is
 * asked for only from the handler of the person's gesture, which a look at the
 * project as it opens is not.
 */

import {
  reopenKeptFile,
  type FileHandleKeeper,
  type KeptFileAccess,
} from '@audiogubbins/browser-storage';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';

/** Whether the file a linked asset was recorded from can be read now. */
export async function linkedFileOf(
  keeper: FileHandleKeeper | undefined,
  identity: ExternalSourceIdentity,
): Promise<KeptFileAccess> {
  if (keeper === undefined || identity.handleKey === undefined) return { kind: 'missing' };
  return await reopenKeptFile(keeper, identity.handleKey);
}
