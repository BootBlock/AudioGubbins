/**
 * A deterministic sequence of numbers from a seed (Mulberry32), so a randomised
 * test is the same on every run and a failing seed can be run again.
 */

export interface Random {
  /** A number from 0 up to 1. */
  next(): number;

  /** A whole number from 0 up to `limit`. */
  below(limit: number): number;

  /** One of the items, or `undefined` for none. */
  pick<TItem>(items: readonly TItem[]): TItem | undefined;
}

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const below = (limit: number): number => Math.floor(next() * limit);
  return { next, below, pick: (items) => items[below(items.length)] };
}
