/**
 * The Export dialog's channel conversion (ADR-0092): the channels kept, folded
 * into a standard layout, mixed by a matrix the engine names, or taken by
 * number. Whether the conversion suits the audio is the package's to say.
 */

import { useState, type ReactNode } from 'react';

import { TextField } from '@audiogubbins/design-system';
import {
  StandardLayouts,
  channelCount,
  discreteLayout,
  type ChannelLayout,
} from '@audiogubbins/domain';
import type { ChannelConversion } from '@audiogubbins/import-export';

import { LAYOUT_NAMES, MATRIX_NAMES } from './export-words.js';
import { ChoiceField, SettingGroup, type Choice, type SettingsProps } from './setting-fields.js';

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

/** The channel conversion's controls. */
export function ChannelControls({ settings, context, onSettings }: SettingsProps): ReactNode {
  const { channels } = settings;
  const set = (next: ChannelConversion): void => {
    onSettings({ ...settings, channels: next });
  };
  return (
    <SettingGroup title="Channel layout">
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
    </SettingGroup>
  );
}

/** The channels taken by number, and the layout they become. */
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
        description="By number from 1, in the order they are written, separated by commas."
        {...(wrong ? { error: 'Write numbers and commas alone.' } : {})}
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
