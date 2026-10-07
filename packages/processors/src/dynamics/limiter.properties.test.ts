import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { LIMITER } from './limiter.js';

const FIRST_ORDER = setLayout(1, 'sn3d');

processorProperties(LIMITER, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1, FIRST_ORDER],
  settings: [
    { ceiling: -6, release: 1, 'look-ahead': 0.5 },
    { ceiling: -12, release: 2_000, 'look-ahead': 20 },
  ],
  bound: 1,
  passThrough: { values: { ceiling: 0 }, tolerance: 0 },
});
