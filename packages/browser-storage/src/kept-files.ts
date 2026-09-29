/**
 * Finding a linked file again after the page reloads, to verify it against the
 * identity the project recorded (REQ-STOR-104, REQ-STOR-053).
 *
 * Every way it can go is an answer, not an exception: the file is there and
 * readable; nothing is kept under the key, or the file it named has gone; or
 * the browser needs the user's leave to read it, which it either has to be
 * asked for or has been refused. Asking is a separate call, because the browser
 * grants it only in answer to the user's gesture, so the interface makes it
 * from the control the user pressed.
 */

import type { ExternalFile } from '@audiogubbins/media-store';

import { externalFileOf } from './external-files.js';
import type { FileHandleKeeper } from './file-handle-keeper.js';
import {
  queryReadPermission,
  requestReadPermission,
  type HandlePermission,
} from './handle-permissions.js';
import { meansAbsent } from './platform-failures.js';

/** What became of a kept file. */
export type KeptFileAccess =
  | { readonly kind: 'available'; readonly file: ExternalFile }
  | { readonly kind: 'missing' }
  | { readonly kind: 'permission-needed' }
  | { readonly kind: 'denied' };

async function access(
  keeper: FileHandleKeeper,
  handleKey: string,
  permission: (handle: FileSystemFileHandle) => Promise<HandlePermission>,
): Promise<KeptFileAccess> {
  const handle = await keeper.find(handleKey);
  if (handle === undefined) return { kind: 'missing' };
  switch (await permission(handle)) {
    case 'prompt':
      return { kind: 'permission-needed' };
    case 'denied':
      return { kind: 'denied' };
    case 'granted':
      try {
        return { kind: 'available', file: await externalFileOf(handle, handleKey, undefined) };
      } catch (error) {
        // The file the handle named was deleted or replaced by a folder.
        if (meansAbsent(error)) return { kind: 'missing' };
        throw error;
      }
  }
}

/** The kept file, as far as it can be reached without asking the user. */
export function reopenKeptFile(
  keeper: FileHandleKeeper,
  handleKey: string,
): Promise<KeptFileAccess> {
  return access(keeper, handleKey, queryReadPermission);
}

/**
 * The kept file, asking the user for leave to read it where the browser needs
 * it. Only from the handler of a user's gesture, which the browser requires.
 */
export function requestKeptFileAccess(
  keeper: FileHandleKeeper,
  handleKey: string,
): Promise<KeptFileAccess> {
  return access(keeper, handleKey, requestReadPermission);
}
