/**
 * How the GPU backends hold fields: cut into slices the device takes, and kept
 * by key within a budget of bytes, least recently drawn out first.
 */

import { describe, expect, it } from 'vitest';

import { TextureCache, fieldSlices } from './field-textures.js';

/** A cache of named textures within `budget` bytes, and the names it has released. */
function cacheOf(budget: number) {
  const released: string[] = [];
  const cache = new TextureCache<string>(budget, (texture) => released.push(texture));
  return { cache, released };
}

describe('a field’s slices', () => {
  it('cover the field in pieces no wider or taller than the device takes, row of slices by row', () => {
    expect(fieldSlices(5, 3, 2)).toEqual([
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 2, y: 0, width: 2, height: 2 },
      { x: 4, y: 0, width: 1, height: 2 },
      { x: 0, y: 2, width: 2, height: 1 },
      { x: 2, y: 2, width: 2, height: 1 },
      { x: 4, y: 2, width: 1, height: 1 },
    ]);
  });

  it('are the whole field where it fits', () => {
    expect(fieldSlices(3, 4, 4)).toEqual([{ x: 0, y: 0, width: 3, height: 4 }]);
  });
});

describe('the texture cache', () => {
  it('answers what it holds by key, and nothing for a key it does not', () => {
    const { cache } = cacheOf(10);
    cache.hold('a', 'texture a', 4);

    expect(cache.take('a')).toBe('texture a');
    expect(cache.take('b')).toBeUndefined();
    expect(cache.bytes).toBe(4);
  });

  it('releases nothing until it is trimmed, then the least recently drawn until it fits', () => {
    const { cache, released } = cacheOf(8);
    cache.hold('a', 'texture a', 4);
    cache.hold('b', 'texture b', 4);
    // Drawing a again makes b the least recently drawn.
    cache.take('a');
    cache.hold('c', 'texture c', 4);

    expect(released).toEqual([]);
    expect(cache.bytes).toBe(12);
    cache.trim();

    expect(released).toEqual(['texture b']);
    expect(cache.bytes).toBe(8);
    expect(cache.take('b')).toBeUndefined();
    expect(cache.take('a')).toBe('texture a');
  });

  it('releases a texture larger than its whole budget once it is drawn, and keeps the rest', () => {
    const { cache, released } = cacheOf(8);
    cache.hold('small', 'small texture', 2);
    cache.hold('large', 'large texture', 9);

    cache.trim();

    expect(released).toEqual(['large texture']);
    expect(cache.bytes).toBe(2);
    expect(cache.take('small')).toBe('small texture');
  });
});
