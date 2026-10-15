import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import { TEST_RATE } from '../testing/processor-run.js';
import { framesToSilence } from '../testing/tail-measures.js';
import { SPATIAL_PANNER } from './spatial-panner.js';

/** A far emitter heard through the deepest distance filter, whose tail is the longest. */
const FILTERED = {
  x: 40,
  y: 2,
  z: 30,
  attenuation: 'inverse-square',
  'unit-size': 1,
  'filter-cutoff': 200,
  'filter-decibels': -80,
} as const;

/**
 * The larger pole radius of Godot's high shelf at a linear `gain` and
 * `cutoff`, Q = 1, worked out with the platform's trigonometry: at the
 * panner's far emitter its filter's gain is all but the floor.
 */
function shelfPoleRadius(gain: number, cutoff: number): number {
  const omega = (2 * Math.PI * cutoff) / TEST_RATE;
  const slope = Math.sqrt(gain) * Math.sin(omega);
  const a0 = gain + 1 - (gain - 1) * Math.cos(omega) + slope;
  const a1 = (2 * (gain - 1 - (gain + 1) * Math.cos(omega))) / a0;
  const a2 = (gain + 1 - (gain - 1) * Math.cos(omega) - slope) / a0;
  const discriminant = a1 * a1 - 4 * a2;
  return discriminant < 0 ? Math.sqrt(a2) : (Math.abs(a1) + Math.sqrt(discriminant)) / 2;
}

processorProperties(SPATIAL_PANNER, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo],
  settings: [
    FILTERED,
    { ...FILTERED, 'max-distance': 60, 'panning-strength': 1, 'filter-cutoff': 19_000 },
    {
      space: '2d',
      attenuation: 'exponent',
      x: -700,
      y: 300,
      'max-distance': 2_000,
      exponent: 3,
      'filter-decibels': -12,
    },
    { attenuation: 'logarithmic', ceiling: 24, 'filter-decibels': 0, 'panning-strength': 1 },
  ],
  // The loudest an emitter is heard: at the highest ceiling, 24 dB, centred
  // by the equal-power law, `10^(24/20)/√2`.
  bound: 11.3,
  fallsSilent: { values: FILTERED, frames: framesToSilence(shelfPoleRadius(0.001, 200)) },
});
