import { processorProperties } from '../testing/processor-properties.js';
import { EVERY_LAYOUT } from '../testing/filter-measures.js';
import { DE_CLICK } from './de-click.js';

processorProperties(DE_CLICK, {
  layouts: EVERY_LAYOUT,
  settings: [
    { sensitivity: 4, 'maximum-length': 2 },
    { output: 'clicks', 'maximum-length': 0.1 },
  ],
  // At the least sensitivity nothing in the programme is a click, so this
  // holds the declared latency to the kernel's, bit for bit.
  passThrough: { values: { sensitivity: 30 }, tolerance: 0 },
});
