/**
 * What this package's own tests hash with and run in: SHA-256 through Node's
 * Web Crypto, as the browser's would be injected, and the harness over it.
 *
 * Kept apart from the test support other packages take, which never reaches a
 * Node module, so that support compiles wherever the package's entry points do.
 */

import { webcrypto } from 'node:crypto';

import type { Digest } from '@audiogubbins/project-format';

import { harnessOver, type Harness } from './storage-harness.js';

/** SHA-256 through Node's Web Crypto. */
export const nodeDigest: Digest = async (bytes) =>
  new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));

/** A harness hashing with {@link nodeDigest}, whose identifiers come from `seed`. */
export function harness(seed?: number): Harness {
  return harnessOver(nodeDigest, seed);
}
