import { StandardLayouts } from '@audiogubbins/domain';
import { decibelsToGain } from '@audiogubbins/audio-engine';

import { processorProperties } from '../testing/processor-properties.js';
import { GAIN_PROCESSOR } from './gain-processor.js';

processorProperties(GAIN_PROCESSOR, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
  settings: [{ gain: -12 }, { gain: 24 }],
  // Full scale times its largest gain, rounded to a float32 as the output is.
  bound: Math.fround(decibelsToGain(24)),
  passThrough: { values: { gain: 0 }, tolerance: 0 },
});
