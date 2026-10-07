import { processorProperties } from '../testing/processor-properties.js';
import { EVERY_LAYOUT } from '../testing/filter-measures.js';
import { DC_OFFSET_REMOVAL } from './dc-offset-removal.js';

processorProperties(DC_OFFSET_REMOVAL, {
  layouts: EVERY_LAYOUT,
  settings: [{ cutoff: 2 }, { cutoff: 40 }],
  bound: 4,
});
