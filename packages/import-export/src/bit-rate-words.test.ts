import { describe, expect, it } from 'vitest';

import { bitRatesWords } from './bit-rate-words.js';

describe('bitRatesWords', () => {
  it('lists a few bit rates one by one', () => {
    expect(bitRatesWords([96, 128, 160, 192])).toBe('96, 128, 160 or 192');
    expect(bitRatesWords([192])).toBe('192');
  });

  it('says each even run of many as a stretch, and the rest one by one', () => {
    const ladder = Array.from({ length: 72 }, (_, index) => 8 + index * 8);
    expect(bitRatesWords(ladder)).toBe('every 8 from 8 to 576');
    expect(bitRatesWords([8, 16, 24, 32, 40, 64, 96, 104, 112, 120, 320])).toBe(
      'every 8 from 8 to 40, 64, every 8 from 96 to 120 or 320',
    );
  });
});
