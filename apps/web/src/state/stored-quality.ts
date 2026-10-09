/**
 * A quality mode as the audio settings keep it (ADR-0061): one object for
 * each named level, and a mode read back from storage field by field.
 *
 * The playback control and the peaks compare a mode by identity to learn
 * whether the sound changed, so a named level is always the same object, and
 * a mode the person sets again unchanged is never a new one.
 */

import {
  MAXIMUM_QUALITY,
  QualityLevel,
  namedQualityMode,
  qualityModeFrom,
  type NamedQualityLevel,
  type QualityMode,
  type QualitySettingKey,
  type QualitySettings,
} from '@audiogubbins/domain';

import { QUALITY_SETTING_KEYS } from '../quality-words.js';
import { isRecord } from './stored-value.js';

/** Each named level's mode, made once. */
const NAMED_MODES: Readonly<Record<NamedQualityLevel, QualityMode>> = {
  [QualityLevel.Draft]: namedQualityMode(QualityLevel.Draft),
  [QualityLevel.Standard]: namedQualityMode(QualityLevel.Standard),
  [QualityLevel.High]: namedQualityMode(QualityLevel.High),
  [QualityLevel.Maximum]: MAXIMUM_QUALITY,
};

/** The mode of a named level, the same object each time. */
export function namedMode(level: NamedQualityLevel): QualityMode {
  return NAMED_MODES[level];
}

/** `mode`, or the one object of its level where it is a named level. */
export function canonicalQuality(mode: QualityMode): QualityMode {
  return mode.level === QualityLevel.Custom ? mode : NAMED_MODES[mode.level];
}

/** Whether two modes set the same values, which is whether they sound the same. */
export function sameQuality(one: QualityMode, other: QualityMode): boolean {
  return QUALITY_SETTING_KEYS.every((key) => one.settings[key] === other.settings[key]);
}

/**
 * Whether `value` is a value the setting `key` takes, asked of the domain's
 * one reading of quality settings with every other setting as `base` has it.
 */
export function validQualitySetting(
  base: QualitySettings,
  key: QualitySettingKey,
  value: unknown,
): boolean {
  return qualityModeFrom({ ...base, [key]: value }).ok;
}

/**
 * The mode a stored record of settings states, each setting taken only where
 * it is valid and `fallback`'s where it is not, so a stored file that has lost
 * or spoiled one setting costs the person that setting alone.
 */
export function readStoredQuality(stored: unknown, fallback: QualityMode): QualityMode {
  if (!isRecord(stored)) return fallback;
  const settings: Record<string, unknown> = { ...fallback.settings };
  for (const key of QUALITY_SETTING_KEYS) {
    const value = stored[key];
    if (validQualitySetting(fallback.settings, key, value)) settings[key] = value;
  }
  const read = qualityModeFrom(settings);
  return read.ok ? canonicalQuality(read.value) : fallback;
}
