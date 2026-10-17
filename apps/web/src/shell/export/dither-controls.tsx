/**
 * The Export dialog's dither (ADR-0092): none, or rectangular or triangular
 * noise of an amplitude, shaped or not, drawn from a seed. Whether a dither
 * suits the depth and the rate is the package's to say.
 */

import type { ReactNode } from 'react';

import type { DitherSettings, NoiseShaping } from '@audiogubbins/import-export';

import { SHAPING_NAMES } from './export-words.js';
import {
  ChoiceField,
  SettingGroup,
  NumberField,
  type Choice,
  type SettingsProps,
} from './setting-fields.js';

const DITHER_KINDS: readonly Choice<DitherSettings['kind']>[] = [
  { value: 'none', label: 'None' },
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'triangular', label: 'Triangular' },
];

const SHAPINGS: readonly Choice<NoiseShaping>[] = (
  ['none', 'first-order', 'lipshitz-e-weighted'] as const
).map((value) => ({ value, label: SHAPING_NAMES[value] }));

/** The dither a choice of `kind` gives, keeping the noise's values where there was noise. */
function ditherOf(kind: DitherSettings['kind'], held: DitherSettings): DitherSettings {
  if (kind === 'none') return { kind };
  return held.kind === 'none'
    ? { kind, amplitude: 1, shaping: 'none', seed: 0 }
    : { ...held, kind };
}

/** The values of a dither of noise. */
function NoiseControls({
  dither,
  onDither,
}: {
  readonly dither: Exclude<DitherSettings, { readonly kind: 'none' }>;
  readonly onDither: (dither: DitherSettings) => void;
}): ReactNode {
  return (
    <>
      <NumberField
        label="Amplitude"
        unit="steps of the depth"
        value={dither.amplitude}
        onNumber={(amplitude) => {
          onDither({ ...dither, amplitude });
        }}
      />
      <ChoiceField
        label="Noise shaping"
        value={dither.shaping}
        choices={SHAPINGS}
        onChoose={(shaping) => {
          onDither({ ...dither, shaping });
        }}
      />
      <NumberField
        label="Seed"
        description="The same seed gives the same noise, so the same export gives the same bits."
        value={dither.seed}
        onNumber={(seed) => {
          onDither({ ...dither, seed });
        }}
      />
    </>
  );
}

/** The dither's controls. */
export function DitherControls({ settings, onSettings }: SettingsProps): ReactNode {
  const { dither } = settings;
  const set = (next: DitherSettings): void => {
    onSettings({ ...settings, dither: next });
  };
  return (
    <SettingGroup title="Dither">
      <ChoiceField
        label="Kind of dither"
        value={dither.kind}
        choices={DITHER_KINDS}
        onChoose={(kind) => {
          set(ditherOf(kind, dither));
        }}
      />
      {dither.kind !== 'none' && <NoiseControls dither={dither} onDither={set} />}
    </SettingGroup>
  );
}
