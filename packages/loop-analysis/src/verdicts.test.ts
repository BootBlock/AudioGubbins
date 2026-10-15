import { describe, expect, it } from 'vitest';

import { verdictOf, worstChannel, worstVerdict, type MetricName } from './verdicts.js';

describe('the metric thresholds', () => {
  // Each row: the largest value that passes, and the largest that warns, or
  // undefined where nothing fails.
  const ROWS: readonly (readonly [MetricName, number, number | undefined])[] = [
    ['discontinuity', 4, 8],
    ['dcMismatch', -60, -40],
    ['netDc', -60, -40],
    ['levelMismatch', 1, 3],
    ['phaseMismatch', 15, 45],
    ['spectralMismatch', 1.5, 4],
    ['zeroCrossing', 1, undefined],
    ['zeroCrossingSigns', 0, undefined],
    ['crossfade', 1.5, 3],
    ['cycleSeam', 3, 6],
    ['cycleDrift', 1, 3],
  ];

  it.each(ROWS)('states the table for %s', (name, pass, warn) => {
    expect(verdictOf(name, pass)).toBe('pass');
    expect(verdictOf(name, pass + 1e-9)).toBe('warn');
    if (warn === undefined) {
      expect(verdictOf(name, 1e12)).toBe('warn');
    } else {
      expect(verdictOf(name, warn)).toBe('warn');
      expect(verdictOf(name, warn + 1e-9)).toBe('fail');
    }
  });
});

describe('the worst channel', () => {
  it('is the largest value, the lower channel of two equal', () => {
    const metric = worstChannel('levelMismatch', [
      { value: 0.5 },
      { value: 4, reference: 'pre-start' },
      { value: 4, reference: 'post-end' },
    ]);
    expect(metric).toEqual({
      value: 4,
      unit: 'dB',
      verdict: 'fail',
      channel: 1,
      reference: 'pre-start',
    });
  });

  it('passes over a channel with nothing to measure, and is not applicable where none has', () => {
    expect(worstChannel('phaseMismatch', [{ notApplicable: 'none' }, { value: 20 }]).channel).toBe(
      1,
    );
    expect(worstChannel('phaseMismatch', [{ notApplicable: 'no partial' }])).toEqual({
      value: 0,
      unit: 'degrees',
      verdict: 'not-applicable',
      channel: undefined,
      reason: 'no partial',
    });
  });

  it("makes a loop's verdict its worst metric's, a loop with nothing applicable passing", () => {
    expect(worstVerdict(['pass', 'not-applicable', 'warn', 'pass'])).toBe('warn');
    expect(worstVerdict(['warn', 'fail'])).toBe('fail');
    expect(worstVerdict(['not-applicable'])).toBe('pass');
  });
});
