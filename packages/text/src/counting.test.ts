import { describe, expect, it } from 'vitest';

import { counted } from './counting.js';

describe('a count, as a sentence says it', () => {
  it('takes the singular for one alone', () => {
    expect(counted(1, 'branch', 'branches')).toBe('1 branch');
    expect(counted(2, 'branch', 'branches')).toBe('2 branches');
  });

  it('takes the plural for none', () => {
    expect(counted(0, 'change', 'changes')).toBe('0 changes');
  });

  it('agrees a whole phrase with the count', () => {
    expect(counted(1, 'clip that plays it', 'clips that play it')).toBe('1 clip that plays it');
    expect(counted(3, 'clip that plays it', 'clips that play it')).toBe('3 clips that play it');
  });
});
