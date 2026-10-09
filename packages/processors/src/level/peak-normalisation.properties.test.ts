import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { PEAK_NORMALISATION } from './peak-normalisation.js';

processorProperties(PEAK_NORMALISATION, {
  readsDsp: true,
  layouts: [
    StandardLayouts.mono,
    StandardLayouts.stereo,
    StandardLayouts.surround5_1,
    setLayout(1, 'sn3d'),
  ],
  settings: [{ target: -12, detection: 'true-peak' }, { target: 0 }],
  bound: 1,
  passThrough: { values: {}, tolerance: 0 },
});
