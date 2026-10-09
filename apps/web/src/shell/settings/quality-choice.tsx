/**
 * One quality choice of the Audio settings, a render's or a preview's
 * (REQ-AUDIO-086): a named level, and beneath it every value the level stands
 * for, each of which the person may set on its own. A value set apart from
 * every level is Custom, which the level shows.
 *
 * Every control runs a command. A value is set alone, through the Custom
 * command, which takes the others as they are, so no form has to be applied.
 */

import type { ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import { QualityLevel, type QualityMode, type QualitySettingKey } from '@audiogubbins/domain';

import {
  OVERLAP_NAMES,
  OVERSAMPLING_NAMES,
  QUALITY_LEVEL_NAMES,
  QUALITY_SETTING_KEYS,
  QUALITY_SETTING_NAMES,
  RESAMPLING_NAMES,
} from '../../quality-words.js';
import type { RunCommand } from './section.js';

/** A level the choice offers, and the command that chooses it. */
export interface QualityOption {
  readonly value: string;
  readonly label: string;
  readonly command: string;
}

/** What one quality choice needs. */
export interface QualityChoiceProps {
  readonly legend: string;
  /** What the choice is now: an option's value, or Custom. */
  readonly chosen: string;
  readonly options: readonly QualityOption[];
  /** The mode in force, whose values the settings below show. */
  readonly mode: QualityMode;
  /** The command that sets one value apart from the levels. */
  readonly customCommand: string;
  /** What is said of the choice beneath its legend. */
  readonly note: string;
  readonly run: RunCommand;
}

/** Each setting's values, as the select offers them, keyed by the value the command takes. */
const SETTING_VALUES: Readonly<Record<QualitySettingKey, Readonly<Record<string, string>>>> = {
  resampling: RESAMPLING_NAMES,
  oversampling: OVERSAMPLING_NAMES,
  spectralOverlap: OVERLAP_NAMES,
};

/** The settings given as numbers, whose select values are their text. */
const NUMERIC: ReadonlySet<QualitySettingKey> = new Set(['oversampling', 'spectralOverlap']);

/** A level, and every value it sets, each run through its command. */
export function QualityChoice(props: QualityChoiceProps): ReactNode {
  const levels = props.options.map(({ value, label }) => ({ value, label }));
  const custom = props.chosen === QualityLevel.Custom;
  return (
    <fieldset className="ag-settings-group">
      <legend>{props.legend}</legend>
      <p className="ag-settings-note">{props.note}</p>
      <OptionSelect
        label={`${props.legend} level`}
        value={props.chosen}
        options={
          custom
            ? [...levels, { value: QualityLevel.Custom, label: QUALITY_LEVEL_NAMES.custom }]
            : levels
        }
        onValueChange={(value) => {
          const option = props.options.find((one) => one.value === value);
          if (option !== undefined && option.value !== props.chosen) props.run(option.command);
        }}
      />
      {QUALITY_SETTING_KEYS.map((key) => (
        <OptionSelect
          key={key}
          label={QUALITY_SETTING_NAMES[key]}
          value={String(props.mode.settings[key])}
          options={Object.entries(SETTING_VALUES[key]).map(([value, label]) => ({
            value,
            label,
          }))}
          onValueChange={(value) => {
            if (value === String(props.mode.settings[key])) return;
            props.run(props.customCommand, { [key]: NUMERIC.has(key) ? Number(value) : value });
          }}
        />
      ))}
    </fieldset>
  );
}
