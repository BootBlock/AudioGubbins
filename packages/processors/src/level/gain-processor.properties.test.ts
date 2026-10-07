import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { GAIN_PROCESSOR } from './gain-processor.js';

processorProperties(GAIN_PROCESSOR, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
  settings: [{ gain: -12 }, { gain: 24 }],
  bound: 16,
  passThrough: { values: { gain: 0 }, tolerance: 0 },
});
