/**
 * How a quality mode is written (ADR-0061, REQ-AUDIO-086): its level, and the
 * explicit value of each setting it stands for, in the words the commands,
 * the Transport panel and the Audio settings all use. At the root of the
 * application, below all three, so a level never means one thing in a
 * command's description and another in the panel.
 */

import {
  QualityLevel,
  ResamplingGrade,
  type QualitySettingKey,
  type QualitySettings,
} from '@audiogubbins/domain';

/** What each quality level is called, standing alone as it does in a list. */
export const QUALITY_LEVEL_NAMES: Readonly<Record<QualityLevel, string>> = {
  [QualityLevel.Draft]: 'Draft',
  [QualityLevel.Standard]: 'Standard',
  [QualityLevel.High]: 'High',
  [QualityLevel.Maximum]: 'Maximum',
  [QualityLevel.Custom]: 'Custom',
};

/** What each setting is called, standing alone as it does beside its value. */
export const QUALITY_SETTING_NAMES: Readonly<Record<QualitySettingKey, string>> = {
  resampling: 'Resampling',
  oversampling: 'Oversampling',
  spectralOverlap: 'Spectral overlap',
};

/** The settings in the order they are read out. */
export const QUALITY_SETTING_KEYS: readonly QualitySettingKey[] = [
  'resampling',
  'oversampling',
  'spectralOverlap',
];

/** What each resampling grade is called. */
export const RESAMPLING_NAMES: Readonly<Record<ResamplingGrade, string>> = {
  [ResamplingGrade.Draft]: 'Draft',
  [ResamplingGrade.High]: 'High',
  [ResamplingGrade.Maximum]: 'Maximum',
};

/** What each oversampling factor is called; keyed by every factor, so one added is named here. */
export const OVERSAMPLING_NAMES: Readonly<Record<QualitySettings['oversampling'], string>> = {
  1: 'None',
  2: '2 times',
  4: '4 times',
  8: '8 times',
};

/** What each spectral overlap is called; keyed by every overlap, so one added is named here. */
export const OVERLAP_NAMES: Readonly<Record<QualitySettings['spectralOverlap'], string>> = {
  2: '2 frames',
  4: '4 frames',
  8: '8 frames',
};

/** The value `key` has in `settings`, as the panel and the settings write it. */
function qualityValueText(settings: QualitySettings, key: QualitySettingKey): string {
  switch (key) {
    case 'resampling':
      return RESAMPLING_NAMES[settings.resampling];
    case 'oversampling':
      return OVERSAMPLING_NAMES[settings.oversampling];
    case 'spectralOverlap':
      return OVERLAP_NAMES[settings.spectralOverlap];
  }
}

/** Every value `settings` sets, in one sentence a description can carry. */
export function qualitySentence(settings: QualitySettings): string {
  const values = QUALITY_SETTING_KEYS.map((key, index) => {
    const name = QUALITY_SETTING_NAMES[key];
    const value = qualityValueText(settings, key).toLowerCase();
    return `${index === 0 ? name : name.toLowerCase()} ${value}`;
  });
  return `${values.join(', ')}.`;
}

/** The settings of `read` in which `one` and `other` differ, in reading order. */
function differingSettings(
  one: QualitySettings,
  other: QualitySettings,
  read: ReadonlySet<QualitySettingKey>,
): readonly QualitySettingKey[] {
  return QUALITY_SETTING_KEYS.filter((key) => read.has(key) && one[key] !== other[key]);
}

/** Every setting, which the playback of a whole sound reads one or other of. */
const EVERY_SETTING: ReadonlySet<QualitySettingKey> = new Set(QUALITY_SETTING_KEYS);

/**
 * Where a preview at `preview` differs from a final render at `render`, said
 * plainly, so the person knows what they hear is not quite what a render
 * makes. Both are the values each runs at, a render's with its inference
 * pinned. Only the settings `read` names count, as a chain's processors read
 * only theirs; every setting where it names none.
 */
export function previewDifferenceText(
  preview: QualitySettings,
  render: QualitySettings,
  read: ReadonlySet<QualitySettingKey> = EVERY_SETTING,
): string {
  const differing = differingSettings(preview, render, read).map(
    (key) =>
      `${QUALITY_SETTING_NAMES[key].toLowerCase()} (${qualityValueText(preview, key).toLowerCase()}, against ${qualityValueText(render, key).toLowerCase()})`,
  );
  const last = differing.pop();
  if (last === undefined) {
    return 'Playback previews at the values a render runs at, so what you hear is what a render makes.';
  }
  const listed = differing.length === 0 ? last : `${differing.join(', ')} and ${last}`;
  return `Playback differs from a render in ${listed}, so what you hear is not exactly what a render makes.`;
}
