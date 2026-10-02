/**
 * Media or a cache read out of the store proved to be the bytes its identity
 * names, as it is read (REQ-STOR-099, REQ-STOR-103, REQ-EXEC-216).
 *
 * The stores check an object's or a cache's length when they open it, not its
 * bytes, so one damaged in place since it was kept would be copied out as
 * though whole, into a bundle or a tree that could then never be brought in
 * again. Every copy out reads each once, from its start to its end, so the
 * bytes are hashed as they pass, in the content construction's chunks, and the
 * read that completes them is refused, with the failure naming them, where they
 * are not the bytes their identity names: what was written of them is then
 * abandoned with the rest of the copy. Proving costs one digest of each byte
 * copied, through the platform's native digest, and no read beyond the copy's
 * own.
 */

import { fail, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';
import {
  contentIdOf,
  createContentHasher,
  type ByteSource,
  type ContentId,
  type Digest,
} from '@audiogubbins/project-format';

import { bytesSource } from './byte-streams.js';
import { CarriedFailure } from './storage-failures.js';

/**
 * `source`, the bytes named `contentId`, refusing with `refusal` the read that
 * completes them where they are not those bytes. It is read once, in order,
 * from its start: reading it any other way is a programmer error.
 */
export async function provedBytes(
  source: ByteSource,
  contentId: ContentId,
  digest: Digest,
  refusal: DomainFailure,
): Promise<DomainResult<ByteSource>> {
  // Nothing is read of no bytes, so they are proved at once.
  if (source.size === 0) {
    const empty = await contentIdOf(bytesSource(new Uint8Array(0)), digest);
    return empty.ok && empty.value.contentId === contentId ? succeed(source) : fail(refusal);
  }
  const hasher = createContentHasher(digest);
  let reached = 0;
  return succeed({
    size: source.size,
    read: async (offset, length, signal) => {
      if (offset !== reached) {
        throw new Error('Bytes being proved are read once, in order, from their start.');
      }
      const bytes = await source.read(offset, length, signal);
      reached += bytes.length;
      await hasher.update(bytes);
      if (bytes.length === length && reached === source.size) {
        const { contentId: found } = await hasher.finish();
        if (found !== contentId) throw new CarriedFailure(refusal);
      }
      return bytes;
    },
  });
}
