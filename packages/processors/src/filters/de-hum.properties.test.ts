import { processorProperties } from '../testing/processor-properties.js';
import { framesToSilence } from '../testing/tail-measures.js';
import { EVERY_LAYOUT, cookbookPoleRadius } from '../testing/filter-measures.js';
import { DE_HUM } from './de-hum.js';

processorProperties(DE_HUM, {
  layouts: EVERY_LAYOUT,
  settings: [
    { fundamental: '60-hz', harmonics: 12, q: 100 },
    { depth: 20, q: 5, offset: 1.5, harmonics: 1 },
  ],
  bound: 4,
  // At no depth every notch is a peaking section of 0 dB, whose numerator
  // and denominator are one, so the input passes to the bit.
  passThrough: { values: { depth: 0 }, tolerance: 0 },
  // One full notch at 50 Hz, of the widest Q, whose pole pair sets the decay.
  fallsSilent: {
    values: { fundamental: '50-hz', harmonics: 1, q: 5 },
    frames: framesToSilence(cookbookPoleRadius(50, 5)),
  },
});
