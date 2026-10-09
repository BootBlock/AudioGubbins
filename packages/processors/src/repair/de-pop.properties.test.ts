import { processorProperties } from '../testing/processor-properties.js';
import { EVERY_LAYOUT } from '../testing/filter-measures.js';
import { DE_POP } from './de-pop.js';

processorProperties(DE_POP, {
  layouts: EVERY_LAYOUT,
  // It takes a pop's low-passed part away: bounded as the cut-only filters are.
  bound: 4,
  settings: [
    { sensitivity: 6, frequency: 20, 'maximum-length': 50 },
    { frequency: 300, 'maximum-length': 5 },
  ],
  // At the least sensitivity nothing in the programme is a pop, so this
  // holds the declared latency to the kernel's, bit for bit.
  passThrough: { values: { sensitivity: 40 }, tolerance: 0 },
});
