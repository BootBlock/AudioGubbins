/**
 * IMA ADPCM (the IMA Digital Audio Focus and Technical Working Groups'
 * recommended practice of 1992): four bits a sample, each a step up or down
 * from the last sample, the step size adapting from an 89-entry table.
 *
 * One expansion serves both packings, WAV's (code 0x11) and AIFF-C `ima4`'s,
 * and the encoder chooses each nibble by the reference's comparisons and then
 * expands it with that same expansion, so what it writes decodes to exactly the
 * samples it tracked. Every block starts from its own header: a WAV block's
 * header holds its first sample whole, and an `ima4` packet's holds the
 * predictor's top nine bits, which is all Apple's decoder resumes from, so a
 * packet is read alone and each one is the same however far a read seeks.
 */

/** The step sizes, by step index. */
export const IMA_STEPS: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1_060, 1_166, 1_282, 1_411, 1_552, 1_707, 1_878, 2_066, 2_272,
  2_499, 2_749, 3_024, 3_327, 3_660, 4_026, 4_428, 4_871, 5_358, 5_894, 6_484, 7_132, 7_845, 8_630,
  9_493, 10_442, 11_487, 12_635, 13_899, 15_289, 16_818, 18_500, 20_350, 22_385, 24_623, 27_086,
  29_794, 32_767,
];

/** The highest step index. */
export const IMA_LAST_INDEX = IMA_STEPS.length - 1;

/** How each nibble's magnitude moves the step index. */
const INDEX_ADJUSTMENTS: readonly number[] = [-1, -1, -1, -1, 2, 4, 6, 8];

/** The sign bit of a nibble. */
const NEGATIVE = 0b1000;

/** One channel's decoder state: the last sample and the step index. */
export interface ImaState {
  predictor: number;
  index: number;
}

/** Clamps to a 16-bit sample. */
function clampSample(value: number): number {
  return value > 32_767 ? 32_767 : value < -32_768 ? -32_768 : value;
}

/** Expands one nibble from `state`, moves the state on, and answers the new sample. */
export function expandIma(state: ImaState, nibble: number): number {
  const step = IMA_STEPS[state.index] ?? 0;
  // The reference adds the halved steps one by one, each truncated, not (n + ½) × step / 4.
  let difference = step >> 3;
  if ((nibble & 0b100) !== 0) difference += step;
  if ((nibble & 0b010) !== 0) difference += step >> 1;
  if ((nibble & 0b001) !== 0) difference += step >> 2;
  state.predictor = clampSample(
    (nibble & NEGATIVE) === 0 ? state.predictor + difference : state.predictor - difference,
  );
  const index = state.index + (INDEX_ADJUSTMENTS[nibble & 0b111] ?? 0);
  state.index = index < 0 ? 0 : index > IMA_LAST_INDEX ? IMA_LAST_INDEX : index;
  return state.predictor;
}

/**
 * The nibble that moves `state` nearest `sample`, by the reference encoder's
 * comparisons, with `state` moved on by its expansion.
 */
export function compressIma(state: ImaState, sample: number): number {
  const step = IMA_STEPS[state.index] ?? 0;
  let difference = sample - state.predictor;
  let nibble = 0;
  if (difference < 0) {
    nibble = NEGATIVE;
    difference = -difference;
  }
  let threshold = step;
  for (const bit of [0b100, 0b010, 0b001]) {
    if (difference >= threshold) {
      nibble |= bit;
      difference -= threshold;
    }
    threshold >>= 1;
  }
  expandIma(state, nibble);
  return nibble;
}
