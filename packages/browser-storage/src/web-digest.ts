/**
 * The SHA-256 digest content identities are taken with, through the browser's
 * own Web Crypto (ADR-0020), which the capabilities package reads and passes
 * in. Native, so a chunk of media is hashed at the platform's speed and without
 * a copy.
 */

import type { Digest } from '@audiogubbins/project-format';

/** The digest port, over the browser's `SubtleCrypto`. */
export function webDigest(subtle: SubtleCrypto): Digest {
  return async (bytes) => new Uint8Array(await subtle.digest('SHA-256', bytes));
}
