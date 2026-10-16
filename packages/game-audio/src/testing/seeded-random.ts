/**
 * A seeded source of numbers for the package's random test worlds, scenarios
 * and vectors. Draws come from the domain's counter draw, the one generator of
 * random numbers, so a seed always gives the same numbers and a failing case is
 * found again by its seed.
 */

import { uniformDraw } from '@audiogubbins/domain';

/** A seeded source of numbers over the counter draw. */
export interface Random {
  /** A number in [0, 1). */
  next(): number;
  /** A whole number in [0, bound). */
  below(bound: number): number;
  /** A number in [lowest, highest]. */
  between(lowest: number, highest: number): number;
  /** A whole number in [lowest, highest]. */
  whole(lowest: number, highest: number): number;
  /** One of the items. */
  pick<T>(items: readonly T[]): T;
  /** True with the given chance. */
  chance(probability: number): boolean;
}

/** The stream every draw of a world is taken from; the draw's index counts up. */
const WORLD_STREAM = 1;

/** A seeded source of numbers: draw k of the world's stream under `seed`. */
export function seededRandom(seed: number): Random {
  let index = 0;
  const next = (): number => uniformDraw(seed >>> 0, WORLD_STREAM, index++);
  const below = (bound: number): number => Math.floor(next() * bound);
  return {
    next,
    below,
    between: (lowest, highest) => lowest + next() * (highest - lowest),
    whole: (lowest, highest) => lowest + below(highest - lowest + 1),
    pick: (items) => {
      const item = items[below(items.length)];
      if (item === undefined) throw new Error('Nothing to pick from.');
      return item;
    },
    chance: (probability) => next() < probability,
  };
}
