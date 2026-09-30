import { describe, expect, it } from 'vitest';

import { readResourceFigures } from './resources.js';

describe('reading what the machine has left', () => {
  it('reports the heap limit less what is in use, where the browser says', () => {
    const performance = { memory: { jsHeapSizeLimit: 4_000_000_000, usedJSHeapSize: 250_000_000 } };
    expect(readResourceFigures(performance)).toEqual({ availableMemoryBytes: 3_750_000_000 });
  });

  it('reads afresh each time, since what is in use moves', () => {
    const memory = { jsHeapSizeLimit: 1_000, usedJSHeapSize: 100 };
    const performance = { memory };
    expect(readResourceFigures(performance).availableMemoryBytes).toBe(900);
    memory.usedJSHeapSize = 600;
    expect(readResourceFigures(performance).availableMemoryBytes).toBe(400);
  });

  it('never reports less than nothing', () => {
    const performance = { memory: { jsHeapSizeLimit: 100, usedJSHeapSize: 150 } };
    expect(readResourceFigures(performance).availableMemoryBytes).toBe(0);
  });

  it.each([
    ['a browser that does not report memory', {}],
    ['a report that is not an object', { memory: 12 }],
    ['a limit that is not a number', { memory: { jsHeapSizeLimit: '4 GB', usedJSHeapSize: 1 } }],
    ['a use that is missing', { memory: { jsHeapSizeLimit: 4_000 } }],
    ['a limit that is not finite', { memory: { jsHeapSizeLimit: Infinity, usedJSHeapSize: 1 } }],
    ['a negative use', { memory: { jsHeapSizeLimit: 4_000, usedJSHeapSize: -1 } }],
  ])('knows nothing from %s, and guesses nothing', (_case, performance) => {
    expect(readResourceFigures(performance)).toEqual({ availableMemoryBytes: undefined });
  });

  it('knows nothing where reading the report throws, as a hardened browser may make it', () => {
    const performance = {
      get memory(): never {
        throw new TypeError('Blocked.');
      },
    };
    expect(readResourceFigures(performance)).toEqual({ availableMemoryBytes: undefined });
  });
});
