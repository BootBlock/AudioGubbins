import { decibelsToGain } from '@audiogubbins/audio-engine';

import { processorProperties } from '../testing/processor-properties.js';
import { framesToSilence } from '../testing/tail-measures.js';
import { EVERY_LAYOUT, bandOn, cookbookPoleRadius } from '../testing/filter-measures.js';
import { PARAMETRIC_EQUALISER } from './parametric-equaliser.js';

processorProperties(PARAMETRIC_EQUALISER, {
  layouts: EVERY_LAYOUT,
  settings: [
    { ...bandOn(1), ...bandOn(3, { gain: 12, q: 4 }), ...bandOn(7, { gain: -9 }) },
    {
      ...bandOn(1, { type: 'notch', frequency: 60, q: 24 }),
      ...bandOn(2, { gain: 24 }),
      ...bandOn(4, { type: 'band-pass', q: 0.1 }),
      ...bandOn(5, { gain: -24, q: 0.1 }),
      ...bandOn(8, { q: 10 }),
    },
  ],
  // Four times its largest peak gain, a band's 24 dB, as the cut-only filters
  // are bounded at four for ringing.
  bound: 4 * decibelsToGain(24),
  // One bell of 12 dB and Q 4, whose poles, at `α / A`, set the decay.
  fallsSilent: {
    values: bandOn(3, { type: 'bell', frequency: 1_000, gain: 12, q: 4 }),
    frames: framesToSilence(cookbookPoleRadius(1_000, 4, 1 / decibelsToGain(12 / 2))),
  },
  // Bells at 0 dB are sections whose numerator and denominator are one, so
  // the input passes through them to the bit.
  passThrough: {
    values: { ...bandOn(3), ...bandOn(4), ...bandOn(5), ...bandOn(6) },
    tolerance: 0,
  },
});
