/**
 * The quality playback previews at when the person has not chosen one
 * (ADR-0061, REQ-AUDIO-080).
 *
 * A profile that trades margin for latency leaves less time per quantum for a
 * processor to spend, so the lowest-latency profile previews at Draft, and the
 * profile with the most margin can afford High. A final render never reads
 * this: it defaults to Maximum whatever the profile (REQ-AUDIO-143).
 */

import {
  QualityLevel,
  namedQualityMode,
  type NamedQualityLevel,
  type QualityMode,
} from '@audiogubbins/domain';

import { PerformanceProfile } from './performance-profile.js';

/** The level each profile previews at; Custom settings say nothing of quality, so take the middle. */
const PREVIEW_LEVEL: Readonly<Record<PerformanceProfile, NamedQualityLevel>> = {
  [PerformanceProfile.LowLatency]: QualityLevel.Draft,
  [PerformanceProfile.Balanced]: QualityLevel.Standard,
  [PerformanceProfile.MaximumStability]: QualityLevel.High,
  [PerformanceProfile.Custom]: QualityLevel.Standard,
};

/** The quality `profile` previews at unless the person chooses one. */
export function previewQualityFor(profile: PerformanceProfile): QualityMode {
  return namedQualityMode(PREVIEW_LEVEL[profile]);
}
