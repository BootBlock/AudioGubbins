/**
 * The length and SHA-256 of a file, read as a stream, so a model of hundreds
 * of megabytes is hashed without being held in memory.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * @typedef {object} Digest
 * @property {number} bytes
 * @property {string} sha256 64 lower-case hexadecimal digits
 */

/**
 * The digest of the file at `path`.
 *
 * @param {string} path
 * @param {AbortSignal} [signal]
 * @returns {Promise<Digest>}
 */
export async function digestOf(path, signal) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path, signal === undefined ? {} : { signal })) {
    const buffer = /** @type {Buffer} */ (chunk);
    hash.update(buffer);
    bytes += buffer.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}
