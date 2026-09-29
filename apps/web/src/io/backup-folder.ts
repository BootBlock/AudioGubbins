/**
 * The folder on this machine each backup is also copied to, as the browser
 * gives it: chosen through the directory picker, kept by this browser, and
 * found again after a reload (REQ-STOR-105).
 *
 * A port, so the store is tested without a browser (REQ-EXEC-136.4). Only the
 * directory picker gives a folder to write into, so where the browser has none,
 * or keeps no handles, there is no port and backups stay in its own storage.
 * The browser lets a page write through a handle taken back out of storage only
 * once the person says so again, which it asks only in answer to their gesture:
 * `look` never asks, and `ask` and `choose` are made from the control the
 * person pressed.
 */

import {
  FolderUse,
  pickDirectory,
  reopenKeptFolder,
  requestKeptFolderAccess,
  type FileHandleKeeper,
  type KeptFolderAccess,
  type WritableDirectory,
} from '@audiogubbins/browser-storage';
import type { FilePickers } from '@audiogubbins/capabilities';

/** The backups folder, as far as the page can reach it now. */
export type FolderAccess =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly name: string; readonly folder: WritableDirectory }
  | { readonly kind: 'permission-needed'; readonly name: string }
  | { readonly kind: 'denied'; readonly name: string };

/** How the backups folder is chosen, found again and let go. */
export interface BackupFolderPort {
  /** The folder kept, and whether it may be written, without asking. */
  look(): Promise<FolderAccess>;

  /** The folder kept, asking for leave to write into it where it is needed. */
  ask(): Promise<FolderAccess>;

  /** A folder the person chooses, kept in place of the last, or nothing where dismissed. */
  choose(): Promise<FolderAccess | undefined>;

  /** Stops keeping the folder, leaving everything in it as it is. */
  forget(): Promise<void>;
}

/** The kept folder's access, in the port's terms. */
function accessOf(kept: KeptFolderAccess): FolderAccess {
  return kept.kind === 'available'
    ? { kind: 'available', name: kept.folder.name, folder: kept.folder }
    : kept;
}

/** The browser's backups folder, where it has the directory picker and keeps handles. */
export function browserBackupFolder(
  pickers: FilePickers | undefined,
  keeper: FileHandleKeeper | undefined,
): BackupFolderPort | undefined {
  if (pickers === undefined || keeper === undefined) return undefined;
  return {
    look: async () => accessOf(await reopenKeptFolder(keeper, FolderUse.Backups)),
    ask: async () => accessOf(await requestKeptFolderAccess(keeper, FolderUse.Backups)),
    choose: async () => {
      const picked = await pickDirectory(pickers.openDirectory, 'readwrite');
      if (picked.kind === 'cancelled') return undefined;
      await keeper.keepFolder(FolderUse.Backups, picked.chosen);
      return { kind: 'available', name: picked.chosen.name, folder: picked.chosen };
    },
    forget: async () => {
      await keeper.forget(FolderUse.Backups);
    },
  };
}
