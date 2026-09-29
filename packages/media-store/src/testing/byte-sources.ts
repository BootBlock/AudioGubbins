/**
 * Byte sources and tokens for tests of media stored through a tree.
 *
 * A generated source makes each range's bytes when it is read, from the offset
 * and a seed, so a test can stream a file larger than several chunks and prove
 * that nothing read it whole: the source never holds it either.
 */

import type { ByteSource } from '@audiogubbins/project-format';

/** A source that reports what it was asked for. */
export interface ObservedSource extends ByteSource {
  /** The longest range read in one call. */
  readonly largestRead: number;

  /** Every byte handed out, over every read. */
  readonly bytesRead: number;
}

/** A source over bytes in memory. */
export function memorySource(bytes: Uint8Array): ObservedSource {
  return observed(bytes.length, (offset, length) =>
    bytes.slice(offset, Math.min(offset + length, bytes.length)),
  );
}

/** A source of `size` bytes made as they are read, alike for alike seeds. */
export function generatedSource(size: number, seed: number): ObservedSource {
  return observed(size, (offset, length) => generatedBytes(offset, length, seed));
}

/** The bytes a generated source of this seed holds at the range. */
export function generatedBytes(
  offset: number,
  length: number,
  seed: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.imul((offset + index) ^ seed, 0x9e3779b1) >>> 24;
  }
  return bytes;
}

/** Tokens `t1`, `t2` and on, one for each call. */
export function countingTokens(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `t${String(next)}`;
  };
}

function observed(
  size: number,
  bytesAt: (offset: number, length: number) => Uint8Array,
): ObservedSource {
  let largestRead = 0;
  let bytesRead = 0;
  return {
    size,
    get largestRead() {
      return largestRead;
    },
    get bytesRead() {
      return bytesRead;
    },
    read: async (offset, length, signal) => {
      await Promise.resolve();
      signal?.throwIfAborted();
      const bytes = Uint8Array.from(bytesAt(offset, Math.max(0, Math.min(length, size - offset))));
      largestRead = Math.max(largestRead, length);
      bytesRead += bytes.length;
      return bytes;
    },
  };
}
