/**
 * A file an edited source reads its audio from, as it crosses a thread.
 *
 * The page hands each audio thread the file behind an asset (ADR-0052): a
 * stored object's snapshot from the origin-private file system, or a linked
 * file the person chose. A browser file crosses a thread as itself and reads
 * a range when asked, so every thread reads the bytes it needs and none holds
 * the file. The engine runs where no browser types are compiled, so it names
 * only the two members it reads, which a browser `Blob` has.
 */

import { throwIfCancelled } from '@audiogubbins/domain';
import type { AudioBytes } from '@audiogubbins/codecs';

/** A file whose ranges can be read: a browser `Blob` or `File`, or a test's stand-in. */
export interface MediaFile {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** Whether a value that crossed a thread is a file the engine can read. */
export function isMediaFile(value: unknown): value is MediaFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'size') === 'number' &&
    typeof Reflect.get(value, 'slice') === 'function'
  );
}

/**
 * The file as the read contract's bytes. A browser read cannot be stopped once
 * begun, so cancellation is honoured before it starts and when it ends.
 */
export function mediaBytes(file: MediaFile): AudioBytes {
  return {
    size: file.size,
    read: async (offset, length, signal) => {
      throwIfCancelled(signal);
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
      throwIfCancelled(signal);
      return bytes;
    },
  };
}
