/**
 * Moving bytes between the ports without holding them whole: bytes in memory as
 * a source, and a source streamed into a sink a chunk at a time (REQ-EXEC-216).
 *
 * A media file or a cache may be larger than memory, so it is only ever read in
 * chunks of the content construction's size and written as it is read. A sink
 * that could not be written whole is abandoned rather than closed, so part of a
 * file is never kept as the whole of it.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { CONTENT_CHUNK_BYTES, type ByteSink, type ByteSource } from '@audiogubbins/project-format';

/** Bytes already in memory, as a source read in views rather than copies. */
export function bytesSource(bytes: Uint8Array<ArrayBuffer>): ByteSource {
  return {
    size: bytes.length,
    read: (offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)),
  };
}

/**
 * Streams every byte of `source` into `sink` and closes it. Fails, having
 * abandoned the sink, where the source gives other than the bytes asked for;
 * rejects, having abandoned it too, where a read, a write or the signal does.
 */
export async function streamInto(
  source: ByteSource,
  sink: ByteSink,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  try {
    for (let offset = 0; offset < source.size; offset += CONTENT_CHUNK_BYTES) {
      signal?.throwIfAborted();
      const length = Math.min(CONTENT_CHUNK_BYTES, source.size - offset);
      const chunk = await source.read(offset, length, signal);
      if (chunk.length !== length) {
        const changed = sourceChanged(offset);
        await sink.abort(changed);
        return fail(changed);
      }
      await sink.write(chunk);
    }
  } catch (error: unknown) {
    // Whatever failed, the sink holds part of the file: abandon it before
    // passing the failure on.
    await sink.abort(error);
    throw error;
  }
  await sink.close();
  return succeed(undefined);
}

function sourceChanged(offset: number) {
  return failure(
    'storage.source-changed',
    FailureKind.IntegrityViolation,
    'The bytes being copied changed or vanished while they were read.',
    { details: { offset } },
  );
}
