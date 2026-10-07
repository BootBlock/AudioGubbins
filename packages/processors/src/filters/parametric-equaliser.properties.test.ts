import { processorProperties } from '../testing/processor-properties.js';
import { EVERY_LAYOUT, bandOn } from '../testing/filter-measures.js';
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
  bound: 64,
  // Bells at 0 dB are sections whose numerator and denominator are one, so
  // the input passes through them to the bit.
  passThrough: {
    values: { ...bandOn(3), ...bandOn(4), ...bandOn(5), ...bandOn(6) },
    tolerance: 0,
  },
});
