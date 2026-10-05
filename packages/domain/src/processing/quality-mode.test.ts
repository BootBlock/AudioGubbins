import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import {
  InferencePath,
  MAXIMUM_QUALITY,
  NAMED_QUALITY_LEVELS,
  QualityLevel,
  ResamplingGrade,
  finalRenderSettings,
  namedQualityMode,
  qualityModeFrom,
  type QualitySettings,
} from './quality-mode.js';

describe('the named quality levels', () => {
  it('map each level to its explicit values, so no level is an opaque mode (REQ-AUDIO-086)', () => {
    expect(namedQualityMode(QualityLevel.Draft)).toEqual({
      level: 'draft',
      settings: {
        resampling: 'draft',
        oversampling: 1,
        spectralOverlap: 2,
        inference: 'accelerated',
      },
    });
    expect(namedQualityMode(QualityLevel.Standard)).toEqual({
      level: 'standard',
      settings: { resampling: 'high', oversampling: 2, spectralOverlap: 4, inference: 'pinned' },
    });
    expect(namedQualityMode(QualityLevel.High)).toEqual({
      level: 'high',
      settings: { resampling: 'high', oversampling: 4, spectralOverlap: 4, inference: 'pinned' },
    });
    expect(namedQualityMode(QualityLevel.Maximum)).toEqual({
      level: 'maximum',
      settings: { resampling: 'maximum', oversampling: 8, spectralOverlap: 8, inference: 'pinned' },
    });
  });

  it('lists the levels cheapest first, and makes the final render’s default the best (REQ-AUDIO-143)', () => {
    expect(NAMED_QUALITY_LEVELS).toEqual(['draft', 'standard', 'high', 'maximum']);
    expect(MAXIMUM_QUALITY).toEqual(namedQualityMode(QualityLevel.Maximum));
  });
});

describe('qualityModeFrom', () => {
  it('names the level a choice equals, so a Custom choice that is a level says so', () => {
    for (const level of NAMED_QUALITY_LEVELS) {
      const settings: QualitySettings = { ...namedQualityMode(level).settings };
      expect(expectSuccess(qualityModeFrom(settings))).toEqual(namedQualityMode(level));
    }
  });

  it('is Custom, with the settings as chosen, where they equal no level', () => {
    const settings: QualitySettings = {
      resampling: ResamplingGrade.Maximum,
      oversampling: 1,
      spectralOverlap: 8,
      inference: InferencePath.Pinned,
    };
    expect(expectSuccess(qualityModeFrom(settings))).toEqual({
      level: QualityLevel.Custom,
      settings,
    });
    // One setting away from Standard, in each setting in turn, so a comparison
    // that ignored any one of them would name Standard.
    const standard = namedQualityMode(QualityLevel.Standard).settings;
    for (const changed of [
      { ...standard, resampling: ResamplingGrade.Maximum },
      { ...standard, oversampling: 8 },
      { ...standard, spectralOverlap: 8 },
      { ...standard, inference: InferencePath.Accelerated },
    ] satisfies QualitySettings[]) {
      expect(expectSuccess(qualityModeFrom(changed)).level).toBe(QualityLevel.Custom);
    }
  });

  it('refuses a value no level offers, in each setting, since a document may hold anything', () => {
    const standard = namedQualityMode(QualityLevel.Standard).settings;
    const withoutInference = {
      resampling: standard.resampling,
      oversampling: standard.oversampling,
      spectralOverlap: standard.spectralOverlap,
    };
    for (const unknown of [
      { ...standard, resampling: 'fastest' },
      { ...standard, oversampling: 3 },
      { ...standard, oversampling: '2' },
      { ...standard, spectralOverlap: 1 },
      { ...standard, inference: 'cloud' },
      withoutInference,
      null,
      'standard',
    ]) {
      expect(expectFailureCode(qualityModeFrom(unknown))).toBe('quality.setting-unknown');
    }
  });
});

describe('finalRenderSettings', () => {
  it('pins inference for a final render even at a level whose preview is accelerated (ADR-0062)', () => {
    expect(finalRenderSettings(namedQualityMode(QualityLevel.Draft))).toEqual({
      resampling: 'draft',
      oversampling: 1,
      spectralOverlap: 2,
      inference: 'pinned',
    });
    expect(finalRenderSettings(MAXIMUM_QUALITY)).toEqual(MAXIMUM_QUALITY.settings);
  });
});
