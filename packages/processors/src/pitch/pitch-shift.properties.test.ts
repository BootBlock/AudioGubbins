import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { PITCH_SHIFT } from './pitch-shift.js';

processorProperties(PITCH_SHIFT, {
  layouts: [
    StandardLayouts.mono,
    StandardLayouts.stereo,
    StandardLayouts.surround5_1,
    setLayout(1, 'sn3d'),
  ],
  settings: [{ semitones: 7, cents: 25 }, { semitones: -24 }, { semitones: 24, cents: -100 }],
  bound: 4,
  // At no shift each frame is its own spectrum, so the stream comes back to
  // the rounding of the forward and inverse transforms.
  passThrough: { values: { semitones: 0, cents: 0 }, tolerance: 1e-6 },
});
