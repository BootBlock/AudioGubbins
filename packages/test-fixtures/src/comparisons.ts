/**
 * How many times names are compared while a piece of work runs.
 *
 * Not a fixture: nothing here is generated. It is the measure a test of cost
 * holds code to where the work is a number of comparisons rather than a time,
 * such as numbering a name beside thousands held: counted, the work of a defect
 * that compares each name held again for each number is read the same on every
 * machine and under any load, with none of the noise a reading of processor
 * time carries.
 *
 * Counted at the collator, because a comparison of names reads the `compare` of
 * an `Intl.Collator`: while the work runs, the collator's `compare` answers its
 * own comparison wrapped in a count, and after it, whether it returns or
 * throws, the collator is as it was.
 */

/**
 * The most times the comparisons of work over four thousand names may be those
 * over a thousand, where the work grows as n log n: four times the names make
 * about 4.8 times the comparisons that way, and about 5.8 times where the work
 * grows as n log² n, which this bound refuses.
 *
 * A count at four thousand is taken with this many times the count at a
 * thousand as its ceiling (see {@link comparisonsIn}), so work that grows
 * faster is stopped where it passes the bound, before a quadratic defect's
 * millions of comparisons, and its test fails within Vitest's default time.
 */
export const N_LOG_N_FOURFOLD = 5.5;

/**
 * How many comparisons a collator makes while `work` runs: each comparison made
 * through a `compare` read while it runs is counted.
 *
 * A `compare` read before `work` runs is the collator's own, and none of its
 * comparisons is counted.
 *
 * The comparison past `ceiling` throws a failure naming it, which stops the
 * work there, however many more it would make.
 */
export function comparisonsIn(work: () => void, ceiling = Number.POSITIVE_INFINITY): number {
  const prototype: unknown = Intl.Collator.prototype;
  const original = Object.getOwnPropertyDescriptor(prototype, 'compare');
  const getter: unknown = original === undefined ? undefined : Reflect.get(original, 'get');
  if (original === undefined || typeof getter !== 'function') {
    throw new Error('This runtime gives no collator to count.');
  }

  let counted = 0;
  const counting = function (this: Intl.Collator): (one: string, other: string) => number {
    const compare: unknown = Reflect.apply(getter, this, []);
    if (typeof compare !== 'function') throw new Error('The collator gave no comparison.');
    return (one, other) => {
      counted += 1;
      if (counted > ceiling) {
        throw new Error(
          `The work made more than ${String(ceiling)} comparisons of names, the most it is allowed.`,
        );
      }
      return Number(Reflect.apply(compare, undefined, [one, other]));
    };
  };

  Object.defineProperty(prototype, 'compare', { ...original, get: counting });
  try {
    work();
  } finally {
    Object.defineProperty(prototype, 'compare', original);
  }
  return counted;
}
