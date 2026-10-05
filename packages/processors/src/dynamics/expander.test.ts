import { describe, expect, it } from 'vitest';

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  StandardLayouts,
  ambisonicLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { processorProperties } from '../testing/processor-properties.js';
import { runProcessor } from '../testing/processor-run.js';
import { EXPANDER } from './expander.js';
import { rmsGainDecibels, runMono, tone } from '../testing/dynamics-runs.js';

const FIRST_ORDER = expectSuccess(
  ambisonicLayout({
    order: 1,
    ordering: AmbisonicOrdering.Acn,
    normalisation: AmbisonicNormalisation.Sn3d,
  }),
);

processorProperties(EXPANDER, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1, FIRST_ORDER],
  settings: [
    { threshold: 0, ratio: 10, range: 80, knee: 0, attack: 0.1, release: 5 },
    { threshold: -20, ratio: 1.5, range: 6, knee: 24, attack: 200, release: 2_000 },
  ],
  passThrough: { values: { ratio: 1 }, tolerance: 0 },
});

const SECOND = 48_000;
const TAIL = [SECOND / 2, SECOND] as const;

describe('the expander', () => {
  it('leaves what is over its threshold alone and lowers what is under it, by its ratio', () => {
    const values = { threshold: -30, ratio: 3, range: 80, knee: 0, attack: 0.1, release: 2_000 };
    const loud = tone(1_000, 0.5, SECOND);
    const quiet = tone(1_000, 10 ** (-50 / 20), SECOND);
    expect(rmsGainDecibels(loud, runMono(EXPANDER, values, loud), ...TAIL)).toBeCloseTo(0, 6);
    // 20 dB under the threshold, at 3:1, comes out 40 dB lower still.
    const lowered = rmsGainDecibels(quiet, runMono(EXPANDER, values, quiet), ...TAIL);
    expect(Math.abs(lowered + 40)).toBeLessThan(0.05);
  });

  it('never lowers by more than its range', () => {
    const quiet = tone(1_000, 10 ** (-70 / 20), SECOND);
    const values = { threshold: -20, ratio: 10, range: 12, knee: 0, release: 2_000 };
    const lowered = rmsGainDecibels(quiet, runMono(EXPANDER, values, quiet), ...TAIL);
    expect(Math.abs(lowered + 12)).toBeLessThan(0.01);
  });

  it('moves every channel by the loudest, so a quiet channel beside a loud one is not lowered', () => {
    const loud = tone(1_000, 0.5, SECOND);
    const quiet = tone(700, 10 ** (-60 / 20), SECOND);
    const [, beside] = runProcessor(
      EXPANDER,
      { layout: StandardLayouts.stereo, values: { threshold: -30, ratio: 4 } },
      [loud, quiet],
    );
    expect(rmsGainDecibels(quiet, beside ?? quiet, ...TAIL)).toBeCloseTo(0, 6);
  });
});
