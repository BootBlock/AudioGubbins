import { processorProperties } from '../testing/processor-properties.js';
import { AMBISONIC_LAYOUTS } from '../testing/space-measures.js';
import { AMBISONIC_DECODER } from './ambisonic-decode.js';

processorProperties(AMBISONIC_DECODER, {
  layouts: AMBISONIC_LAYOUTS,
  settings: [
    { speakers: 'quadraphonic' },
    { speakers: 'surround-5-1' },
    { speakers: 'surround-7-1' },
  ],
  bound: 16,
});
