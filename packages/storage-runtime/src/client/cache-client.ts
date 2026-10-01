/**
 * The disposable caches, as the page asks the storage worker for them
 * (REQ-STOR-027). A cache is read and kept whole, and its bytes are moved
 * across the port rather than copied.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { CacheCategory, CacheKey, CacheScope } from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';

/** The caches, read, kept and given up. */
export interface CacheClient {
  /** The whole of the cache under a key, where it is kept whole. */
  read(
    key: CacheKey,
    signal?: AbortSignal,
  ): Promise<DomainResult<Uint8Array<ArrayBuffer> | undefined>>;

  /**
   * Keeps a cache, replacing any under its key. The bytes are given up: their
   * buffer is moved to the worker, and is empty here after.
   */
  put(
    key: CacheKey,
    bytes: Uint8Array<ArrayBuffer>,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>>;

  /** Gives up every cache of a category kept for a scope. */
  evictScope(category: CacheCategory, scope: CacheScope): Promise<DomainResult<void>>;
}

/** The caches, over the page's end of the port. */
export function cacheClient(channel: ClientChannel): CacheClient {
  return {
    read: (key, signal) => channel.call('caches.read', key, { signal }),
    put: (key, bytes, signal) =>
      channel.call('caches.put', { key, bytes }, { signal, transfer: [bytes.buffer] }),
    evictScope: (category, scope) => channel.call('caches.evictScope', { category, scope }),
  };
}
