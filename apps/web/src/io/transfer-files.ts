/**
 * Handing a project, or the stored data, to the person as a file or a folder,
 * and taking a project or a file from them (REQ-STOR-052, REQ-STOR-099,
 * REQ-STOR-103, REQ-STOR-053).
 *
 * A port, so every project flow is tested without a browser (REQ-EXEC-136.4).
 * The browser's side asks through the pickers where the browser has them, which
 * write a file as it is made rather than holding it whole, and through the
 * page's own file input and a download everywhere else. A project's folder is
 * read through the input in every browser, and written only through the
 * directory picker, which alone gives a folder to write into; a folder of
 * audio is read through the directory picker where there is one, which alone
 * gives each file a handle, so a file linked from it is found again. Each chooser is opened as
 * the first thing the flow does, in the handler of the person's gesture, since
 * a browser opens none outside one. A file or folder the person chose is handed
 * on as the files themselves, for the storage worker to read (`page-files.ts`).
 */

import {
  BlobSink,
  filesFromInput,
  filesInDirectory,
  openFileSink,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  writableFolder,
  type ChosenFile,
  type FileHandleKeeper,
} from '@audiogubbins/browser-storage';
import type { FilePickers } from '@audiogubbins/capabilities';
import type { ByteSink } from '@audiogubbins/project-format';
import type { DirectoryWriter } from '@audiogubbins/storage';
import type { FolderFile, PageBytes, PageFile, PageFolder } from '@audiogubbins/storage-runtime';

import { offerDownload } from './download.js';
import { chooseThroughInput } from './file-input.js';
import { pageFileOf } from './page-files.js';

/** Where a file is written, and what finishes it once the sink has closed. */
export interface SaveTarget {
  readonly sink: ByteSink;

  /** The file's name, as the person chose it or as the download is offered. */
  readonly name: string;

  /** Hands the file over once its sink has closed: a download, where there was no picker. */
  readonly finish: () => void;
}

/** A folder the person chose to write into, and its name. */
export interface ChosenFolder {
  readonly writer: DirectoryWriter;
  readonly name: string;
}

/** A bundle the person chose to bring in. */
export interface ChosenBundle {
  readonly name: string;
  readonly bytes: PageBytes;
}

/** How files and folders pass between AudioGubbins and the person. */
export interface TransferFiles {
  /** Where a file of `mediaType` is saved, suggested as `name`, or nothing where dismissed. */
  save(name: string, mediaType: string): Promise<SaveTarget | undefined>;

  /** A bundle to bring in, or nothing where dismissed. */
  chooseBundle(): Promise<ChosenBundle | undefined>;

  /** A folder holding an unpacked project, or nothing where dismissed. */
  chooseFolderToRead(): Promise<PageFolder | undefined>;

  /** A folder to write an unpacked project into, absent where the browser gives none. */
  readonly chooseFolderToWrite: (() => Promise<ChosenFolder | undefined>) | undefined;

  /** One audio file, kept to be found again where the browser can, or nothing where dismissed. */
  chooseMediaFile(): Promise<PageFile | undefined>;

  /**
   * Any number of audio files, each kept to be found again where the browser
   * can, in the order the person chose them; none where dismissed.
   */
  chooseMediaFiles(): Promise<readonly PageFile[]>;

  /**
   * Every file of a folder and of the folders inside it, each kept to be found
   * again where the browser can, in the order of where they lie inside it;
   * none where dismissed. Files of any kind are handed on, so the import says
   * of each file that is not audio why it was not brought in.
   */
  chooseMediaFolder(): Promise<readonly PageFile[]>;
}

/** What a picker offers for a bundle. */
const BUNDLE_ACCEPT = '.zip,application/zip';

/** What the input offers for audio. */
const AUDIO_ACCEPT = 'audio/*';

/** Orders paths as a person reads them, "Take 2" before "Take 10". */
const PATH_ORDER = new Intl.Collator('en-GB', { numeric: true });

