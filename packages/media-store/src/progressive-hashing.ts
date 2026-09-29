/**
 * Hashing a large file in the background without taking the interface with it
 * (REQ-STOR-104, REQ-EXEC-216).
 *
 * The full content identity of a long recording takes seconds to compute. The
 * work is already cut into the content construction's chunks, each digested by
 * the platform, so between two chunks the hashing hands control back to the
 * host through the injected {@link YieldToHost}, and a caller on the main
 * thread stays responsive. How often to really yield is the host's decision:
 * its function may resolve at once until a frame's budget is spent.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import {
  createContentHasher,
  type ByteSource,
  type ContentIdentity,
  type Digest,
  type HashingOptions,
} from '@audiogubbins/project-format';

import { forEachChunk } from './chunk-reading.js';

/** Lets the host run whatever it has waiting, resolving when hashing may go on. */
export type YieldToHost = () => Promise<void>;

/**
 * The content identity of every byte of `source`, yielding to the host after
 * each chunk. Fails with `media.source-changed` where a read comes back short,
 * and rejects with the signal's reason on abort.
 */
export async function hashProgressively(
  source: ByteSource,
  digest: Digest,
  yieldToHost: YieldToHost,
  options: HashingOptions = {},
): Promise<DomainResult<ContentIdentity>> {
  const hasher = createContentHasher(digest);
  const read = await forEachChunk(
    source,
    async (chunk) => {
      await hasher.update(chunk);
      await yieldToHost();
    },
    { signal: options.signal, onChunk: options.onProgress },
  );
  return read.ok ? succeed(await hasher.finish()) : read;
}
