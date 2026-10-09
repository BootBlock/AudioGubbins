import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { framesToSilence } from '../testing/tail-measures.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { setLayout } from '../testing/space-measures.js';
import { REVERB } from './reverb.js';
import { lineLengths } from './reverb-network.js';

/** The decay time the tail is read at, in seconds. */
const DECAY = 0.1;

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
  // Undamped, every line falls 60 dB each decay time, and once every state is
  // flushed the lines are read clear within the longest of them.
  fallsSilent: {
    values: { decay: DECAY, damping: 0, 'pre-delay': 0 },
    frames:
      framesToSilence(10 ** (-3 / (DECAY * TEST_RATE))) + Math.max(...lineLengths(0.6, TEST_RATE)),
  },
});
