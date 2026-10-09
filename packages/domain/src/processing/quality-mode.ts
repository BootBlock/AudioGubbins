/**
 * How much processing spends on quality, as one statement.
 *
 * REQ-AUDIO-086 asks for named levels that map to explicit values, never an
 * opaque mode, and REQ-AUDIO-143 for a final render that defaults to the
 * highest. ADR-0061 makes `QualityMode` the one model of it: each level is a
 * fixed set of values of the quality settings the processors read, and Custom
 * is the same settings chosen one by one, so the Inspector can show what a
 * level means and the person can change any of it (REQ-AUDIO-080).
 *
 * A setting is read only by the processors whose descriptors name it, and
 * changes nothing a canonical render does except through those processors.
 */

import { failure, FailureKind, fail, succeed, type DomainResult } from '../result.js';

/** The named levels, and Custom. */
export const QualityLevel = {
  Draft: 'draft',
  Standard: 'standard',
  High: 'high',
  Maximum: 'maximum',
  Custom: 'custom',
} as const;

/** The named levels, and Custom. */
export type QualityLevel = (typeof QualityLevel)[keyof typeof QualityLevel];

/** A named level: every level but Custom. */
export type NamedQualityLevel = Exclude<QualityLevel, typeof QualityLevel.Custom>;

/** How much a conversion of rate spends on a flat passband and a deep stopband. */
export const ResamplingGrade = { Draft: 'draft', High: 'high', Maximum: 'maximum' } as const;

/** How much a conversion of rate spends on a flat passband and a deep stopband. */
export type ResamplingGrade = (typeof ResamplingGrade)[keyof typeof ResamplingGrade];

/**
 * Which inference path a preview may take. A final render always takes the
 * pinned path (ADR-0062), whatever this says.
 */
export const InferencePath = { Pinned: 'pinned', Accelerated: 'accelerated' } as const;

/** Which inference path a preview may take. */
export type InferencePath = (typeof InferencePath)[keyof typeof InferencePath];

/**
 * The values a quality level sets.
 *
 * - `resampling`: the grade of every conversion of rate.
 * - `oversampling`: how many times a processor that measures between samples
 *   (a true-peak limiter) or bends a waveform runs above its rate.
 * - `spectralOverlap`: how many analysis frames of a spectral processor cover
 *   each sample, which trades time smearing for cost.
 * - `inference`: the path a preview of a model may take.
 */
export interface QualitySettings {
  readonly resampling: ResamplingGrade;
  readonly oversampling: 1 | 2 | 4 | 8;
  readonly spectralOverlap: 2 | 4 | 8;
  readonly inference: InferencePath;
}

/** The name of one quality setting, as a processor's descriptor names those it reads. */
export type QualitySettingKey = keyof QualitySettings;

/** A level and the values it stands for. */
export interface QualityMode {
  readonly level: QualityLevel;
  readonly settings: QualitySettings;
}

/** What each named level sets. */
const LEVELS: Readonly<Record<NamedQualityLevel, QualitySettings>> = {
  draft: {
    resampling: ResamplingGrade.Draft,
    oversampling: 1,
    spectralOverlap: 2,
    inference: InferencePath.Accelerated,
  },
  standard: {
    resampling: ResamplingGrade.High,
    oversampling: 2,
    spectralOverlap: 4,
    inference: InferencePath.Pinned,
  },
  high: {
    resampling: ResamplingGrade.High,
    oversampling: 4,
    spectralOverlap: 4,
    inference: InferencePath.Pinned,
  },
  maximum: {
    resampling: ResamplingGrade.Maximum,
    oversampling: 8,
    spectralOverlap: 8,
    inference: InferencePath.Pinned,
  },
};

/** The named levels from cheapest to best, as a choice lists them. */
export const NAMED_QUALITY_LEVELS: readonly NamedQualityLevel[] = [
  QualityLevel.Draft,
  QualityLevel.Standard,
  QualityLevel.High,
  QualityLevel.Maximum,
];

/** The mode of a named level. */
export function namedQualityMode(level: NamedQualityLevel): QualityMode {
  return { level, settings: LEVELS[level] };
}

/** What a final render uses unless the person chooses otherwise (REQ-AUDIO-143). */
export const MAXIMUM_QUALITY: QualityMode = namedQualityMode(QualityLevel.Maximum);

const OVERSAMPLING: ReadonlySet<unknown> = new Set([1, 2, 4, 8]);
const OVERLAP: ReadonlySet<unknown> = new Set([2, 4, 8]);
const GRADES: ReadonlySet<unknown> = new Set(Object.values(ResamplingGrade));
const PATHS: ReadonlySet<unknown> = new Set(Object.values(InferencePath));

const isGrade = (value: unknown): value is ResamplingGrade => GRADES.has(value);
const isOversampling = (value: unknown): value is QualitySettings['oversampling'] =>
  OVERSAMPLING.has(value);
const isOverlap = (value: unknown): value is QualitySettings['spectralOverlap'] =>
  OVERLAP.has(value);
const isPath = (value: unknown): value is InferencePath => PATHS.has(value);

function settingUnknown(): DomainResult<never> {
  return fail(
    failure(
      'quality.setting-unknown',
      FailureKind.Rejected,
      'A quality setting holds a value no level offers.',
    ),
  );
}

/**
 * The mode a record of settings that crossed a thread or came from storage
 * states, or why it states none: the one reading of untyped settings, so
 * every reader refuses the same values. Equal to a named level, it is that
 * level, so a Custom choice that happens to be a level says so; otherwise it
 * is Custom.
 */
export function qualityModeFrom(value: unknown): DomainResult<QualityMode> {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('resampling' in value) ||
    !('oversampling' in value) ||
    !('spectralOverlap' in value) ||
    !('inference' in value)
  ) {
    return settingUnknown();
  }
  const { resampling, oversampling, spectralOverlap, inference } = value;
  if (
    !isGrade(resampling) ||
    !isOversampling(oversampling) ||
    !isOverlap(spectralOverlap) ||
    !isPath(inference)
  ) {
    return settingUnknown();
  }
  return succeed(qualityModeOf({ resampling, oversampling, spectralOverlap, inference }));
}

/**
 * The mode `settings` are: the named level they equal, so a Custom choice
 * that happens to be a level says so, and Custom otherwise.
 */
export function qualityModeOf(settings: QualitySettings): QualityMode {
  const named = NAMED_QUALITY_LEVELS.find((level) => sameSettings(LEVELS[level], settings));
  return named === undefined ? { level: QualityLevel.Custom, settings } : namedQualityMode(named);
}

function sameSettings(left: QualitySettings, right: QualitySettings): boolean {
  return (
    left.resampling === right.resampling &&
    left.oversampling === right.oversampling &&
    left.spectralOverlap === right.spectralOverlap &&
    left.inference === right.inference
  );
}

/**
 * The settings a final render runs at: the mode's, with inference pinned,
 * since an accelerated path is never a final render's (ADR-0062).
 */
export function finalRenderSettings(mode: QualityMode): QualitySettings {
  return { ...mode.settings, inference: InferencePath.Pinned };
}
