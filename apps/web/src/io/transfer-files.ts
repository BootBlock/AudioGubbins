/**
 * Handing a project, or the stored data, to the person as a file or a folder,
 * and taking a project or a file from them (REQ-STOR-052, REQ-STOR-099,
 * REQ-STOR-103, REQ-STOR-053).
 *
 * A port, so every project flow is tested without a browser (REQ-EXEC-136.4).
 * The browser's side asks through the pickers where the browser has them, which
 * write a file as it is made rather than holding it whole, and through the
 * page's own file input and a download everywhere else. Folders are read
 * through the input in every browser, and written only through the directory
 * picker, which alone gives a folder to write into. Each chooser is opened as
 * the first thing the flow does, in the handler of the person's gesture, since
 * a browser opens none outside one.
 */

import {
  BlobSink,
  filesFromInput,
  listedFolder,
  openFileSink,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  writableFolder,
  type FileHandleKeeper,
} from '@audiogubbins/browser-storage';
import type { FilePickers } from '@audiogubbins/capabilities';
import type { ExternalFile } from '@audiogubbins/media-store';
import type { ByteSink, ByteSource } from '@audiogubbins/project-format';
import type { DirectoryReader, DirectoryWriter } from '@audiogubbins/storage';

import { offerDownload } from './download.js';
import { chooseThroughInput } from './file-input.js';

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
  readonly source: ByteSource;
}

/** How files and folders pass between AudioGubbins and the person. */
export interface TransferFiles {
  /** Where a file of `mediaType` is saved, suggested as `name`, or nothing where dismissed. */
  save(name: string, mediaType: string): Promise<SaveTarget | undefined>;

  /** A bundle to bring in, or nothing where dismissed. */
  chooseBundle(): Promise<ChosenBundle | undefined>;

  /** A folder holding an unpacked project, or nothing where dismissed. */
  chooseFolderToRead(): Promise<DirectoryReader | undefined>;

  /** A folder to write an unpacked project into, absent where the browser gives none. */
  readonly chooseFolderToWrite: (() => Promise<ChosenFolder | undefined>) | undefined;

  /** One audio file, kept to be found again where the browser can, or nothing where dismissed. */
  chooseMediaFile(): Promise<ExternalFile | undefined>;
}

/** What a picker offers for a bundle. */
const BUNDLE_ACCEPT = '.zip,application/zip';

/** A file chosen through the input, as a bundle. */
function bundleOf(files: readonly File[]): ChosenBundle | undefined {
  const [file] = files;
  const [external] = filesFromInput(files);
  return file === undefined || external === undefined
    ? undefined
    : { name: file.name, source: external.source };
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
    chooseFolderToRead: async () => {
      const files = await chooseThroughInput({ folder: true });
      return files.length === 0 ? undefined : listedFolder(filesFromInput(files));
    },
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
      if (pickers === undefined) {
        return filesFromInput(await chooseThroughInput({ accept: 'audio/*' }))[0];
      }
      const picked = await pickFiles(pickers.openFiles, keeper, { multiple: false });
      return picked.kind === 'cancelled' ? undefined : picked.chosen[0];
    },
  };
}
