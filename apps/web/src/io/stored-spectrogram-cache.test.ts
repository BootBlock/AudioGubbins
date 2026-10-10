import { describe, expect, it } from 'vitest';

import { webDigest } from '@audiogubbins/browser-storage';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { createCancellationSource, type CancellationSignal } from '@audiogubbins/domain';
import {
  DEFAULT_SPECTROGRAM_CONFIG,
  type SpectralTileKey,
  type TileWriting,
} from '@audiogubbins/spectral-analysis';
import { CacheCategory, type CacheStore } from '@audiogubbins/storage';
import { connectStorage, type CacheClient } from '@audiogubbins/storage-runtime';
import { portPair, serveMemoryStorage, steppingClock } from '@audiogubbins/storage-runtime/testing';

import { WAITING_WRITES, storedSpectrogramCache } from './stored-spectrogram-cache.js';

const digest = webDigest(crypto.subtle);

/**
 * A cache kept by a storage worker over storage in memory, whose root is ready
 * until the test says otherwise, the worker's caches as another window of the
 * profile reads them, and the most reads the page had under way at once.
 */
function cacheOver() {
  const pair = portPair();
  const { another } = serveMemoryStorage(pair.worker);
  const client = connectStorage(
    pair.page,
    createDiagnosticCentre(createLogStore(), steppingClock()),
  );
  const root = { ready: true };
  const reads = { now: 0, most: 0, started: 0 };
  /** While set, every put waits for it, as a storage worker busy elsewhere answers late. */
  const puts: { held: Promise<void> | undefined } = { held: undefined };
  const counted: CacheClient = {
    ...client.caches,
    put: async (key, bytes, signal) => {
      await puts.held;
      return await client.caches.put(key, bytes, signal);
    },
    read: async (key, signal) => {
      reads.now += 1;
      reads.started += 1;
      reads.most = Math.max(reads.most, reads.now);
      try {
        return await client.caches.read(key, signal);
      } finally {
        reads.now -= 1;
      }
    },
  };
  const cache = storedSpectrogramCache({ ready: () => root.ready, caches: counted, digest });
  return { cache, caches: another.caches, root, reads, puts };
}

function key(index: number, revision = 'r1', identity = 'test:tone-bursts'): SpectralTileKey {
  return { identity, revision, channel: 0, config: DEFAULT_SPECTROGRAM_CONFIG, level: 0, index };
}

const NEVER = createCancellationSource().signal;

/** Why a tile of a revision opened before the kept one is refused. */
const LATER = 'The tiles of a later revision of this sound are kept, so this one is not.';

/** A write of a tile whose revision's job opened at `opened`, given up by `signal`. */
function writing(opened = 1, signal: CancellationSignal = NEVER): TileWriting {
  return { opened, signal };
}

/** Holds every put until the returned function is called. */
function holdPuts(puts: { held: Promise<void> | undefined }): () => void {
  let release = (): void => undefined;
  puts.held = new Promise((resolve) => {
    release = () => {
      puts.held = undefined;
      resolve();
    };
  });
  return release;
}

/** A signal that never aborts, counting the listeners it holds. */
function countingSignal(): {
  readonly signal: CancellationSignal;
  readonly listeners: Set<unknown>;
} {
  const listeners = new Set<unknown>();
  return {
    listeners,
    signal: {
      aborted: false,
      reason: undefined,
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
    },
  };
}

/** The bytes kept for `tile`, as numbers, or `undefined`: they crossed from the worker in another realm. */
async function keptBytes(
  cache: ReturnType<typeof cacheOver>['cache'],
  tile: SpectralTileKey,
): Promise<number[] | undefined> {
  const kept = await cache.read(tile, NEVER);
  if (kept !== undefined && !ArrayBuffer.isView(kept)) throw new Error('The cache gave no bytes.');
  return kept === undefined ? undefined : Array.from(kept);
}

/** The sizes of every spectrogram cache kept, smallest first. */
async function spectrogramSizes(caches: CacheStore): Promise<number[]> {
  const sizes: number[] = [];
  for await (const entry of caches.entries(CacheCategory.Spectrogram)) sizes.push(entry.byteLength);
  return sizes.toSorted((one, other) => one - other);
}

