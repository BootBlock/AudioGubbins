import { describe, expect, it } from 'vitest';

import { N_LOG_N_FOURFOLD, comparisonsIn } from './comparisons.js';

/** A collator, made once, as the code under measure makes its own. */
const COLLATOR = new Intl.Collator('en');

/** The collator's own `compare`, as the runtime defines it. */
const ORIGINAL = Object.getOwnPropertyDescriptor(Intl.Collator.prototype, 'compare');

/** The `compare` of `collator`, read now. */
function compareOf(collator: Intl.Collator): (one: string, other: string) => number {
  const compare: unknown = Reflect.get(collator, 'compare');
  if (typeof compare !== 'function') throw new Error('The collator gave no comparison.');
  return (one, other) => Number(Reflect.apply(compare, undefined, [one, other]));
}

describe('the comparisons of names a piece of work makes', () => {
  it('counts each comparison of a known sort, and answers what the collator answers', () => {
    // The sort asks its own comparator, which counts each time it is asked, so
    // the count is known whatever order the engine compares in.
    let asked = 0;
    let sorted: string[] = [];
    const counted = comparisonsIn(() => {
      sorted = ['pear', 'Apple', 'fig', 'banana', 'cherry'].sort((one, other) => {
        asked += 1;
        return COLLATOR.compare(one, other);
      });
    });

    expect(asked).toBeGreaterThan(0);
    expect(counted).toBe(asked);
    expect(sorted).toEqual(['Apple', 'banana', 'cherry', 'fig', 'pear']);
  });

  it('counts none made outside the work', () => {
    // A comparison is made before each of two measures of known work, the first
    // making one comparison and the second two, so each answers only its own: a
    // count kept from one measure to the next answers another, and so would one
    // that took in a comparison made outside the work.
    COLLATOR.compare('a', 'b');
    const first = comparisonsIn(() => {
      COLLATOR.compare('a', 'b');
    });
    COLLATOR.compare('a', 'b');
    COLLATOR.compare('b', 'c');
    const second = comparisonsIn(() => {
      COLLATOR.compare('a', 'b');
      COLLATOR.compare('b', 'c');
    });

    expect([first, second]).toEqual([1, 2]);
  });

  it('counts each comparison through a `compare` read while the work runs, and none through one read before it', () => {
    // The `compare` read before the work is the collator's own. The one read
    // while it runs is read once and compared through twice, so what is counted
    // is each comparison, not each read.
    const before = compareOf(COLLATOR);
    const counted = comparisonsIn(() => {
      before('a', 'b');
      const during = compareOf(COLLATOR);
      during('a', 'b');
      during('b', 'c');
    });

    expect(counted).toBe(2);
  });

  it('leaves the collator as it was, whether the work returns or throws', () => {
    // Left counting, every collator would wrap each comparison made after the
    // work, in every test the worker runs after this one.
    expect(typeof Reflect.get(ORIGINAL ?? {}, 'get')).toBe('function');

    comparisonsIn(() => {
      COLLATOR.compare('a', 'b');
    });
    expect(Object.getOwnPropertyDescriptor(Intl.Collator.prototype, 'compare')).toEqual(ORIGINAL);

    expect(() =>
      comparisonsIn(() => {
        COLLATOR.compare('a', 'b');
        throw new Error('The work failed.');
      }),
    ).toThrow('The work failed.');
    expect(Object.getOwnPropertyDescriptor(Intl.Collator.prototype, 'compare')).toEqual(ORIGINAL);
  });

  it('stops the work with a failure naming its ceiling once the comparisons pass it, and not before', () => {
    // Stopped at the comparison past the ceiling, a defect that makes millions
    // fails in its first moments rather than when its test's time runs out.
    let made = 0;
    const compared = (times: number) => () => {
      for (let one = 0; one < times; one += 1) {
        made += 1;
        COLLATOR.compare('a', 'b');
      }
    };

    expect(comparisonsIn(compared(10), 10)).toBe(10);
    made = 0;
    expect(() => comparisonsIn(compared(1_000_000), 10)).toThrow(
      'The work made more than 10 comparisons of names, the most it is allowed.',
    );
    expect(made).toBe(11);
    expect(Object.getOwnPropertyDescriptor(Intl.Collator.prototype, 'compare')).toEqual(ORIGINAL);
  });

  it('holds four times the names to more comparisons than n log n makes, and fewer than n log² n', () => {
    // From a thousand names to four thousand, work that grows as n log n makes
    // about 4.8 times the comparisons, and work that grows as n log² n about
    // 5.8: a bound between them tells the two apart.
    const fourfold = (power: number) => 4 * (Math.log(4000) / Math.log(1000)) ** power;

    expect(N_LOG_N_FOURFOLD).toBeGreaterThan(fourfold(1));
    expect(N_LOG_N_FOURFOLD).toBeLessThan(fourfold(2));
  });
});
