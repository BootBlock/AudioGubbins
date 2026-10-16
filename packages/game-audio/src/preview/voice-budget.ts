/**
 * The most voices the game preview sounds at once across all its emitters
 * (ADR-0104, the plan's Q5), past which the triggering emitter's stealing rule
 * is applied across every emitter and the log says so, as a game engine's
 * virtual voices do.
 *
 * What a voice costs is its varispeed: a voice of a pitch other than its
 * member's is played through the canonical resampler, whose filter at the
 * preview's grade has taps in proportion to the faster of its two steps (its
 * cutoff follows the lower rate), up to `VARISPEED_MOST_TAPS` two octaves up,
 * and whose table of taps holds up to `varispeedTableBytes`. A voice at its
 * member's own pitch reads its member as it is and costs little beside, so a
 * preview that varies no pitch is bounded only by its emitters' limits.
 *
 * Measured on the reference machine (`voice-budget.test.ts` holds it): one tap
 * of one stereo voice costs the feeder about 0.2 ms each second of sound,
 * whatever the grade, so {@link REAL_TIME_TAPS} taps of voices take half of
 * every second, the half the preview leaves for reading, panning and mixing:
 *
 * | Grade | Taps, unison | Taps, +2 oct. | Voices, unison | Voices, +2 oct. |
 * | ----- | ------------ | ------------- | -------------- | --------------- |
 * | Draft | 79           | 309           | 26 (tables)    | 8               |
 * | High  | 267          | 1,061         | 7 (tables)     | 2               |
 */

import { VARISPEED_DENOMINATOR, type ResamplingGrade } from '@audiogubbins/domain';
import { VARISPEED_MOST_TAPS, varispeedTableBytes } from '@audiogubbins/audio-engine';

import type { VoiceVariation } from '../policy/playback-rules.js';
import { pitchNumerator } from './preview-draws.js';

/** The taps of stereo varispeed voices the reference machine's feeder plays in half of each second. */
const REAL_TIME_TAPS = 2_500;

/** What the varispeed tables of the preview's voices may hold at once: half what its renders may keep. */
const VARISPEED_TABLE_ALLOWANCE = 256 * 2 ** 20;

/** The fastest a varispeed plays, two octaves up, where `VARISPEED_MOST_TAPS` is stated. */
const FASTEST_NUMERATOR = 4 * VARISPEED_DENOMINATOR;

/** The most voices a preview can sound however cheap they are: 16 emitters of 64. */
export const MOST_PREVIEW_VOICES = 16 * 64;

/**
 * A bound on the taps of a varispeed of `numerator` at `grade`: in proportion
 * to the faster step, `VARISPEED_MOST_TAPS` at the fastest, and two more for
 * the filter's rounding to an odd length.
 */
export function varispeedTaps(grade: ResamplingGrade, numerator: number): number {
  const faster = Math.max(numerator, VARISPEED_DENOMINATOR);
  return Math.ceil((VARISPEED_MOST_TAPS[grade] * faster) / FASTEST_NUMERATOR) + 2;
}

/**
 * The preview's voice budget at `grade` for voices varied by `variations`: as
 * many voices as the costliest pitch any of them may draw plays in real time
 * with tables the allowance holds, at least one; every voice the scenario can
 * sound where none varies its pitch.
 */
export function previewVoiceBudget(
  grade: ResamplingGrade,
  variations: Iterable<VoiceVariation>,
): number {
  let costliest: number | undefined;
  for (const { pitchCents } of variations) {
    if (pitchCents.min === 0 && pitchCents.max === 0) continue;
    const numerator = pitchNumerator(pitchCents.max);
    costliest = Math.max(costliest ?? 0, numerator);
  }
  if (costliest === undefined) return MOST_PREVIEW_VOICES;
  const realTime = Math.floor(REAL_TIME_TAPS / varispeedTaps(grade, costliest));
  const tables = Math.floor(VARISPEED_TABLE_ALLOWANCE / varispeedTableBytes(grade));
  return Math.max(1, Math.min(realTime, tables, MOST_PREVIEW_VOICES));
}