describe('spectrogram tiles kept in the storage (ADR-0080, REQ-STOR-027)', () => {
  it('gives back each tile kept, and nothing for another tile, revision or source', async () => {
    const { cache } = cacheOver();
    await cache.write(key(0), new Uint8Array([1, 2, 3]), writing());
    await cache.write(key(1), new Uint8Array([4, 5]), writing());

    expect(await keptBytes(cache, key(0))).toEqual([1, 2, 3]);
    expect(await keptBytes(cache, key(1))).toEqual([4, 5]);
    expect(await cache.read(key(2), NEVER)).toBeUndefined();
    expect(await cache.read(key(0, 'r2'), NEVER)).toBeUndefined();
    expect(await cache.read(key(0, 'r1', 'test:loop'), NEVER)).toBeUndefined();
    expect(await cache.read({ ...key(0), channel: 1 }, NEVER)).toBeUndefined();
  });

  it('leaves the bytes it is handed as they were, since the worker is sent a copy', async () => {
    const { cache } = cacheOver();
    const bytes = new Uint8Array([1, 2, 3]);
    await cache.write(key(0), bytes, writing());

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps one revision of a source, letting go of its other revisions’ tiles', async () => {
    const { cache, caches } = cacheOver();
    await cache.write(key(0, 'old'), new Uint8Array(10), writing(1));
    await cache.write(key(1, 'old'), new Uint8Array(11), writing(1));
    await cache.write(key(0, 'r1', 'test:loop'), new Uint8Array(30), writing(1));
    // Written together, as a host keeps the tiles the worker makes.
    await Promise.all([
      cache.write(key(0, 'new'), new Uint8Array(20), writing(2)),
      cache.write(key(1, 'new'), new Uint8Array(21), writing(2)),
    ]);

    expect(await cache.read(key(0, 'old'), NEVER)).toBeUndefined();
    expect(await cache.read(key(1, 'old'), NEVER)).toBeUndefined();
    expect(await keptBytes(cache, key(0, 'new'))).toEqual(Array<number>(20).fill(0));
    expect(await keptBytes(cache, key(1, 'new'))).toEqual(Array<number>(21).fill(0));
    // Each source's marker is when its revision's job opened and the
    // revision's name: "2 new" and "1 r1".
    expect(await spectrogramSizes(caches)).toEqual([4, 5, 20, 21, 30]);
  });

  it('reads a few tiles at a time however many are asked for, and gives up a read no view waits on', async () => {
    const { cache, reads } = cacheOver();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        cache.write(key(index), new Uint8Array([index]), writing()),
      ),
    );
    const left = createCancellationSource();
    const asked = Array.from({ length: 8 }, (_, index) =>
      cache.read(key(index), index === 7 ? left.signal : NEVER),
    );
    left.cancel(new Error('No view shows the tile.'));
    reads.most = 0;
    reads.started = 0;

    const read = await Promise.allSettled(asked);
    expect(reads.most).toBeLessThanOrEqual(4);
    expect(read.at(-1)).toEqual({
      status: 'rejected',
      reason: new Error('No view shows the tile.'),
    });
    // The read given up while it waited was never begun.
    expect(reads.started).toBe(7);
    for (const [index, each] of read.slice(0, 7).entries()) {
      expect(each.status === 'fulfilled' ? Array.from(each.value ?? []) : undefined).toEqual([
        index,
      ]);
    }
  });

  it('is counted and given up with the spectrogram caches, and made again after', async () => {
    const { cache, caches } = cacheOver();
    await cache.write(key(0), new Uint8Array(64), writing());
    const usage = await caches.usage();
    if (!usage.ok) throw new Error('No usage.');
    expect(usage.value.get(CacheCategory.Spectrogram)).toBeGreaterThan(64);

    await caches.evictCategory(CacheCategory.Spectrogram);
    expect(await cache.read(key(0), NEVER)).toBeUndefined();
    await cache.write(key(0), new Uint8Array(4), writing());
    expect(await keptBytes(cache, key(0))).toEqual([0, 0, 0, 0]);
  });

  it('reads nothing from, and refuses to write into, storage that is not ready', async () => {
    const { cache, caches, root } = cacheOver();
    await cache.write(key(0), new Uint8Array(8), writing());
    root.ready = false;

    expect(await cache.read(key(0), NEVER)).toBeUndefined();
    await expect(cache.write(key(0, 'r2'), new Uint8Array(8), writing())).rejects.toThrow(
      'The stored data cannot be written to now, so this spectrogram tile is not kept.',
    );
    // A refused write does not hold up the next.
    root.ready = true;
    await cache.write(key(1), new Uint8Array(9), writing());
    expect(await keptBytes(cache, key(0))).toEqual(Array<number>(8).fill(0));
    expect(await spectrogramSizes(caches)).toEqual([4, 8, 9]);
  });

  it('refuses a late tile of a revision opened before the kept one, keeping the newer tiles', async () => {
    const { cache } = cacheOver();
    await cache.write(key(0, 'edited'), new Uint8Array([2]), writing(2));
    // The tile of the revision the edit replaced, made before it and kept after.
    const late = await Promise.allSettled([
      cache.write(key(1, 'before'), new Uint8Array([1]), writing(1)),
    ]);

    expect(await keptBytes(cache, key(0, 'edited'))).toEqual([2]);
    expect(await cache.read(key(1, 'before'), NEVER)).toBeUndefined();
    expect(late).toEqual([{ status: 'rejected', reason: new Error(LATER) }]);
  });

  it('takes a revision opened later in place of the kept one, an earlier revision come back included', async () => {
    const { cache } = cacheOver();
    await cache.write(key(0, 'first'), new Uint8Array([1]), writing(1));
    await cache.write(key(0, 'second'), new Uint8Array([2]), writing(2));
    // The edit undone: the first revision again, its job opened after both.
    await cache.write(key(1, 'first'), new Uint8Array([3]), writing(3));
    // A tile of the second, its job opened before the first came back.
    await expect(cache.write(key(1, 'second'), new Uint8Array([4]), writing(2))).rejects.toThrow(
      LATER,
    );

    expect(await cache.read(key(0, 'second'), NEVER)).toBeUndefined();
    expect(await keptBytes(cache, key(1, 'first'))).toEqual([3]);
  });

  it('dates the kept revision by its latest job, so an earlier job of another cannot clear it', async () => {
    const { cache } = cacheOver();
    await cache.write(key(0, 'shown'), new Uint8Array([1]), writing(1));
    // The same revision opened again later, as by another window of the profile.
    await cache.write(key(1, 'shown'), new Uint8Array([2]), writing(3));
    await expect(cache.write(key(0, 'other'), new Uint8Array([3]), writing(2))).rejects.toThrow(
      LATER,
    );

    expect(await keptBytes(cache, key(0, 'shown'))).toEqual([1]);
    expect(await keptBytes(cache, key(1, 'shown'))).toEqual([2]);
  });

  it('gives up a write cancelled while it waits or while it is under way, keeping nothing of it', async () => {
    const { cache, puts } = cacheOver();
    const first = createCancellationSource();
    const second = createCancellationSource();
    const release = holdPuts(puts);
    const underWay = cache.write(key(0), new Uint8Array([1]), writing(1, first.signal));
    const waiting = cache.write(key(1), new Uint8Array([2]), writing(1, second.signal));
    second.cancel(new Error('The spectrogram closed.'));
    await expect(waiting).rejects.toThrow('The spectrogram closed.');
    first.cancel(new Error('The spectrogram closed.'));
    release();
    await expect(underWay).rejects.toThrow('The spectrogram closed.');

    expect(await cache.read(key(0), NEVER)).toBeUndefined();
    expect(await cache.read(key(1), NEVER)).toBeUndefined();
  });

  it('keeps a bounded number of a source’s writes waiting, letting the oldest go', async () => {
    const { cache, puts } = cacheOver();
    const release = holdPuts(puts);
    const count = WAITING_WRITES + 3;
    const written = Array.from({ length: count }, (_, index) =>
      cache.write(key(index), new Uint8Array([index]), writing()),
    );
    // Another source's writes wait in a queue of their own.
    const other = cache.write(key(0, 'r1', 'test:loop'), new Uint8Array([9]), writing());
    release();
    const settled = await Promise.allSettled([...written, other]);

    // The first was under way; the two after it waited longest and were let go.
    expect(settled.map((each) => each.status)).toEqual([
      'fulfilled',
      'rejected',
      'rejected',
      ...Array<string>(WAITING_WRITES + 1).fill('fulfilled'),
    ]);
    expect(settled[1]).toEqual({
      status: 'rejected',
      reason: new Error(
        'Too many spectrogram tiles of this sound were waiting to be kept, so the oldest was let go.',
      ),
    });
    expect(await cache.read(key(1), NEVER)).toBeUndefined();
    expect(await keptBytes(cache, key(count - 1))).toEqual([count - 1]);
  });

  it('lets go of its listener on a signal once a read or a write is done', async () => {
    const { cache } = cacheOver();
    const { signal, listeners } = countingSignal();
    await cache.write(key(0), new Uint8Array([1]), writing(1, signal));
    await cache.read(key(0), signal);
    await cache.read(key(1), signal);

    expect(listeners.size).toBe(0);
  });
});
