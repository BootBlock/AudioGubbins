/**
 * A file the user chose, as the media store takes it: its bytes as a byte
 * source that notices a change (`file-source.ts`), what it says about itself,
 * the key its handle is kept under where it came through a handle, and where it
 * lies in a folder the user chose where it came from one (REQ-STOR-104).
 *
 * Two ways in. A handle from a picker or a kept one, which Chromium gives; and
 * a `File` from the page's own file input, which every browser gives, where no
 * handle exists and the file cannot be found again after a reload.
 */

import type { ExternalFile } from '@audiogubbins/media-store';

import { fileSource } from './file-source.js';

/** The file a handle names, as the media store takes it. */
export async function externalFileOf(
  handle: FileSystemFileHandle,
  handleKey: string | undefined,
  relativePath: string | undefined,
): Promise<ExternalFile> {
  const file = await handle.getFile();
  return {
    source: fileSource(file, () => handle.getFile()),
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

/** The files the page's file input was given, as the media store takes them. */
export function filesFromInput(files: Iterable<File>): readonly ExternalFile[] {
  return Array.from(files, (file) => {
    const relativePath = relativePathOf(file);
    return {
      source: fileSource(file),
      fileName: file.name,
      mediaType: file.type,
      lastModified: file.lastModified,
      ...(relativePath === undefined ? {} : { relativePath }),
    };
  });
}
