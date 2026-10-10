/**
 * The Export dialog's controls of what every format shares but the range
 * (ADR-0092): the rate, from the codec's own descriptor, the channel
 * conversion, the dither, the metadata and the file name, each in its own
 * group and module. Whether a value can be made is the package's validation
 * to say, beside the controls.
 */

import type { ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import { sampleRate, type SampleRate } from '@audiogubbins/domain';
import { exportTarget, type ExportContext, type ExportSettings } from '@audiogubbins/import-export';

import { sampleRateWords } from '../../wording.js';
import { ChannelControls } from './channel-controls.js';
import { DitherControls } from './dither-controls.js';
import { MetadataControls } from './metadata-controls.js';
import { ChoiceField, type Choice, type SettingsProps } from './setting-fields.js';

/** The rates offered where a codec writes any rate within its bounds: those audio is commonly made at. */
const COMMON_RATES: readonly number[] = [
  8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 64_000, 88_200, 96_000,
  176_400, 192_000, 352_800, 384_000,
];

/** The rates offered: those the codec's descriptor writes, the source's, and the one set. */
function rateChoices(
  settings: ExportSettings,
  context: ExportContext,
): readonly Choice<SampleRate>[] {
  const support = context.codecs(exportTarget(settings).codec)?.write?.sampleRates;
  const written =
    support === undefined
      ? COMMON_RATES
      : support.kind === 'listed'
        ? support.rates
        : COMMON_RATES.filter((rate) => rate >= support.minimum && rate <= support.maximum);
  const offered = new Set([...written, context.source.sampleRate, settings.sampleRate]);
  return [...offered]
    .toSorted((left, right) => left - right)
    .flatMap((hertz) => {
      const rate = sampleRate(hertz);
      if (!rate.ok) return [];
      const own = hertz === context.source.sampleRate ? ', the asset’s own' : '';
      return [{ value: rate.value, label: `${sampleRateWords(hertz)}${own}` }];
    });
}

/** The controls of the settings every format shares but the range, each in its own group. */
export function CommonControls(props: SettingsProps): ReactNode {
  const { settings, onSettings } = props;
  return (
    <>
      <fieldset className="ag-settings-group">
        <legend>Rate</legend>
        <ChoiceField
          label="Sample rate"
          value={settings.sampleRate}
          choices={rateChoices(settings, props.context)}
          onChoose={(rate) => {
            onSettings({ ...settings, sampleRate: rate });
          }}
        />
      </fieldset>
      <ChannelControls {...props} />
      <DitherControls {...props} />
      <MetadataControls {...props} />
      <fieldset className="ag-settings-group">
        <legend>Naming</legend>
        <TextField
          label="File name"
          description="Without its extension. {project}, {region}, {index}, {date} and {format} are filled in; write {{ or }} for a brace."
          value={settings.fileName}
          onValueChange={(fileName) => {
            onSettings({ ...settings, fileName });
          }}
        />
      </fieldset>
    </>
  );
}
