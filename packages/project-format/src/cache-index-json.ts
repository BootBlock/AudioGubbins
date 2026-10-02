/**
 * The index of the caches a project's tree carries, `caches/index.json`: each
 * cache's path under `caches/`, its length and the content identity of its
 * bytes (REQ-STOR-103, REQ-STOR-027).
 *
 * A cache is named by what it was derived from, never by its bytes, so the
 * index is what lets a tree's caches be checked as they are read, in an
 * unpacked tree as in a bundle, rather than kept as whatever bytes lie there:
 * a cache torn, damaged or edited by hand would otherwise stand in the storage
 * as though derived from the media or the project it names.
 */

import type { JsonObject } from './canonical-json.js';
import type { ContentId } from './content-identity.js';
import { listConverter, objectOf, pathOf, required, type Converter } from './document-reading.js';
import { asContentId, integerConverter, textConverter } from './scalar-reading.js';
import { isTreePath } from './storage-tree.js';

/**
 * A cache a tree carries, by its path under `caches/`, which its keeper reads,
 * and the identity of its bytes.
 */
export interface TreeCache {
  readonly path: string;
  readonly byteLength: number;
  readonly contentId: ContentId;
}

const INDEX_MEMBERS: ReadonlySet<string> = new Set(['caches']);
const CACHE_MEMBERS: ReadonlySet<string> = new Set(['path', 'byteLength', 'contentId']);

/** The most caches an index lists, as many as a bundle lists entries. */
const MOST_CACHES = 1_000_000;

const asText = textConverter({ maximumLength: 4_096 });

const asCachePath: Converter<string> = (reading, value, parent, key) => {
  const path = asText(reading, value, parent, key);
  if (path === undefined) return undefined;
  if (path !== '' && isTreePath(path)) return path;
  reading.refuse(
    'tree.bad-cache-path',
    'A cache is listed at a path of the tree.',
    pathOf(parent, key),
  );
  return undefined;
};

const asByteLength = integerConverter(0, Number.MAX_SAFE_INTEGER);

const asCache: Converter<TreeCache> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CACHE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const path = required(reading, object, at, 'path', asCachePath);
  const byteLength = required(reading, object, at, 'byteLength', asByteLength);
  const contentId = required(reading, object, at, 'contentId', asContentId);
  return path === undefined || byteLength === undefined || contentId === undefined
    ? undefined
    : { path, byteLength, contentId };
};

const asCaches = listConverter(MOST_CACHES, asCache);

/** Writes the index of `caches`, which the tree lists in path order. */
export function writeCacheIndex(caches: readonly TreeCache[]): JsonObject {
  return {
    caches: caches.map(({ path, byteLength, contentId }) => ({ path, byteLength, contentId })),
  };
}

/** Reads the index of a tree's caches. */
export const readCacheIndex: Converter<readonly TreeCache[]> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, INDEX_MEMBERS);
  return object === undefined
    ? undefined
    : required(reading, object, pathOf(parent, key), 'caches', asCaches);
};
