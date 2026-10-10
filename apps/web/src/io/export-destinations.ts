/**
 * Where an export goes, as the browser lets the person choose it (ADR-0092,
 * REQ-GODOT-046, REQ-EXEC-216): a file a save dialog gives, a folder the
 * directory picker gives, or a download where the browser has neither.
 *
 * A port, so the export's commands are tested without a browser. Each chooser
 * opens a dialog, which a browser opens only in answer to the person's
 * gesture, so a command asks first and does its other work after. Leave to
 * write is asked in the same gesture: the pickers ask for it as they give a
 * handle, and a kept folder, or a handle whose leave lapsed after a refused
 * delivery, is asked again by `allowWriting` before the export or its retry
 * starts, since the delivery itself happens long after the gesture and may
 * only check, never ask.
 */

import {
  pickDirectory,
  pickSaveFile,
  queryWritePermission,
  requestWritePermission,
} from '@audiogubbins/browser-storage';
import type { FilePickers } from '@audiogubbins/capabilities';
import { fail, failure, FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';
import type { CollisionPolicy } from '@audiogubbins/import-export';

import type { ExportDestinationChoice } from '../export/export-types.js';
import { offerDownload } from './download.js';

/** How the person chooses where an export goes. */
export interface ExportDestinations {
  /**
   * A file the person chooses in a save dialog, suggested as `name`, or a
   * download where the browser has no save dialog; nothing where dismissed.
   */
  chooseFile(name: string): Promise<ExportDestinationChoice | undefined>;

  /**
   * A folder the person chooses to export into under `policy`, nothing where
   * dismissed, or refused where the browser gives no folder to write into.
   */
  chooseFolder(policy: CollisionPolicy): Promise<DomainResult<ExportDestinationChoice | undefined>>;

  /** A folder the person chooses to keep trusted, nothing where dismissed, refused as `chooseFolder` is. */
  chooseFolderToTrust(): Promise<DomainResult<FileSystemDirectoryHandle | undefined>>;

  /**
   * Whether `handle` may be written, asking the person where the browser
   * needs their leave; only in answer to their gesture.
   */
  allowWriting(handle: FileSystemHandle): Promise<boolean>;

  /** Hands `file` to the person as a download under `name`. */
  download(file: Blob, name: string): void;
}

/** Why no folder can be chosen in this browser. */
const NO_FOLDERS = failure(
  'export.folders-unsupported',
  FailureKind.Rejected,
  'This browser cannot give AudioGubbins a folder to write into. Export to a file instead, which it offers as a download.',
);

/** The browser's way of choosing where an export goes, with the pickers where it has them. */
export function browserExportDestinations(pickers: FilePickers | undefined): ExportDestinations {
  const folder = async (): Promise<DomainResult<FileSystemDirectoryHandle | undefined>> => {
    if (pickers === undefined) return fail(NO_FOLDERS);
    const picked = await pickDirectory(pickers.openDirectory, 'readwrite');
    return succeed(picked.kind === 'cancelled' ? undefined : picked.chosen);
  };
  return {
    chooseFile: async (name) => {
      if (pickers === undefined) return { kind: 'download' };
      const picked = await pickSaveFile(pickers.saveFile, name);
      return picked.kind === 'cancelled' ? undefined : { kind: 'file', handle: picked.chosen };
    },
    chooseFolder: async (policy) => {
      const chosen = await folder();
      if (!chosen.ok) return chosen;
      return succeed(
        chosen.value === undefined ? undefined : { kind: 'folder', handle: chosen.value, policy },
      );
    },
    chooseFolderToTrust: folder,
    allowWriting: async (handle) => {
      if ((await queryWritePermission(handle)) === 'granted') return true;
      return (await requestWritePermission(handle)) === 'granted';
    },
    download: offerDownload,
  };
}
