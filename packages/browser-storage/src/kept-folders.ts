/**
 * Finding again, after the page reloads, the folder the user chose for a use,
 * and whether AudioGubbins may write into it (REQ-STOR-105).
 *
 * The handle is kept by this browser on this machine alone, and the browser
 * lets a page write through a handle taken back out of storage only once the
 * user has said so again, which it asks only in answer to their gesture. So, as
 * with a linked file (`kept-files.ts`), looking and asking are two calls:
 * looking says whether leave is needed, and asking is made from the control the
 * user pressed. Every way it can go is an answer, not an exception.
 */

import type { FileHandleKeeper, FolderUse } from './file-handle-keeper.js';
import {
  queryWritePermission,
  requestWritePermission,
  type HandlePermission,
} from './handle-permissions.js';

/** What became of the folder kept for a use. */
export type KeptFolderAccess =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly folder: FileSystemDirectoryHandle }
  | { readonly kind: 'permission-needed'; readonly name: string }
  | { readonly kind: 'denied'; readonly name: string };

async function access(
  keeper: FileHandleKeeper,
  use: FolderUse,
  permission: (handle: FileSystemDirectoryHandle) => Promise<HandlePermission>,
): Promise<KeptFolderAccess> {
  const folder = await keeper.findFolder(use);
  if (folder === undefined) return { kind: 'none' };
  switch (await permission(folder)) {
    case 'granted':
      return { kind: 'available', folder };
    case 'prompt':
      return { kind: 'permission-needed', name: folder.name };
    case 'denied':
      return { kind: 'denied', name: folder.name };
  }
}

/** The kept folder, as far as it can be written without asking the user. */
export function reopenKeptFolder(
  keeper: FileHandleKeeper,
  use: FolderUse,
): Promise<KeptFolderAccess> {
  return access(keeper, use, queryWritePermission);
}

/**
 * The kept folder, asking the user for leave to write into it where the browser
 * needs it. Only from the handler of a user's gesture, which the browser
 * requires.
 */
export function requestKeptFolderAccess(
  keeper: FileHandleKeeper,
  use: FolderUse,
): Promise<KeptFolderAccess> {
  return access(keeper, use, requestWritePermission);
}
