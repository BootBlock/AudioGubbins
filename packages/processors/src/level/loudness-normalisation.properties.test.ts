import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { setLayout } from '../testing/space-measures.js';
import { LOUDNESS_NORMALISATION } from './loudness-normalisation.js';

const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.surround5_1,
  setLayout(1, 'sn3d'),
];

// A measurement is made for one channel count, so each layout is given its own.
for (const layout of LAYOUTS) {
  processorProperties(LOUDNESS_NORMALISATION, {
    layouts: [layout],
    settings: [{ target: -14 }, { 'limit-true-peak': true, ceiling: -3 }],
    measured: [TEST_RATE, layout.roles.length, 1, -30, 0.5],
    bound: 8,
    passThrough: { values: {}, tolerance: 0 },
  });
}
