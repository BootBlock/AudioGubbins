/**
 * A file the user chose, read in ranges, and never trusted to stay the file it
 * was (REQ-EXEC-216: external files do not remain unchanged).
 *
 * The byte-source port says what a change looks like to a reader: a read that
 * returns other than the bytes asked for, which the media store reports as its
 * designed `media.source-changed` failure (REQ-EXEC-136.15). So a change comes
 * back as an empty read rather than an exception the store would take for a
 * defect. It is seen two ways. Where the file came through a handle, the file
 * is looked at again before each read, and a size or modification time that
 * differs from the one chosen is a change. Whatever it came through, the
 * browser refuses to read a `File` whose file has changed or gone under it,
 * which Chromium does with `NotReadableError` and a file gone with
 * `NotFoundError`. A change that keeps the size and the time and that the
 * browser does not notice is left to the identity's fingerprints
 * (REQ-STOR-104).
 */

import type { ByteSource } from '@audiogubbins/project-format';

/** The names with which a browser refuses to read a file that changed or went. */
const CHANGED_UNDER_IT: ReadonlySet<string> = new Set(['NotReadableError', 'NotFoundError']);

/**
 * The file's bytes, in ranges, as a byte source. `current` is given where the
 * file came through a handle, and answers the file as the handle finds it now.
 */
export function fileSource(file: File, current?: () => Promise<File>): ByteSource {
  const unchanged = async (): Promise<boolean> => {
    if (current === undefined) return true;
    const now = await current();
    return now.size === file.size && now.lastModified === file.lastModified;
  };
  return {
    size: file.size,
    read: async (offset, length, signal) => {
      signal?.throwIfAborted();
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0) {
        throw new RangeError('A range is read from a whole offset for a whole length.');
      }
      try {
        if (!(await unchanged())) return new Uint8Array(0);
        const bytes = await file.slice(offset, offset + Math.max(0, length)).arrayBuffer();
        signal?.throwIfAborted();
        return new Uint8Array(bytes);
      } catch (error) {
        if (error instanceof DOMException && CHANGED_UNDER_IT.has(error.name)) {
          return new Uint8Array(0);
        }
        throw error;
      }
    },
  };
}
