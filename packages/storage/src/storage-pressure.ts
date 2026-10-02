/**
 * Relieving storage pressure, which gives up caches alone (REQ-STOR-106,
 * REQ-STOR-027): in the order they are given up, stopping once enough is freed.
 * Authoritative state, history, backups and source media are never removed
 * without the person, whose cleanup is planned and carried out apart
 * (`cleanup-planning.ts`, `cleanup-running.ts`).
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import { CACHE_CLEANUP_ORDER, type CacheCategory, type CacheStore } from './cache-store.js';

/** What relieving storage pressure freed, category by category. */
export interface PressureRelief {
  readonly freed: ReadonlyMap<CacheCategory, number>;
  readonly total: number;
}

/**
 * Gives up caches in the order they go under pressure until `wanted` bytes are
 * freed, or every cache where no amount is named. Only caches: nothing that
 * cannot be made again is touched without the person.
 */
export async function relieveStoragePressure(
  caches: CacheStore,
  wanted: number = Number.POSITIVE_INFINITY,
  signal?: AbortSignal,
): Promise<DomainResult<PressureRelief>> {
  const freed = new Map<CacheCategory, number>();
  let total = 0;
  for (const category of CACHE_CLEANUP_ORDER) {
    if (total >= wanted) break;
    const evicted = await caches.evictCategory(category, signal);
    if (!evicted.ok) return evicted;
    freed.set(category, evicted.value);
    total += evicted.value;
  }
  return succeed({ freed, total });
}
