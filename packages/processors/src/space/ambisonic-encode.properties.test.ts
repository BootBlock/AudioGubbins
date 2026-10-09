import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { AMBISONIC_ENCODER } from './ambisonic-encode.js';

processorProperties(AMBISONIC_ENCODER, {
  layouts: [StandardLayouts.mono],
  settings: [
    { azimuth: 135, elevation: 45, order: 'third', normalisation: 'fuma' },
    { azimuth: -90, elevation: -30, order: 'second', normalisation: 'n3d' },
    { azimuth: 180, elevation: 90, order: 'third', normalisation: 'sn3d' },
  ],
  // The largest harmonic of any normalisation to the third order: N3D's
  // `√(2l + 1)` times SN3D's peak of one, at `l = 3`.
  bound: Math.sqrt(7),
});
