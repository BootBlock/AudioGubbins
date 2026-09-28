import { describe, expect, it } from 'vitest';

import { readLayoutMap } from './keyboard-layout-map.js';

describe('reading the browser layout map', () => {
  it('reads each key the map names, and nothing else', async () => {
    const navigatorLike = {
      keyboard: {
        getLayoutMap: async () =>
          await Promise.resolve(
            new Map<unknown, unknown>([
              ['KeyK', 't'],
              ['KeyV', 'k'],
              [7, 'x'],
            ]),
          ),
      },
    };

    expect(await readLayoutMap(navigatorLike)).toEqual([
      ['KeyK', 't'],
      ['KeyV', 'k'],
    ]);
  });

  it('answers nothing where the browser has no map, or refuses it', async () => {
    expect(await readLayoutMap({})).toEqual([]);
    expect(
      await readLayoutMap({
        keyboard: {
          getLayoutMap: async () => {
            await Promise.resolve();
            throw new DOMException('Not allowed in a frame.', 'SecurityError');
          },
        },
      }),
    ).toEqual([]);
  });

  it('lets a fault through rather than take it for a refusal', async () => {
    await expect(
      readLayoutMap({
        keyboard: {
          getLayoutMap: async () => {
            await Promise.resolve();
            throw new TypeError('A fault in the reader.');
          },
        },
      }),
    ).rejects.toThrow('A fault in the reader.');
  });
});
