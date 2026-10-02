/**
 * The digest this package's tests hash with: SHA-256 through Node's Web
 * Crypto, as the browser's would be injected.
 *
 * Kept apart from the test support other packages take, which never reaches a
 * Node module, so it compiles wherever the package's entry points do.
 */

import { webcrypto } from 'node:crypto';

import type { Digest } from '../byte-ports.js';

/** SHA-256 through Node's Web Crypto. */
export const nodeDigest: Digest = async (bytes) =>
  new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
