import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { DELAY } from './delay.js';

processorProperties(DELAY, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
  settings: [
    { time: 1, feedback: 95, damping: 200, 'cross-feed': true },
    { time: 4_000, feedback: 0, damping: 20_000 },
    { time: 10.3, feedback: 60, damping: 20_000, 'cross-feed': true },
  ],
  bound: 32,
});

processorProperties(DELAY, {
  layouts: [setLayout(1, 'sn3d')],
  settings: [{ time: 1, feedback: 95, damping: 200 }],
  bound: 32,
});
