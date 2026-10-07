import { processorProperties } from '../testing/processor-properties.js';
import { EVERY_LAYOUT } from '../testing/filter-measures.js';
import { FILTER } from './filter.js';

processorProperties(FILTER, {
  layouts: EVERY_LAYOUT,
  settings: [
    { mode: 'high-pass', slope: '48-db', cutoff: 200, resonance: 2 },
    { mode: 'band-pass', slope: '24-db', cutoff: 3_000, resonance: 4 },
    { mode: 'notch', slope: '36-db', cutoff: 50, resonance: 10 },
    { mode: 'all-pass', slope: '12-db', cutoff: 20_000, resonance: 0.1 },
  ],
});
