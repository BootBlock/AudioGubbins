/**
 * A file read synchronously, offered through the read contract's
 * asynchronous port, so the codecs' recognition and metadata readers read the
 * same file the codec module decodes, through the same reads (ADR-0090).
 *
 * In a dedicated worker a synchronous read is allowed and as fast as it gets,
 * so each read is answered at once. A read that throws, as a file removed or
 * withdrawn since it was chosen does, rejects with `SourceUnreadable` naming
 * what was thrown, never its message, which may name the file's path; a
 * caller tells it apart from a fault by its class.
 */

import type { AudioBytes, SyncAudioBytes } from '@audiogubbins/codecs';
import { throwIfCancelled } from '@audiogubbins/domain';

import { thrownName } from '../thrown-name.js';

/** A read of the file that threw. */
export class SourceUnreadable extends Error {
  /** The name of what the read threw, such as `NotReadableError`. */
  readonly thrown: string;

  constructor(thrown: string) {
    super('The file could not be read.');
    this.name = 'SourceUnreadable';
    this.thrown = thrown;
  }
}

/** `bytes` through the asynchronous port. */
export function asyncAudioBytes(bytes: SyncAudioBytes): AudioBytes {
  return {
    size: bytes.size,
    read: (offset, length, signal) => {
      throwIfCancelled(signal);
      const into = new Uint8Array(Math.max(0, Math.min(length, bytes.size - offset)));
      let copied: number;
      try {
        copied = bytes.readInto(offset, into);
      } catch (error) {
        // A file removed, or whose permission was withdrawn, throws; anything
        // the read throws is the file being unreadable, said by its name.
        return Promise.reject(new SourceUnreadable(thrownName(error)));
      }
      return Promise.resolve(into.subarray(0, copied));
    },
  };
}
