/**
 * The compressor's transfer curve, as a panel draws it: the level it gives
 * out for each steady level in, in decibels, by the static curve its kernel
 * runs (`compressionDecibels`) with the make-up gain added, so the curve on
 * screen is the one heard once the detector has settled.
 */

import type { ParameterValues } from '@audiogubbins/domain';

import { COMPRESSOR_CURVE } from './compressor.js';
import { compressionDecibels } from './envelope.js';
import { numberIn } from './ramped-parameters.js';

/**
 * Writes to `into` the level in decibels the compressor set by `values` gives
 * out for each level in decibels of `levels`, once its detector has settled.
 */
export function compressorTransfer(
  values: ParameterValues,
  levels: Float64Array,
  into: Float64Array,
): void {
  const frames = levels.length;
  const filled = (value: number): Float64Array => new Float64Array(frames).fill(value);
  into.set(levels);
  compressionDecibels(
    into,
    {
      threshold: filled(numberIn(values, COMPRESSOR_CURVE.threshold)),
      ratio: filled(numberIn(values, COMPRESSOR_CURVE.ratio)),
      knee: filled(numberIn(values, COMPRESSOR_CURVE.knee)),
    },
    frames,
  );
  const makeUp = numberIn(values, COMPRESSOR_CURVE.makeUp);
  for (let frame = 0; frame < frames; frame += 1) {
    into[frame] = (levels[frame] ?? 0) + (into[frame] ?? 0) + makeUp;
  }
}
