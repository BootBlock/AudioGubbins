/**
 * A file the user chose, as the browser handed it to the page: the file itself,
 * what it says about itself, the handle it came through and the key that handle
 * is kept under where it came through one, and where it lies in a folder the
 * user chose where it came from one (REQ-STOR-104).
 *
 * Two ways in. A handle from a picker or a kept one, which Chromium gives; and
 * a `File` from the page's own file input, which every browser gives, where no
 * handle exists and the file cannot be found again after a reload. Either way
 * the file is handed on as itself, with its handle where it has one, since both
 * clone: whatever reads it, the storage worker among them, reads it where it
 * is, through a source that notices a change (`file-source.ts`), rather than
 * through the page.
 */

import type { ExternalFile } from '@audiogubbins/media-store';

/** A file the user chose (see the module comment). */
export type ChosenFile = Omit<ExternalFile, 'source'> & {
  readonly file: File;

  /** The handle the file came through, which tells a reader whether it changed since. */
  readonly handle?: FileSystemFileHandle;
};

/** The file a handle names, as it was chosen. */
export async function chosenFileOf(
  handle: FileSystemFileHandle,
  handleKey: string | undefined,
  relativePath: string | undefined,
): Promise<ChosenFile> {
  const file = await handle.getFile();
  return {
    file,
    handle,
    fileName: file.name,
    mediaType: file.type,
    lastModified: file.lastModified,
    ...(handleKey === undefined ? {} : { handleKey }),
    ...(relativePath === undefined ? {} : { relativePath }),
  };
}

/**
 * Where a file from a folder input lies inside the folder the user chose.
 *
 * The browser writes the chosen folder's own name first, and a relative path is
 * inside the folder, so that name is left out; a file chosen alone has none at
 * all.
 */
function relativePathOf(file: File): string | undefined {
  const inside = file.webkitRelativePath.split('/').slice(1).join('/');
  return inside === '' ? undefined : inside;
}

/** The files the page's file input was given, as they were chosen. */
export function filesFromInput(files: Iterable<File>): readonly ChosenFile[] {
  return Array.from(files, (file) => {
    const relativePath = relativePathOf(file);
    return {
      file,
      fileName: file.name,
      mediaType: file.type,
      lastModified: file.lastModified,
      ...(relativePath === undefined ? {} : { relativePath }),
    };
  });
}
