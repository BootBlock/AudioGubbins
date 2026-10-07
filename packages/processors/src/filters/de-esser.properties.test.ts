import { processorProperties } from '../testing/processor-properties.js';
import { EVERY_LAYOUT } from '../testing/filter-measures.js';
import { DE_ESSER } from './de-esser.js';

processorProperties(DE_ESSER, {
  layouts: EVERY_LAYOUT,
  settings: [
    { mode: 'wideband', threshold: -50, range: 24, attack: 0.1, release: 5 },
    { frequency: 12_000, threshold: -60, range: 12, attack: 20, release: 500 },
  ],
  bound: 4,
  // With no range the gain is unity, and `x − 0·band` is the input to the bit.
  passThrough: { values: { range: 0, threshold: -60 }, tolerance: 0 },
});