/** A folder's files, in the order of where they lie inside it, as the page lends them. */
function folderFiles(files: readonly ChosenFile[]): readonly PageFile[] {
  return files
    .toSorted((one, other) => PATH_ORDER.compare(one.relativePath ?? '', other.relativePath ?? ''))
    .map(pageFileOf);
}

/** A file chosen through the input, as a bundle. */
function bundleOf(files: readonly File[]): ChosenBundle | undefined {
  const [file] = files;
  return file === undefined ? undefined : { name: file.name, bytes: { kind: 'file', file } };
}

/** The files a folder input gave, each by where it lies inside the folder chosen. */
function folderOf(files: readonly File[]): PageFolder | undefined {
  const inside: FolderFile[] = [];
  for (const { file, relativePath } of filesFromInput(files)) {
    if (relativePath !== undefined) inside.push({ path: relativePath, file });
  }
  return files.length === 0 ? undefined : { kind: 'files', files: inside };
}

/** A sink that gathers the file, and offers it as a download once it has closed. */
function downloadTarget(name: string, mediaType: string): SaveTarget {
  const sink = new BlobSink(mediaType);
  return {
    sink,
    name,
    finish: () => {
      offerDownload(sink.blob(), name);
    },
  };
}

/** The files the picker gave, one or `multiple`, or none where the person dismissed it. */
async function pickedFiles(
  pickers: FilePickers,
  keeper: FileHandleKeeper | undefined,
  multiple: boolean,
): Promise<readonly ChosenFile[]> {
  const picked = await pickFiles(pickers.openFiles, keeper, { multiple });
  return picked.kind === 'cancelled' ? [] : picked.chosen;
}

/** Every file of the folder the picker gave, each handle kept, or none where dismissed. */
async function pickedFolderFiles(
  pickers: FilePickers,
  keeper: FileHandleKeeper | undefined,
): Promise<readonly ChosenFile[]> {
  const picked = await pickDirectory(pickers.openDirectory, 'read');
  if (picked.kind === 'cancelled') return [];
  const found: ChosenFile[] = [];
  for await (const file of filesInDirectory(picked.chosen, keeper)) found.push(file);
  return found;
}

/** The browser's way of passing files, with the pickers where it has them. */
export function browserTransferFiles(
  pickers: FilePickers | undefined,
  keeper: FileHandleKeeper | undefined,
): TransferFiles {
  return {
    save: async (name, mediaType) => {
      if (pickers === undefined) return downloadTarget(name, mediaType);
      const picked = await pickSaveFile(pickers.saveFile, name);
      if (picked.kind === 'cancelled') return undefined;
      return {
        sink: await openFileSink(picked.chosen),
        name: picked.chosen.name,
        finish: () => undefined,
      };
    },
    chooseBundle: async () => bundleOf(await chooseThroughInput({ accept: BUNDLE_ACCEPT })),
    chooseFolderToRead: async () => folderOf(await chooseThroughInput({ folder: true })),
    chooseFolderToWrite:
      pickers === undefined
        ? undefined
        : async () => {
            const picked = await pickDirectory(pickers.openDirectory, 'readwrite');
            return picked.kind === 'cancelled'
              ? undefined
              : { writer: writableFolder(picked.chosen), name: picked.chosen.name };
          },
    chooseMediaFile: async () => {
      const [chosen] =
        pickers === undefined
          ? filesFromInput(await chooseThroughInput({ accept: AUDIO_ACCEPT }))
          : await pickedFiles(pickers, keeper, false);
      return chosen === undefined ? undefined : pageFileOf(chosen);
    },
    chooseMediaFiles: async () => {
      const chosen =
        pickers === undefined
          ? filesFromInput(await chooseThroughInput({ accept: AUDIO_ACCEPT, multiple: true }))
          : await pickedFiles(pickers, keeper, true);
      return chosen.map(pageFileOf);
    },
    chooseMediaFolder: async () =>
      folderFiles(
        pickers === undefined
          ? filesFromInput(await chooseThroughInput({ folder: true }))
          : await pickedFolderFiles(pickers, keeper),
      ),
  };
}
