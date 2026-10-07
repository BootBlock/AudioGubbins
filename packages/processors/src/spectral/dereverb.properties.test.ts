import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { DEREVERBERATION } from './dereverb.js';

const FIRST_ORDER = setLayout(1, 'sn3d');
processorProperties(DEREVERBERATION, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo],
  settings: [
    { strength: 50, delay: 3, order: 12, adaptation: 0.5 },
    { delay: 8, order: 1, adaptation: 30 },
  ],
  passThrough: { values: { strength: 0 }, tolerance: 1e-6 },
});

// Every channel is predicted from every channel, at a cost that grows with the
// cube of their frames, so the wider layouts are run at lower orders beside
// the default.
processorProperties(DEREVERBERATION, {
  layouts: [StandardLayouts.surround5_1, FIRST_ORDER],
  settings: [
    { strength: 50, order: 2, adaptation: 0.5 },
    { delay: 8, order: 1, adaptation: 30 },
  ],
  passThrough: { values: { strength: 0, order: 1 }, tolerance: 1e-6 },
});
