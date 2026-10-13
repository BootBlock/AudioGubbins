/**
 * Microsoft ADPCM (WAV code 2), as Microsoft's "Multimedia Standards Update" of
 * 1994 defines it: four bits a sample, each the error of a prediction from the
 * two samples before it, scaled by a delta that adapts by a 16-entry table.
 *
 * The prediction is `(sample1 × coefficient1 + sample2 × coefficient2) / 256`,
 * the division truncating toward zero as the reference's C does; a block's
 * header chooses the pair of coefficients from the format chunk's table and
 * holds the delta and the first two samples whole. The encoder expands each
 * nibble it chooses with the same expansion, so it tracks the decoder exactly.
 */

/** How each nibble scales the delta, in 256ths. */
const ADAPTATION: readonly number[] = [
  230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230,
];

/** The smallest delta, below which the reference never lets it fall. */
const MINIMUM_DELTA = 16;

/**
 * The largest delta, past which a run of the loudest nibbles would grow it
 * without end. The bound FFmpeg's decoder holds, so the two agree on a hostile
 * block, and far above any delta a real signal reaches.
 */
const MAXIMUM_DELTA = Math.floor(2_147_483_647 / 768);

/** The seven coefficient pairs every Microsoft ADPCM format chunk begins with. */
export const STANDARD_COEFFICIENTS: readonly (readonly [number, number])[] = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232],
];

/** One channel's decoder state: the last two samples, the delta and the coefficients. */
export interface MsState {
  sample1: number;
  sample2: number;
  delta: number;
  coefficient1: number;
  coefficient2: number;
}

/** Clamps to a 16-bit sample. */
function clampSample(value: number): number {
  return value > 32_767 ? 32_767 : value < -32_768 ? -32_768 : value;
}

/** The prediction of the next sample from the state. */
function prediction(state: MsState): number {
  return Math.trunc(
    (state.sample1 * state.coefficient1 + state.sample2 * state.coefficient2) / 256,
  );
}

/** Expands one nibble from `state`, moves the state on, and answers the new sample. */
export function expandMs(state: MsState, nibble: number): number {
  const error = nibble >= 8 ? nibble - 16 : nibble;
  const sample = clampSample(prediction(state) + error * state.delta);
  state.sample2 = state.sample1;
  state.sample1 = sample;
  const delta = Math.floor(((ADAPTATION[nibble] ?? 0) * state.delta) / 256);
  state.delta = Math.min(Math.max(delta, MINIMUM_DELTA), MAXIMUM_DELTA);
  return sample;
}

/**
 * The nibble whose expansion lands nearest `sample`, the error divided by the
 * delta and rounded half away from zero as the reference encoder rounds it,
 * with `state` moved on by that expansion.
 */
export function compressMs(state: MsState, sample: number): number {
  const error = sample - prediction(state);
  const half = Math.floor(state.delta / 2);
  const scaled = Math.trunc((error + (error < 0 ? -half : half)) / state.delta);
  const nibble = (scaled < -8 ? -8 : scaled > 7 ? 7 : scaled) & 0x0f;
  expandMs(state, nibble);
  return nibble;
}
