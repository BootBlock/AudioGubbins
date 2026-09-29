/**
 * Asking the user for files and folders through Chromium's pickers, which hand
 * back handles AudioGubbins can return to (REQ-STOR-025, REQ-STOR-104).
 *
 * The pickers are read by the capabilities package and given here; where the
 * browser has none, the page's own file input is used instead
 * (`filesFromInput`), and linking and choosing a folder for backups are not
 * offered. A picker the user dismisses is an answer, `cancelled`, rather than
 * an error. What a picker hands back is checked, since the pickers are absent
 * from the DOM type definitions.
 */

import type { ExternalFile } from '@audiogubbins/media-store';

import { handlesIn } from './directory-handles.js';
import { externalFileOf } from './external-files.js';
import type { FileHandleKeeper } from './file-handle-keeper.js';

/** A picker, as the capabilities package reads it. */
export type Picker = (options: object) => Promise<unknown>;

/** A kind of file a picker offers: its description and its types and extensions. */
export interface PickerFileType {
  readonly description: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

/** What the user chose, or that they chose nothing. */
export type Picked<Chosen> =
  { readonly kind: 'picked'; readonly chosen: Chosen } | { readonly kind: 'cancelled' };

/** What a picker answers, or `cancelled` where the user dismissed it. */
async function ask(picker: Picker, options: object): Promise<Picked<unknown>> {
  try {
    return { kind: 'picked', chosen: await picker(options) };
  } catch (error) {
    // Dismissing a picker is reported as an abort; anything else, such as a
    // picker opened outside a gesture, is a fault of the caller's.
    if (error instanceof DOMException && error.name === 'AbortError') return { kind: 'cancelled' };
    throw error;
  }
}

function refused(what: string): TypeError {
  return new TypeError(`The picker handed back something that is not ${what}.`);
}

/**
 * Asks for one or more files, keeping each one's handle where a keeper is
 * given, so the project can find the file again. Without a keeper, as where the
 * browser offers no IndexedDB, the files are read now and cannot be found after
 * a reload.
 */
export async function pickFiles(
  openFiles: Picker,
  keeper: FileHandleKeeper | undefined,
  options: { readonly multiple: boolean; readonly types?: readonly PickerFileType[] },
): Promise<Picked<readonly ExternalFile[]>> {
  const answer = await ask(openFiles, options);
  if (answer.kind === 'cancelled') return answer;
  if (!Array.isArray(answer.chosen)) throw refused('a list of files');
  const chosen: readonly unknown[] = answer.chosen;
  const files: ExternalFile[] = [];
  for (const handle of chosen) {
    if (!(handle instanceof FileSystemFileHandle)) throw refused('a file');
    files.push(await externalFileOf(handle, await keeper?.keep(handle), undefined));
  }
  return { kind: 'picked', chosen: files };
}

/** Asks for a folder: to import from, or to write backups and bundles into. */
export async function pickDirectory(
  openDirectory: Picker,
  mode: 'read' | 'readwrite',
): Promise<Picked<FileSystemDirectoryHandle>> {
  const answer = await ask(openDirectory, { mode });
  if (answer.kind === 'cancelled') return answer;
  if (!(answer.chosen instanceof FileSystemDirectoryHandle)) throw refused('a folder');
  return { kind: 'picked', chosen: answer.chosen };
}

/** Asks where to save a file, suggesting its name. */
export async function pickSaveFile(
  saveFile: Picker,
  suggestedName: string,
): Promise<Picked<FileSystemFileHandle>> {
  const answer = await ask(saveFile, { suggestedName });
  if (answer.kind === 'cancelled') return answer;
  if (!(answer.chosen instanceof FileSystemFileHandle)) throw refused('a file');
  return { kind: 'picked', chosen: answer.chosen };
}

/**
 * Every file in a folder the user chose and in the folders inside it, one at a
 * time, each with where it lies inside the chosen folder. Each file's own
 * handle is kept where a keeper is given, so a linked file is found again by
 * its key as one picked alone is. The signal stops the walk between files.
 */
export function filesInDirectory(
  directory: FileSystemDirectoryHandle,
  keeper: FileHandleKeeper | undefined,
  signal?: AbortSignal,
): AsyncGenerator<ExternalFile, void, undefined> {
  return filesWithin(directory, '', keeper, signal);
}

async function* filesWithin(
  directory: FileSystemDirectoryHandle,
  within: string,
  keeper: FileHandleKeeper | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<ExternalFile, void, undefined> {
  for await (const handle of handlesIn(directory)) {
    signal?.throwIfAborted();
    const relativePath = within === '' ? handle.name : `${within}/${handle.name}`;
    if (handle instanceof FileSystemDirectoryHandle) {
      yield* filesWithin(handle, relativePath, keeper, signal);
    } else if (handle instanceof FileSystemFileHandle) {
      yield await externalFileOf(handle, await keeper?.keep(handle), relativePath);
    }
  }
}
