/**
 * Exact ranged reads of a file's bytes, and the field readers a header parse
 * uses on them.
 *
 * Every read in this package passes through `readExactly`, so a source that
 * answers short within its size is the designed `codecs.source-changed` failure
 * wherever it happens, and every await checks the signal on both sides. The
 * header source keeps the first bytes recognition read, so a header that lies
 * within them is not read twice.
 */

import {
  fail,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { sourceChanged } from './codec-failures.js';

/**
 * Reads exactly `length` bytes at `offset`, a range the caller has bounded
 * within the file's size, so any other answer means the file changed.
 */
export async function readExactly(
  bytes: AudioBytes,
  offset: number,
  length: number,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<Uint8Array>> {
  throwIfCancelled(signal);
  const answer = await bytes.read(offset, length, signal);
  throwIfCancelled(signal);
  return answer.length === length
    ? succeed(answer)
    : fail(sourceChanged(offset, length, answer.length));
}

/** A file's bytes, with the first of them already read. */
export class HeaderSource {
  readonly size: number;
  private readonly bytes: AudioBytes;
  private readonly head: Uint8Array;

  constructor(bytes: AudioBytes, head: Uint8Array) {
    this.bytes = bytes;
    this.head = head;
    this.size = bytes.size;
  }

  /** Reads exactly `length` bytes at `offset`, from the head where it holds them. */
  async read(
    offset: number,
    length: number,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<Uint8Array>> {
    if (offset + length <= this.head.length) {
      throwIfCancelled(signal);
      return succeed(this.head.subarray(offset, offset + length));
    }
    return await readExactly(this.bytes, offset, length, signal);
  }
}

/** A view of the bytes for reading fields of either byte order. */
export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The four-character code at `offset`, each byte one character. */
export function fourCharacterCode(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
