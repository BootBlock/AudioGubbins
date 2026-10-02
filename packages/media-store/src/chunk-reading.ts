/**
 * Reading a source one chunk at a time, so no file is ever whole in memory
 * (REQ-EXEC-216).
 *
 * Every pass over media bytes in this package reads through here: receiving an
 * import, storing it under its name, and hashing an external file in the
 * background. The chunk is the content construction's, so the content hasher
 * digests each where it lies rather than copying it. A read that returns other
 * than the bytes asked for is the designed `media.source-changed` failure
 * (REQ-EXEC-136.15), and an abort rejects with the signal's reason, as the
 * source's own read does.
 */

import { succeed, fail, type DomainResult } from '@audiogubbins/domain';
import { CONTENT_CHUNK_BYTES, type ByteSource } from '@audiogubbins/project-format';

import { sourceChanged } from './media-failures.js';

/** What a pass over a source may be told. */
export interface ChunkReadingOptions {
  readonly signal?: AbortSignal | undefined;

  /** Called after each chunk is taken, with the bytes taken so far and the total. */
  readonly onChunk?: ((done: number, total: number) => void) | undefined;
}

/** Hands every byte of `source` to `take`, in order, one chunk at a time. */
export async function forEachChunk(
  source: ByteSource,
  take: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>,
  options: ChunkReadingOptions = {},
): Promise<DomainResult<undefined>> {
  const { signal, onChunk } = options;
  const total = checkedSize(source);
  for (let offset = 0; offset < total; offset += CONTENT_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const length = Math.min(CONTENT_CHUNK_BYTES, total - offset);
    const chunk = await source.read(offset, length, signal);
    if (chunk.length !== length) return fail(sourceChanged(offset, length, chunk.length));
    await take(chunk);
    onChunk?.(offset + length, total);
  }
  signal?.throwIfAborted();
  return succeed(undefined);
}

/** A source's size, refused as a programmer error where it is not a byte count. */
export function checkedSize(source: ByteSource): number {
  if (!Number.isSafeInteger(source.size) || source.size < 0) {
    throw new RangeError('A byte source reports its size as a whole number of bytes.');
  }
  return source.size;
}
