/**
 * Where finished waveform peaks are kept between visits: the waveform
 * package's `PeakCacheStore`, over the storage's waveform caches (ADR-0043,
 * REQ-STOR-027).
 *
 * Kept beside everything else the storage keeps, the peaks are counted among
 * the waveform caches the Storage panel shows and given up in the order
 * storage pressure gives caches up (REQ-STOR-106, REQ-STOR-200). The sources
 * the editor opens are audio the storage does not keep, a test signal or a
 * picture's sound, so each source's peaks are kept under the digest of its
 * identity, one revision at a time: a newer revision replaces the older
 * rather than accumulating beside it. The peak worker checks whatever is read
 * before it is used, so a cache is never the only copy of anything.
 *
 * Nothing is read from or written into the storage until its root is ready:
 * stored data of another schema waits for the person's decision untouched,
 * and the peaks are made again meanwhile.
 */

import type { Digest } from '@audiogubbins/project-format';
import {
  CacheCategory,
  unstoredScope,
  type CacheKey,
  type CacheStore,
} from '@audiogubbins/storage';
import type { PeakCacheStore } from '@audiogubbins/waveform';

/** What the peaks are kept with. */
export interface PeakCacheServices {
  /** Whether the storage root is open and of this build's schema, so caches may be kept. */
  readonly ready: () => boolean;
  readonly caches: CacheStore;
  readonly digest: Digest;
}

const TEXT = new TextEncoder();

/** How much of a revision's digest names its cache: plenty to tell revisions apart. */
const REVISION_DIGITS = 32;

/** The name of a revision's cache: a path segment, whatever the revision holds. */
async function revisionName(revision: string, digest: Digest): Promise<string> {
  const hash = await digest(TEXT.encode(revision));
  const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `peaks-${hex.slice(0, REVISION_DIGITS)}`;
}

/**
 * Keeps nothing, for a browser that keeps no projects and so has no storage to
 * keep caches in: every source's peaks are made afresh, which the Capabilities
 * panel says.
 */
export const NO_PEAK_CACHE: PeakCacheStore = {
  read: () => Promise.resolve(undefined),
  write: () => Promise.resolve(),
};

/** Keeps peaks in the storage's waveform caches. */
export function storedPeakCache({ ready, caches, digest }: PeakCacheServices): PeakCacheStore {
  const keyOf = async (identity: string, revision: string): Promise<CacheKey> => ({
    category: CacheCategory.Waveform,
    scope: await unstoredScope(identity, digest),
    name: await revisionName(revision, digest),
  });

  return {
    async read(identity, revision) {
      if (!ready()) return undefined;
      const opened = await caches.open(await keyOf(identity, revision));
      if (!opened.ok) throw new Error(opened.failures[0].summary);
      const source = opened.value;
      return source === undefined ? undefined : await source.read(0, source.size);
    },
    async write(identity, revision, bytes) {
      // The host reports a write that rejects, so a cache not kept is said.
      if (!ready()) {
        throw new Error(
          'The stored data cannot be written to now, so these waveform peaks are not kept.',
        );
      }
      const key = await keyOf(identity, revision);
      const cleared = await caches.evictScope(key.category, key.scope);
      if (!cleared.ok) throw new Error(cleared.failures[0].summary);
      const kept = await caches.put(key, bytes);
      if (!kept.ok) throw new Error(kept.failures[0].summary);
    },
  };
}
