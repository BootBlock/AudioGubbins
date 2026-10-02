/**
 * Media read out of the store proved to be the media its identity names, as it
 * is read (REQ-STOR-099, REQ-STOR-103, REQ-EXEC-216).
 *
 * The store checks an object's length when it opens it, not its bytes, so an
 * object damaged in place since it was stored would be copied out as though
 * whole, into a bundle or a tree that could then never be brought in again.
 * Every copy out reads each object once, from its start to its end, so the
 * bytes are hashed as they pass, in the content construction's chunks, and the
 * read that completes the object is refused, with the failure naming it, where
 * they are not the bytes its identity names: what was written of it is then
 * abandoned with the rest of the copy. Proving costs one digest of each byte
 * copied, through the platform's native digest, and no read beyond the copy's
 * own.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  contentIdOf,
  createContentHasher,
  type ByteSource,
  type ContentId,
  type Digest,
} from '@audiogubbins/project-format';

import { bytesSource } from './byte-streams.js';
import { CarriedFailure, mediaDamaged } from './storage-failures.js';

/**
 * `source`, the media named `contentId` kept at `path` of the tree being
 * copied, refusing the read that completes it where its bytes are not that
 * media's. It is read once, in order, from its start: reading it any other way
 * is a programmer error.
 */
export async function provedMedia(
  source: ByteSource,
  contentId: ContentId,
  path: string,
  digest: Digest,
): Promise<DomainResult<ByteSource>> {
  // Nothing is read of media of no bytes, so it is proved at once.
  if (source.size === 0) {
    const empty = await contentIdOf(bytesSource(new Uint8Array(0)), digest);
    return empty.ok && empty.value.contentId === contentId
      ? succeed(source)
      : fail(mediaDamaged(path, contentId));
  }
  const hasher = createContentHasher(digest);
  let reached = 0;
  return succeed({
    size: source.size,
    read: async (offset, length, signal) => {
      if (offset !== reached) {
        throw new Error('Media being proved is read once, in order, from its start.');
      }
      const bytes = await source.read(offset, length, signal);
      reached += bytes.length;
      await hasher.update(bytes);
      if (bytes.length === length && reached === source.size) {
        const { contentId: found } = await hasher.finish();
        if (found !== contentId) throw new CarriedFailure(mediaDamaged(path, contentId));
      }
      return bytes;
    },
  });
}
