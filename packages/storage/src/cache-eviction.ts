/**
 * Giving up a category of caches, whether storage pressure or the person's
 * cleanup asks for it (REQ-STOR-106, REQ-STOR-027), without taking a file that
 * is still in use.
 *
 * Every category but the staging holds only what is made again on demand, so it
 * goes at once. The staging holds work in progress that is still used: a
 * rendition being decoded, an export staged for delivery or kept for a retry or
 * another destination, a download's file kept until the next export, and a
 * sound the session holds. Whoever stages or holds any of it shares the
 * storage-wide lock until it lets go, in this window or any other
 * (`storage-sharing.ts`), so the staging is given up only with that lock held
 * alone, as start-up cleaning removes it: where any window shares the lock, or
 * windows cannot be told apart, it is kept, and says so.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import { CacheCategory, type CacheStore } from './cache-store.js';
import { whileAlone } from './storage-sharing.js';
import type { LeaseCoordinator } from './write-lease.js';

/** What giving up a category came to. */
export type CacheEviction =
  | { readonly kind: 'evicted'; readonly freed: number }
  /** Something in it is in use, in this window or another, so it was kept whole. */
  | { readonly kind: 'in-use' };

/** Gives up every cache of `category` that nothing uses (see the module comment). */
export async function evictUnused(
  caches: CacheStore,
  category: CacheCategory,
  coordinator: LeaseCoordinator | undefined,
  signal?: AbortSignal,
): Promise<DomainResult<CacheEviction>> {
  const evict = async (): Promise<DomainResult<CacheEviction>> => {
    const evicted = await caches.evictCategory(category, signal);
    return evicted.ok ? succeed({ kind: 'evicted', freed: evicted.value }) : evicted;
  };
  if (category !== CacheCategory.Staging) return await evict();
  const alone = await whileAlone(coordinator, evict, signal);
  return alone.kind === 'done' ? alone.value : succeed({ kind: 'in-use' });
}
