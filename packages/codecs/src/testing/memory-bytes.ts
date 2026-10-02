/**
 * Audio bytes held in memory, which record what they were asked for.
 *
 * A test reads a generated file through these, so it can count the bytes a
 * reader asks for and prove a bound on them, and can answer a read short or
 * cancel the work in the middle of one to drive the paths a real file reaches
 * only when it changes or a person gives up.
 */

import type { AudioBytes } from '../audio-bytes.js';

/** One read a reader asked for. */
export interface ReadRequest {
  readonly offset: number;
  readonly length: number;
}

/** Audio bytes in memory and the reads asked of them. */
export interface MemoryBytes extends AudioBytes {
  /** Every read asked for, in order. */
  readonly requests: readonly ReadRequest[];

  /** The bytes asked for over every read. */
  readonly bytesRequested: number;
}

/** How the bytes answer a read. */
export interface MemoryBytesOptions {
  /**
   * Answers a read in place of the honest answer: shorter, to stand for a file
   * that changed, or after cancelling the reader's signal.
   */
  readonly answer?: (request: ReadRequest, honest: Uint8Array) => Uint8Array;
}

/**
 * Bytes in memory as a reader takes them: each read answers a copy of the range
 * within the file, short only where the range runs past its end.
 */
export function memoryBytes(bytes: Uint8Array, options: MemoryBytesOptions = {}): MemoryBytes {
  const requests: ReadRequest[] = [];
  let bytesRequested = 0;
  return {
    size: bytes.length,
    requests,
    get bytesRequested() {
      return bytesRequested;
    },
    read: async (offset, length) => {
      // A real source answers later, so a reader never relies on a read resolving at once.
      await Promise.resolve();
      const request = { offset, length };
      requests.push(request);
      bytesRequested += length;
      const honest = bytes.slice(offset, Math.min(offset + length, bytes.length));
      return options.answer === undefined ? honest : options.answer(request, honest);
    },
  };
}
