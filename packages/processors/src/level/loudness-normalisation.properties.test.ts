import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { setLayout } from '../testing/space-measures.js';
import { LOUDNESS_NORMALISATION } from './loudness-normalisation.js';

// Its gain is the programme's own, which nothing bounds but the ceiling: the
// impulse, the quietest of the three inputs at −39.7 LUFS on one channel, is
// raised 25.7 dB to −14 LUFS, 19.3 times full scale. The ceiling holds the
// output under it (`loudness-normalisation.test.ts`).
processorProperties(LOUDNESS_NORMALISATION, {
  readsDsp: true,
  layouts: [
    StandardLayouts.mono,
    StandardLayouts.stereo,
    StandardLayouts.surround5_1,
    setLayout(1, 'sn3d'),
  ],
  settings: [{ target: -14 }, { 'limit-true-peak': true, ceiling: -3 }],
  bound: 20,
  passThrough: { values: {}, tolerance: 0 },
});
