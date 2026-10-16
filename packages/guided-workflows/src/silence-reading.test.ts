import { describe, expect, it } from 'vitest';

import { soundsLeft } from './silence-reading.js';

describe('soundsLeft', () => {
  it('widens each sound by its lead-in and tail, never past either end', () => {
    expect(
      soundsLeft(
        [
          { start: 0, end: 100 },
          { start: 900, end: 1_000 },
        ],
        1_000,
        30,
        40,
      ),
    ).toEqual([{ start: 70, end: 940 }]);
  });

  it('meets the next sound no nearer than the middle of the silence between them', () => {
    expect(soundsLeft([{ start: 100, end: 110 }], 200, 50, 50)).toEqual([
      { start: 0, end: 105 },
      { start: 105, end: 200 },
    ]);
  });
});
