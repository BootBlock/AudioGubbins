/**
 * A file in memory, read synchronously, as the codec worker reads one from
 * disk: the port a decode session reads through, for a test to drive.
 */

import type { SyncAudioBytes } from '@audiogubbins/codecs';

/** `bytes` as a file, every read of which `reads` records. */
export function memoryBytes(bytes: Uint8Array, reads?: number[]): SyncAudioBytes {
  return {
    size: bytes.length,
    readInto: (offset, into) => {
      reads?.push(offset);
      const available = bytes.subarray(offset, offset + into.length);
      into.set(available);
      return available.length;
    },
  };
}
