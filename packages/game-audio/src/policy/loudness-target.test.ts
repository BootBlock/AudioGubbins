import { describe, expect, it } from 'vitest';

import { loudnessProblems, type LoudnessTarget } from './loudness-target.js';

function parts(target: LoudnessTarget): readonly unknown[] {
  return loudnessProblems(target).map((one) => {
    expect(one.code).toBe('game.loudness-invalid');
    return one.details?.['part'];
  });
}

describe('a loudness target (ADR-0101)', () => {
  it('takes every value at the ends of its range, with or without a ceiling', () => {
    expect(parts({ integratedLufs: -70, toleranceLu: 0.1, truePeakCeilingDbtp: -20 })).toEqual([]);
    expect(parts({ integratedLufs: 0, toleranceLu: 6, truePeakCeilingDbtp: 0 })).toEqual([]);
    expect(parts({ integratedLufs: -16, toleranceLu: 1 })).toEqual([]);
  });

  it('refuses each value past its range, naming it', () => {
    expect(parts({ integratedLufs: -70.1, toleranceLu: 0.09, truePeakCeilingDbtp: 0.1 })).toEqual([
      'integratedLufs',
      'toleranceLu',
      'truePeakCeilingDbtp',
    ]);
    expect(parts({ integratedLufs: 1, toleranceLu: 6.1, truePeakCeilingDbtp: -20.5 })).toEqual([
      'integratedLufs',
      'toleranceLu',
      'truePeakCeilingDbtp',
    ]);
    expect(parts({ integratedLufs: Number.NaN, toleranceLu: 1 })).toEqual(['integratedLufs']);
  });
});
