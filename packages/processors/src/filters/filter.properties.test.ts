import { processorProperties } from '../testing/processor-properties.js';
import { framesToSilence } from '../testing/tail-measures.js';
import { EVERY_LAYOUT, cookbookPoleRadius } from '../testing/filter-measures.js';
import { FILTER } from './filter.js';

processorProperties(FILTER, {
  layouts: EVERY_LAYOUT,
  settings: [
    { mode: 'high-pass', slope: '48-db', cutoff: 200, resonance: 2 },
    { mode: 'band-pass', slope: '24-db', cutoff: 3_000, resonance: 4 },
    { mode: 'notch', slope: '36-db', cutoff: 50, resonance: 10 },
    { mode: 'all-pass', slope: '12-db', cutoff: 20_000, resonance: 0.1 },
  ],
  // Its one boost is the resonance's at the cutoff, `2 / (1/√2)` times the
  // flat filter's `1/√2` there, 2; bounded at four times its peak gain, as
  // the cut-only filters are, for ringing.
  bound: 8,
  // One band-pass section of Q 4, whose pole pair sets the decay.
  fallsSilent: {
    values: { mode: 'band-pass', slope: '12-db', cutoff: 1_000, resonance: 4 },
    frames: framesToSilence(cookbookPoleRadius(1_000, 4)),
  },
});
