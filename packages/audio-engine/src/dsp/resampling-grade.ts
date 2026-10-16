/**
 * The resampler's quality for each grade a quality mode names (ADR-0061): the
 * one place the domain's grades meet the ABI's codes, so a quality level and
 * the conversion it asks for cannot disagree.
 *
 * A game preview's varispeed voice (ADR-0104) is played at the grade of the
 * quality the preview plays at (`previewQualityFor`): Draft at the profile with
 * the least latency, High otherwise. What its filter costs is stated here, so
 * the preview's voice budget is measured against it.
 */

import { ResamplingGrade, VARISPEED_DENOMINATOR } from '@audiogubbins/domain';

import { ResamplingQuality } from './canonical-dsp.js';

const QUALITY_OF_GRADE: Readonly<Record<ResamplingGrade, ResamplingQuality>> = {
  [ResamplingGrade.Draft]: ResamplingQuality.Draft,
  [ResamplingGrade.High]: ResamplingQuality.High,
  [ResamplingGrade.Maximum]: ResamplingQuality.Maximum,
};

/** The resampler's quality for `grade`. */
export function resamplingQualityOf(grade: ResamplingGrade): ResamplingQuality {
  return QUALITY_OF_GRADE[grade];
}

/**
 * The most taps the filter of a varispeed voice has at each grade: a voice
 * played four times as fast, two octaves up, whose stopband starts at a
 * quarter of its source's Nyquist frequency, has the longest filter, and every
 * slower ratio a shorter one or the same. The grade's passband edge and
 * stopband set the length (`crates/resampling/src/quality.rs`).
 */
export const VARISPEED_MOST_TAPS: Readonly<Record<ResamplingGrade, number>> = {
  [ResamplingGrade.Draft]: 309,
  [ResamplingGrade.High]: 1_061,
  [ResamplingGrade.Maximum]: 2_567,
};

/**
 * A bound on the bytes the table of one varispeed voice's filter holds at
 * `grade`, where it is kept: the most taps for every phase as doubles and a
 * flag for each phase, of at most 4,096 phases, since a ratio is a whole
 * number of 4,096ths.
 */
export function varispeedTableBytes(grade: ResamplingGrade): number {
  const phases = VARISPEED_DENOMINATOR;
  return VARISPEED_MOST_TAPS[grade] * phases * Float64Array.BYTES_PER_ELEMENT + phases;
}
