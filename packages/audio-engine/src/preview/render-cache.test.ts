import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { RenderCache, type Kept } from './render-cache.js';

/** A value of `bytes` bytes that says when it is given up. */
function kept(bytes: number): Kept & { discarded: boolean } {
  return {
    bytes,
    discarded: false,
    discard() {
      this.discarded = true;
    },
  };
}

describe('the renders kept for previews', () => {
  it('gives up the least recently used render nothing holds to make room, and never one held', () => {
    const cache = new RenderCache<ReturnType<typeof kept>>(300);
    const first = kept(100);
    const second = kept(100);
    const third = kept(100);
    expectSuccess(cache.admit('first', first));
    expectSuccess(cache.admit('second', second));
    expectSuccess(cache.admit('third', third));
    cache.release('first', first);
    cache.release('second', second);
    // The first is used again, so the second is now the least recently used.
    expect(cache.hold('first')).toBe(first);
    cache.release('first', first);

    const fourth = kept(100);
    expectSuccess(cache.admit('fourth', fourth));

    expect(second.discarded).toBe(true);
    expect(first.discarded).toBe(false);
    // Held all along, so never a candidate however long ago it was used.
    expect(third.discarded).toBe(false);
    expect(cache.hold('second')).toBeUndefined();
    expect(cache.bytes).toBe(300);
  });

  it('declines a render longer than the bound, and one that does not fit beside those held', () => {
    const cache = new RenderCache<ReturnType<typeof kept>>(300);
    expect(expectFailureCode(cache.admit('long', kept(301)))).toBe('preview.render-too-long');
    const held = kept(250);
    expectSuccess(cache.admit('held', held));
    expect(expectFailureCode(cache.admit('more', kept(100)))).toBe('preview.cache-full');
    expect(held.discarded).toBe(false);
    expect(cache.bytes).toBe(250);
  });
});
