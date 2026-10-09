/**
 * The resampler's quality for each grade a quality mode names (ADR-0061): the
 * one place the domain's grades meet the ABI's codes, so a quality level and
 * the conversion it asks for cannot disagree.
 */

import { ResamplingGrade } from '@audiogubbins/domain';

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
