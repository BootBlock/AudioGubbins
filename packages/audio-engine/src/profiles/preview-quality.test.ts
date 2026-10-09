import { QualityLevel } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { PerformanceProfile } from './performance-profile.js';
import { previewQualityFor } from './preview-quality.js';

describe('previewQualityFor', () => {
  it.each([
    [PerformanceProfile.LowLatency, QualityLevel.Draft],
    [PerformanceProfile.Balanced, QualityLevel.Standard],
    [PerformanceProfile.MaximumStability, QualityLevel.High],
    [PerformanceProfile.Custom, QualityLevel.Standard],
  ])('previews %s at %s', (profile, level) => {
    expect(previewQualityFor(profile).level).toBe(level);
  });
});
