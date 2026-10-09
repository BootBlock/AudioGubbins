import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { learnedProfile, noiseOf } from '../testing/spectral-measures.js';
import { setLayout } from '../testing/space-measures.js';
import { NOISE_REDUCTION } from './noise-reduction.js';

const FIRST_ORDER = setLayout(1, 'sn3d');
const LAYOUTS = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  StandardLayouts.surround5_1,
  FIRST_ORDER,
];

// Without a profile the node writes its input delayed, and reaches no DSP.
processorProperties(NOISE_REDUCTION, {
  layouts: LAYOUTS,
  settings: [
    { reduction: 60, sensitivity: 18, smoothing: 0, mode: 'noise', resolution: '8192' },
    { reduction: 0, smoothing: 100, resolution: '1024' },
  ],
  bound: 1,
  passThrough: { values: {}, tolerance: 0 },
});

// With a profile learned from each channel’s own noise.
processorProperties(NOISE_REDUCTION, {
  readsDsp: true,
  layouts: LAYOUTS,
  settings: [
    { reduction: 60, sensitivity: 18, smoothing: 0, mode: 'noise', resolution: '8192' },
    { reduction: 0, smoothing: 100, resolution: '1024' },
  ],
  // Its gains only cut, but a cut can raise a peak, as a full-scale square
  // that loses harmonics rings past full scale: bounded as the other
  // filters that only cut are.
  bound: 4,
  state: (layout, values) => learnedProfile(layout, noiseOf(layout), values),
});
