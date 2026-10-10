/**
 * A file read synchronously, offered through the read contract's asynchronous
 * port, so the codecs' recognition and metadata readers read the same file the
 * codec module decodes, through the same reads (ADR-0090).
 *
 * In a dedicated worker a synchronous read is allowed and as fast as it gets,
 * so each read is answered at once. A read that throws, as a file removed or
 * withdrawn since it was chosen does, rejects with `SourceUnreadable` naming
 * what was thrown, never its message, which may name the file's path; a
 * caller tells it apart from a fault by its class.
 */

import type { AudioBytes, SyncAudioBytes } from '@audiogubbins/codecs';
import { throwIfCancelled, type CancellationSignal } from '@audiogubbins/domain';

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

/** Reads `length` bytes at `offset` now, throwing as the port's read rejects. */
function readNow(
  bytes: SyncAudioBytes,
  offset: number,
  length: number,
  signal: CancellationSignal | undefined,
): Uint8Array {
  throwIfCancelled(signal);
  const into = new Uint8Array(Math.max(0, Math.min(length, bytes.size - offset)));
  let copied: number;
  try {
    copied = bytes.readInto(offset, into);
  } catch (error) {
    // A file removed, or whose permission was withdrawn, throws; anything the
    // read throws is the file being unreadable, said by its name.
    throw new SourceUnreadable(thrownName(error));
  }
  return into.subarray(0, copied);
}

/**
 * `bytes` through the asynchronous port, each read answered at once, a read
 * that throws or is cancelled rejecting as the port's reads do.
 */
export function asyncAudioBytes(bytes: SyncAudioBytes): AudioBytes {
  return {
    size: bytes.size,
    read: (offset, length, signal) =>
      new Promise((resolve) => {
        resolve(readNow(bytes, offset, length, signal));
      }),
  };
}
