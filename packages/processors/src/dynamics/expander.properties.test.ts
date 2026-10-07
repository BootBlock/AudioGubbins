import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { EXPANDER } from './expander.js';

const FIRST_ORDER = setLayout(1, 'sn3d');

processorProperties(EXPANDER, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1, FIRST_ORDER],
  settings: [
    { threshold: 0, ratio: 10, range: 80, knee: 0, attack: 0.1, release: 5 },
    { threshold: -20, ratio: 1.5, range: 6, knee: 24, attack: 200, release: 2_000 },
  ],
  passThrough: { values: { ratio: 1 }, tolerance: 0 },
});
