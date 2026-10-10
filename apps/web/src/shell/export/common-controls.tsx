/**
 * The Export dialog's controls of what every format shares (ADR-0092): the
 * rate, the channel conversion, the dither, the range, the metadata and the
 * file name. Each offers every value its type allows, and the rates the
 * codec's own descriptor lists; whether a value can be made is the package's
 * validation to say, beside the controls.
 */

import { useState, type ReactNode } from 'react';

import { Button, TextField } from '@audiogubbins/design-system';
import type { MetadataTextKey } from '@audiogubbins/codecs';
import {
  StandardLayouts,
  channelCount,
  discreteLayout,
  sampleRate,
  type ChannelLayout,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  exportTarget,
  type ChannelConversion,
  type DitherSettings,
  type ExportContext,
  type ExportRange,
  type ExportSettings,
  type MetadataEdit,
  type MetadataPolicy,
  type NoiseShaping,
} from '@audiogubbins/import-export';

import { sampleRateWords } from '../../wording.js';
import {
  LAYOUT_NAMES,
  MATRIX_NAMES,
  METADATA_FIELD_NAMES,
  METADATA_POLICY_WORDS,
  SHAPING_NAMES,
} from './export-words.js';
import { ChoiceField, NumberField, type Choice } from './setting-fields.js';

/** What the controls are given: the settings, what they are planned against, and how to change them. */
export interface CommonControlsProps {
  readonly settings: ExportSettings;
  readonly context: ExportContext;
  readonly onSettings: (settings: ExportSettings) => void;
}

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

/** The standard layouts, with what each is called. */
const LAYOUTS: readonly Choice<ChannelLayout>[] = (
  ['mono', 'stereo', 'lcr', 'quadraphonic', 'surround5_1', 'surround7_1', 'surround7_1_4'] as const
).map((key) => ({ value: StandardLayouts[key], label: LAYOUT_NAMES[key] }));

const CONVERSION_KINDS: readonly Choice<ChannelConversion['kind']>[] = [
  { value: 'keep', label: 'Keep the channels as they are' },
  { value: 'fold', label: 'Fold into another layout' },
  { value: 'matrix', label: 'Mix by a named matrix' },
  { value: 'map', label: 'Take channels by number' },
];

const MATRICES: readonly Choice<keyof typeof MATRIX_NAMES>[] = (
  ['itu-bs775-5.1-to-stereo', 'mid-side-encode', 'mid-side-decode'] as const
).map((value) => ({ value, label: MATRIX_NAMES[value] }));

/** The layouts `count` channels taken by number may become: the standard ones of that count, then discrete. */
function mapLayouts(count: number): readonly Choice<ChannelLayout>[] {
  const discrete = discreteLayout(count);
  return [
    ...LAYOUTS.filter((layout) => channelCount(layout.value) === count),
    ...(discrete.ok
      ? [{ value: discrete.value, label: `${String(count)} discrete channels` }]
      : []),
  ];
}

/** A conversion of the kind chosen, from the source's layout. */
function conversionOf(kind: ChannelConversion['kind'], source: ChannelLayout): ChannelConversion {
  switch (kind) {
    case 'keep':
      return { kind };
    case 'fold':
      return { kind, to: StandardLayouts.stereo };
    case 'matrix':
      return { kind, matrix: 'itu-bs775-5.1-to-stereo' };
    case 'map': {
      const channels = source.roles.map((_, index) => index);
      return { kind, channels, to: mapLayouts(channels.length)[0]?.value ?? source };
    }
  }
}

/** Channel numbers from 1, separated by commas, as a person writes them. */
const CHANNEL_LIST = /^\s*\d+(\s*,\s*\d+)*\s*$/u;

/** The channel indices a list of numbers from 1 names. */
function listOf(text: string): readonly number[] {
  return text.split(',').map((one) => Number(one) - 1);
}

