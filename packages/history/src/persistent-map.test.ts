import { describe, expect, it } from 'vitest';

import { emptyPersistentMap, persistentMapOf } from './persistent-map.js';
import { seededRandom } from './testing/histories.js';

/** FNV-1a, as the map hashes, to find keys whose hashes collide. */
function fnv(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

/** Two different keys with the same 32-bit hash, found by searching. */
function collidingKeys(): readonly [string, string] {
  const seen = new Map<number, string>();
  for (let index = 0; ; index += 1) {
    const key = `k${index.toString(36)}`;
    const hash = fnv(key);
    const earlier = seen.get(hash);
    if (earlier !== undefined) return [earlier, key];
    seen.set(hash, key);
  }
}

describe('a persistent map', () => {
  it('holds what is set, and each earlier map what it held', () => {
    const empty = emptyPersistentMap<string, number>();
    const one = empty.set('a', 1);
    const two = one.set('b', 2);
    const replaced = two.set('a', 3);
    expect([empty.size, one.size, two.size, replaced.size]).toEqual([0, 1, 2, 2]);
    expect(one.get('a')).toBe(1);
    expect(one.has('b')).toBe(false);
    expect(two.get('b')).toBe(2);
    expect(replaced.get('a')).toBe(3);
    expect(two.get('a')).toBe(1);
    expect(empty.get('a')).toBeUndefined();
  });

  it('is the same map when a key is set to the value it holds', () => {
    const map = persistentMapOf([['a', 1]]);
    expect(map.set('a', 1)).toBe(map);
  });

  it('tells a key holding undefined from an absent key', () => {
    const map = emptyPersistentMap<string, number | undefined>().set('a', undefined);
    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
  });

  it('keeps keys whose whole hashes collide apart', () => {
    const [first, second] = collidingKeys();
    expect(fnv(first)).toBe(fnv(second));
    const map = persistentMapOf([
      [first, 1],
      [second, 2],
    ]);
    expect(map.get(first)).toBe(1);
    expect(map.get(second)).toBe(2);
    expect(map.size).toBe(2);
    const updated = map.set(second, 3).set('other', 4);
    expect(updated.get(second)).toBe(3);
    expect(updated.get(first)).toBe(1);
    expect(updated.get('other')).toBe(4);
    expect(updated.set(first, 1)).toBe(updated);
    expect(map.get(second)).toBe(2);
    expect([...updated.keys()].sort()).toEqual([first, second, 'other'].sort());
  });

  it('agrees with a Map over many random keys, and iterates each entry once', () => {
    const random = seededRandom(11);
    const reference = new Map<string, number>();
    let map = emptyPersistentMap<string, number>();
    for (let step = 0; step < 50_000; step += 1) {
      const key = random.below(20_000).toString(16);
      reference.set(key, step);
      map = map.set(key, step);
    }
    expect(map.size).toBe(reference.size);
    for (const [key, value] of reference) expect(map.get(key)).toBe(value);
    expect(new Map(map.entries())).toEqual(reference);
    expect([...map.values()].length).toBe(reference.size);
  });

  it('finds what changed since an earlier map, collisions and removals included', () => {
    const [first, second] = collidingKeys();
    const random = seededRandom(23);
    let earlier = persistentMapOf<string, number>([
      [first, 1],
      [second, 2],
    ]);
    for (let step = 0; step < 5_000; step += 1) earlier = earlier.set(`k${String(step)}`, step);
    let later = earlier.set(second, 20).set('new', 7);
    for (let step = 0; step < 50; step += 1)
      later = later.set(`k${String(random.below(5_000))}`, -1);
    const kept = [...later.entries()].filter(([key]) => key !== first && key !== 'k10');
    const rebuilt = persistentMapOf(kept);

    const changes = rebuilt.changesSince(earlier);
    const expected = new Map(rebuilt.entries());
    for (const [key, value] of earlier.entries()) {
      if (Object.is(expected.get(key), value)) expected.delete(key);
    }
    expect(new Map(changes.set)).toEqual(expected);
    expect([...changes.removed].sort()).toEqual([first, 'k10'].sort());
    expect(new Map(earlier.withChanges(changes).entries())).toEqual(new Map(rebuilt.entries()));
  });

  it('finds no change between a map and itself, and only the change one set made', () => {
    let map = emptyPersistentMap<string, number>();
    for (let step = 0; step < 10_000; step += 1) map = map.set(`k${String(step)}`, step);
    expect(map.changesSince(map)).toEqual({ set: [], removed: [] });
    expect(map.set('k5', 50).changesSince(map)).toEqual({ set: [['k5', 50]], removed: [] });
    expect(map.withChanges({ set: [], removed: [] })).toBe(map);
  });
});
