import { processorProperties } from '../testing/processor-properties.js';
import { AMBISONIC_LAYOUTS } from '../testing/space-measures.js';
import { AMBISONIC_ROTATION } from './ambisonic-rotate.js';

processorProperties(AMBISONIC_ROTATION, {
  layouts: AMBISONIC_LAYOUTS,
  settings: [
    { yaw: 90, pitch: -30, roll: 45 },
    { yaw: -180, pitch: 180, roll: -180 },
  ],
  // A rotation is orthogonal within each degree, so a component takes at most
  // `√(2l + 1)` of components at full scale, `√7` at the third order; moved
  // from and back to FuMa, whose weights within a degree differ by up to
  // `√(9/5)`, it takes that much more.
  bound: Math.sqrt((7 * 9) / 5),
  passThrough: { values: { yaw: 0, pitch: 0, roll: 0 }, tolerance: 1e-6 },
});