function ChannelControls({ settings, context, onSettings }: CommonControlsProps): ReactNode {
  const { channels } = settings;
  const set = (next: ChannelConversion): void => {
    onSettings({ ...settings, channels: next });
  };
  return (
    <fieldset className="ag-settings-group">
      <legend>Channel layout</legend>
      <ChoiceField
        label="Channels"
        value={channels.kind}
        choices={CONVERSION_KINDS}
        onChoose={(kind) => {
          if (kind !== channels.kind) set(conversionOf(kind, context.source.layout));
        }}
      />
      {channels.kind === 'fold' && (
        <ChoiceField
          label="Fold into"
          value={
            LAYOUTS.find((one) => one.value.roles.join() === channels.to.roles.join())?.value ??
            channels.to
          }
          choices={LAYOUTS}
          onChoose={(to) => {
            set({ kind: 'fold', to });
          }}
        />
      )}
      {channels.kind === 'matrix' && (
        <ChoiceField
          label="Matrix"
          value={channels.matrix}
          choices={MATRICES}
          onChoose={(matrix) => {
            set({ kind: 'matrix', matrix });
          }}
        />
      )}
      {channels.kind === 'map' && <MapControls channels={channels} onConversion={set} />}
    </fieldset>
  );
}

function MapControls({
  channels,
  onConversion,
}: {
  readonly channels: Extract<ChannelConversion, { readonly kind: 'map' }>;
  readonly onConversion: (conversion: ChannelConversion) => void;
}): ReactNode {
  const layouts = mapLayouts(channels.channels.length);
  const written = channels.channels.map((index) => String(index + 1)).join(', ');
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const wrong = typed !== undefined && !CHANNEL_LIST.test(typed);
  // What was typed stays while it is the map, or is not a list yet, so no keystroke is lost.
  const shown =
    typed !== undefined && (wrong || listOf(typed).join() === channels.channels.join())
      ? typed
      : written;
  return (
    <>
      <TextField
        label="Channels taken"
        description={`By number from 1, in the order they are written, separated by commas.${wrong ? ' Write numbers and commas alone.' : ''}`}
        value={shown}
        onValueChange={(text) => {
          setTyped(text);
          if (!CHANNEL_LIST.test(text)) return;
          const taken = listOf(text);
          const to = mapLayouts(taken.length)[0]?.value;
          if (to !== undefined) onConversion({ kind: 'map', channels: taken, to });
        }}
      />
      <ChoiceField
        label="As"
        value={
          layouts.find((one) => one.value.roles.join() === channels.to.roles.join())?.value ??
          channels.to
        }
        choices={layouts}
        onChoose={(to) => {
          onConversion({ ...channels, to });
        }}
      />
    </>
  );
}

const DITHER_KINDS: readonly Choice<DitherSettings['kind']>[] = [
  { value: 'none', label: 'None' },
  { value: 'rectangular', label: 'Rectangular' },
  { value: 'triangular', label: 'Triangular' },
];

const SHAPINGS: readonly Choice<NoiseShaping>[] = (
  ['none', 'first-order', 'lipshitz-e-weighted'] as const
).map((value) => ({ value, label: SHAPING_NAMES[value] }));

function DitherControls({ settings, onSettings }: CommonControlsProps): ReactNode {
  const { dither } = settings;
  const set = (next: DitherSettings): void => {
    onSettings({ ...settings, dither: next });
  };
  return (
    <fieldset className="ag-settings-group">
      <legend>Dither</legend>
      <ChoiceField
        label="Kind of dither"
        value={dither.kind}
        choices={DITHER_KINDS}
        onChoose={(kind) => {
          if (kind === 'none') set({ kind });
          else
            set(
              dither.kind === 'none'
                ? { kind, amplitude: 1, shaping: 'none', seed: 0 }
                : { ...dither, kind },
            );
        }}
      />
      {dither.kind !== 'none' && (
        <>
          <NumberField
            label="Amplitude"
            unit="steps of the depth"
            value={dither.amplitude}
            onNumber={(amplitude) => {
              set({ ...dither, amplitude });
            }}
          />
          <ChoiceField
            label="Noise shaping"
            value={dither.shaping}
            choices={SHAPINGS}
            onChoose={(shaping) => {
              set({ ...dither, shaping });
            }}
          />
          <NumberField
            label="Seed"
            description="The same seed gives the same noise, so the same export gives the same bits."
            value={dither.seed}
            onNumber={(seed) => {
              set({ ...dither, seed });
            }}
          />
        </>
      )}
    </fieldset>
  );
}

/** The ranges offered: the whole asset, each region, every region, and the selection where one is. */
function rangeChoices(
  context: ExportContext,
  selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined,
  current: ExportRange,
): readonly Choice<ExportRange>[] {
  const { regions } = context.source;
  const shown = selection ?? (current.kind === 'selection' ? current : undefined);
  return [
    { value: { kind: 'project' }, label: 'The whole asset' },
    ...regions.map((region) => ({
      value: { kind: 'region', region: region.id } as const,
      label: `The region “${region.name}”`,
    })),
    ...(regions.length === 0
      ? []
      : [{ value: { kind: 'every-region' } as const, label: 'Every region, a file each' }]),
    ...(shown === undefined ? [] : [{ value: shown, label: 'The selection' }]),
  ];
}

