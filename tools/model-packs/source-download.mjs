/**
 * The download of a pack's source, and the one module of the pack build that
 * reaches the network.
 *
 * It asks for one URL, a pinned release or commit that a definition names,
 * with no credential and no header but `Range`, and writes the body to a file
 * as it arrives: a source is up to a few hundred megabytes, so it is never
 * held in memory. A transfer that stopped resumes from the bytes already on
 * disk where the server honours `Range`, and starts again where it does not.
 * The length is held to the definition's as the bytes arrive, so a source
 * longer than stated is stopped rather than written whole; the caller checks
 * the SHA-256 once the transfer is done.
 */

import { createWriteStream } from 'node:fs';
import { stat, truncate } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** `bytes <first>-<last>/<length>`, as a partial response states its range. */
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/u;

const HTTP_OK = 200;
const HTTP_PARTIAL = 206;

/**
 * Fetches `url` into the file at `path`, resuming from what the file already
 * holds, until it holds `bytes` bytes.
 *
 * @param {string} url an `https:` URL
 * @param {string} path
 * @param {number} bytes the length the definition states
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function downloadTo(url, path, bytes, signal) {
  if (new URL(url).protocol !== 'https:') throw new Error(`${url} is not an https URL.`);
  const kept = await keptLength(path, bytes);
  const response = await fetch(url, {
    headers: kept > 0 ? { Range: `bytes=${String(kept)}-` } : {},
    credentials: 'omit',
    redirect: 'follow',
    ...(signal === undefined ? {} : { signal }),
  });
  // A release asset redirects to a content host; that host must be https too.
  if (new URL(response.url).protocol !== 'https:') {
    throw new Error(`${url} redirected to a URL that is not https.`);
  }

  let offset;
  if (kept > 0 && response.status === HTTP_PARTIAL) {
    if (!isRangeAsked(response.headers.get('Content-Range'), kept, bytes)) {
      throw new Error(`${url} answered a resumed request with another range.`);
    }
    offset = kept;
  } else if (response.status === HTTP_OK) {
    offset = 0;
  } else {
    throw new Error(`${url} answered with status ${String(response.status)}.`);
  }
  if (response.body === null) throw new Error(`${url} answered with no body.`);

  let received = offset;
  const bounded = new Transform({
    transform(chunk, _encoding, done) {
      received += /** @type {Buffer} */ (chunk).length;
      if (received > bytes) {
        done(new Error(`${url} is longer than the ${String(bytes)} bytes its definition states.`));
        return;
      }
      done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    bounded,
    createWriteStream(path, { flags: offset > 0 ? 'a' : 'w' }),
    ...(signal === undefined ? [] : [{ signal }]),
  );
  if (received !== bytes) {
    throw new Error(
      `${url} ended at ${String(received)} of the ${String(bytes)} bytes its definition states.`,
    );
  }
}

/**
 * How many bytes of a stopped transfer the file at `path` holds to resume
 * from: none where there is no file, and none, with the file emptied, where it
 * holds the whole length or more, since then it is not a part of this source.
 *
 * @param {string} path
 * @param {number} bytes
 */
async function keptLength(path, bytes) {
  let size;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
  if (size < bytes) return size;
  await truncate(path, 0);
  return 0;
}

/**
 * Whether a partial response's `Content-Range` runs from `offset` to the end
 * of a file of `bytes` bytes.
 *
 * @param {string | null} contentRange
 * @param {number} offset
 * @param {number} bytes
 */
function isRangeAsked(contentRange, offset, bytes) {
  const match = contentRange === null ? null : CONTENT_RANGE.exec(contentRange);
  if (match === null) return false;
  const [, first = '', last = '', length = ''] = match;
  return Number(first) === offset && Number(last) === bytes - 1 && Number(length) === bytes;
}
