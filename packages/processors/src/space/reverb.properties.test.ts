import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { REVERB } from './reverb.js';

processorProperties(REVERB, {
  layouts: [
    StandardLayouts.mono,
    StandardLayouts.stereo,
    StandardLayouts.surround5_1,
    setLayout(1, 'sn3d'),
  ],
  settings: [
    { size: 1, decay: 30, damping: 0, 'pre-delay': 200 },
    { size: 0.1, decay: 0.1, damping: 90, 'pre-delay': 0, width: 0 },
  ],
});
