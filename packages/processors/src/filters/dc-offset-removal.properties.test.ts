import { processorProperties } from '../testing/processor-properties.js';
import { framesToSilence } from '../testing/tail-measures.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { EVERY_LAYOUT } from '../testing/filter-measures.js';
import { DC_OFFSET_REMOVAL } from './dc-offset-removal.js';

/** The pole of the prewarped first-order high-pass at `cutoff`. */
function onePole(cutoff: number): number {
  const k = Math.tan((Math.PI * cutoff) / TEST_RATE);
  return (1 - k) / (1 + k);
}

processorProperties(DC_OFFSET_REMOVAL, {
  layouts: EVERY_LAYOUT,
  settings: [{ cutoff: 2 }, { cutoff: 40 }],
  bound: 4,
  // Its one pole, `(1 − K)/(1 + K)` with `K = tan(π·fc/fs)`, sets the decay.
  fallsSilent: { values: { cutoff: 40 }, frames: framesToSilence(onePole(40)) },
});
