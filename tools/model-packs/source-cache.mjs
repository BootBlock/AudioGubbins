/**
 * Where the pack build keeps what it downloads and makes, outside the
 * repository, and the sources it keeps there, each checked by its length and
 * SHA-256 before it is used.
 *
 * A source is kept under its own hash, `sources/<sha256>`, so two packs that
 * name the same file share one download, and a file is only ever kept under
 * the name of the bytes it was checked to hold. A transfer is written beside
 * it, as `<sha256>.part`, and renamed once checked; a stopped transfer resumes
 * from that part on the next run.
 */

import { mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { digestOf } from './file-digest.mjs';

/** The variable that names the cache, where the default will not do. */
export const CACHE_VARIABLE = 'AUDIOGUBBINS_PACK_CACHE';

/**
 * One source of a pack, as its definition states it.
 *
 * @typedef {object} PackSourceFile
 * @property {string} id
 * @property {string} url
 * @property {number} bytes
 * @property {string} sha256
 * @property {'tar.gz'} [archive]
 */

/**
 * Fetches a URL into a file, resuming from what it holds, until it holds the
 * stated length: `source-download.mjs` over the network, or a test's fake.
 *
 * @callback Download
 * @param {string} url
 * @param {string} path
 * @param {number} bytes
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */

/**
 * The cache folder: the one `AUDIOGUBBINS_PACK_CACHE` names, or else the
 * platform's per-user cache folder, where a cleaner of caches may take it,
 * since everything in it can be fetched or made again.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @param {NodeJS.Platform} platform
 */
export function cacheFolder(environment, platform) {
  const named = environment[CACHE_VARIABLE];
  if (named !== undefined && named !== '') return resolve(named);
  if (platform === 'win32') {
    const local = environment['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return join(local, 'AudioGubbins', 'pack-cache');
  }
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'AudioGubbins', 'packs');
  const xdg = environment['XDG_CACHE_HOME'];
  return join(
    xdg !== undefined && xdg !== '' ? xdg : join(homedir(), '.cache'),
    'audiogubbins',
    'packs',
  );
}

/**
 * The path of `source` in the cache at `cache`, and whether it was fetched
 * now, with `download`, because it was not already there with its stated
 * length and hash; checked either way before it is returned.
 *
 * @param {PackSourceFile} source
 * @param {string} cache
 * @param {Download} download
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ path: string, downloaded: boolean }>}
 */
export async function cachedSource(source, cache, download, signal) {
  const folder = join(cache, 'sources');
  const path = join(folder, source.sha256);
  const kept = await digestIfPresent(path, signal);
  if (kept !== undefined && kept.bytes === source.bytes && kept.sha256 === source.sha256) {
    return { path, downloaded: false };
  }
  // A file under a hash it does not hold was damaged after it was checked.
  if (kept !== undefined) await rm(path);

  await mkdir(folder, { recursive: true });
  const part = `${path}.part`;
  await download(source.url, part, source.bytes, signal);
  const fetched = await digestOf(part, signal);
  if (fetched.bytes !== source.bytes || fetched.sha256 !== source.sha256) {
    // Kept, the part would be resumed from; it is not this source.
    await rm(part);
    throw new Error(
      `The source ${source.id} from ${source.url} is not the file its definition names:\n` +
        `  expected ${String(source.bytes)} bytes, sha256 ${source.sha256}\n` +
        `  received ${String(fetched.bytes)} bytes, sha256 ${fetched.sha256}`,
    );
  }
  await rename(part, path);
  return { path, downloaded: true };
}

/**
 * The digest of the file at `path`, or `undefined` where there is none.
 *
 * @param {string} path
 * @param {AbortSignal} [signal]
 */
async function digestIfPresent(path, signal) {
  try {
    return await digestOf(path, signal);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
