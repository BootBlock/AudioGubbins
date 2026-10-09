import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { GATE } from './gate.js';

const FIRST_ORDER = setLayout(1, 'sn3d');

processorProperties(GATE, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1, FIRST_ORDER],
  settings: [
    { threshold: 0, hysteresis: 0, attack: 0.1, hold: 0, release: 5, range: 96 },
    { threshold: -20, hysteresis: 20, attack: 200, hold: 2_000, release: 2_000, range: 6 },
  ],
  // Its gain is at most 1, so its output is never above its input.
  bound: 1,
  passThrough: { values: { range: 0 }, tolerance: 0 },
});
