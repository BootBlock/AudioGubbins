import { processorProperties } from '../testing/processor-properties.js';
import { AMBISONIC_LAYOUTS } from '../testing/space-measures.js';
import { AMBISONIC_ROTATION } from './ambisonic-rotate.js';

processorProperties(AMBISONIC_ROTATION, {
  layouts: AMBISONIC_LAYOUTS,
  settings: [
    { yaw: 90, pitch: -30, roll: 45 },
    { yaw: -180, pitch: 180, roll: -180 },
  ],
  bound: 4,
  passThrough: { values: { yaw: 0, pitch: 0, roll: 0 }, tolerance: 1e-6 },
});