/** Whether two ranges are the same. */
function sameRange(left: ExportRange, right: ExportRange): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The range control, which sets the range as the dialog's store does. */
export function RangeControl({
  settings,
  context,
  selection,
  onRange,
}: {
  readonly settings: ExportSettings;
  readonly context: ExportContext;
  readonly selection: Extract<ExportRange, { readonly kind: 'selection' }> | undefined;
  readonly onRange: (range: ExportRange) => void;
}): ReactNode {
  const choices = rangeChoices(context, selection, settings.range);
  const chosen = choices.find((choice) => sameRange(choice.value, settings.range));
  return (
    <ChoiceField
      label="Export"
      value={chosen?.value ?? settings.range}
      choices={choices}
      onChoose={onRange}
    />
  );
}

const POLICIES: readonly Choice<MetadataPolicy>[] = [
  { value: 'full', label: 'Full' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'none', label: 'None' },
];

const FIELDS: readonly Choice<MetadataTextKey>[] = (
  [
    'title',
    'artist',
    'album',
    'albumArtist',
    'trackNumber',
    'trackTotal',
    'discNumber',
    'discTotal',
    'date',
    'genre',
    'comment',
    'copyright',
    'encoder',
    'isrc',
  ] as const
).map((value) => ({ value, label: METADATA_FIELD_NAMES[value] }));

const EDIT_KINDS: readonly Choice<MetadataEdit['kind']>[] = [
  { value: 'set', label: 'Set to' },
  { value: 'remove', label: 'Remove' },
];

/** The first field no edit names yet, to add an edit of. */
function freeField(edits: readonly MetadataEdit[]): MetadataTextKey | undefined {
  return FIELDS.find((field) => !edits.some((edit) => edit.key === field.value))?.value;
}

function MetadataControls({ settings, onSettings }: CommonControlsProps): ReactNode {
  const { metadata } = settings;
  const setEdits = (edits: readonly MetadataEdit[]): void => {
    onSettings({ ...settings, metadata: { ...metadata, edits } });
  };
  const free = freeField(metadata.edits);
  return (
    <fieldset className="ag-settings-group">
      <legend>Metadata</legend>
      <ChoiceField
        label="Carry"
        value={metadata.policy}
        choices={POLICIES}
        onChoose={(policy) => {
          onSettings({ ...settings, metadata: { ...metadata, policy } });
        }}
      />
      <p className="ag-settings-note">{`${METADATA_POLICY_WORDS[metadata.policy]}.`}</p>
      <ul className="ag-export-edits" aria-label="Metadata fields set or removed">
        {metadata.edits.map((edit, index) => (
          <li key={edit.key}>
            <ChoiceField
              label="Field"
              value={edit.key}
              choices={FIELDS}
              onChoose={(key) => {
                setEdits(metadata.edits.with(index, { ...edit, key }));
              }}
            />
            <ChoiceField
              label={`What to do with ${METADATA_FIELD_NAMES[edit.key]}`}
              value={edit.kind}
              choices={EDIT_KINDS}
              onChoose={(kind) => {
                setEdits(
                  metadata.edits.with(
                    index,
                    kind === 'set' ? { kind, key: edit.key, value: '' } : { kind, key: edit.key },
                  ),
                );
              }}
            />
            {edit.kind === 'set' && (
              <TextField
                label={`${METADATA_FIELD_NAMES[edit.key]} text`}
                value={edit.value}
                onValueChange={(value) => {
                  setEdits(metadata.edits.with(index, { ...edit, value }));
                }}
              />
            )}
            <Button
              compact
              onClick={() => {
                setEdits(metadata.edits.filter((_, at) => at !== index));
              }}
            >
              {`Forget the edit of ${METADATA_FIELD_NAMES[edit.key]}`}
            </Button>
          </li>
        ))}
      </ul>
      {free !== undefined && (
        <Button
          compact
          onClick={() => {
            setEdits([...metadata.edits, { kind: 'set', key: free, value: '' }]);
          }}
        >
          Set or remove a field…
        </Button>
      )}
    </fieldset>
  );
}

/** The controls of the settings every format shares but the range, each in its own group. */
export function CommonControls(props: CommonControlsProps): ReactNode {
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
