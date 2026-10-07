import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { COMPRESSOR } from './compressor.js';

const FIRST_ORDER = setLayout(1, 'sn3d');
const HARD = { threshold: -40, ratio: 20, knee: 0, attack: 0.1, release: 5, 'make-up': 12 };

processorProperties(COMPRESSOR, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
  settings: [HARD, { detector: 'rms', link: false, threshold: -30, attack: 200, release: 2_000 }],
  passThrough: { values: { ratio: 1 }, tolerance: 0 },
});

processorProperties(COMPRESSOR, {
  layouts: [FIRST_ORDER],
  settings: [HARD, { detector: 'rms', threshold: -30 }],
  passThrough: { values: { ratio: 1 }, tolerance: 0 },
});
