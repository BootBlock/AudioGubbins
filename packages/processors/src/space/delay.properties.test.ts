import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { framesToSilence } from '../testing/tail-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { DELAY } from './delay.js';

// Each echo is the last through a low-pass whose impulse response is positive
// and sums to 1, times the feedback, so the echoes of full scale sum to at most
// `1 / (1 − 0.95)`, cross-fed or not.
const BOUND = 1 / (1 - 0.95);

processorProperties(DELAY, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
  settings: [
    { time: 1, feedback: 95, damping: 200, 'cross-feed': true },
    { time: 4_000, feedback: 0, damping: 20_000 },
    { time: 10.3, feedback: 60, damping: 20_000, 'cross-feed': true },
  ],
  bound: BOUND,
  // Echoes 48 frames apart, each 0.6 of the last at DC, where the low-pass
  // takes nothing and the loop decays slowest.
  fallsSilent: {
    values: { time: 1, feedback: 60, damping: 20_000 },
    frames: 48 + framesToSilence(0.6 ** (1 / 48)),
  },
});

processorProperties(DELAY, {
  layouts: [setLayout(1, 'sn3d')],
  settings: [{ time: 1, feedback: 95, damping: 200 }],
  bound: BOUND,
});
