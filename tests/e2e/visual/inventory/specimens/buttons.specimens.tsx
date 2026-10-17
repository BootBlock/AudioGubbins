/**
 * The specimens of the controls a user presses or turns over: every button
 * tone, the icon button and a panel header's actions, the toolbar, the
 * segmented control in each variant, the switch, the check, the radio's panel
 * lamp, the power switch and the record lamp, each in every state it has.
 *
 * Hover, focus-visible and active are forced by the harness on the specimen's
 * wrapper; pressed (a mode that is on), on and off, unavailable and disabled
 * are drawn by the controls' own props. A control's change handler does
 * nothing here: the inventory shows each state, it does not change one.
 */

import {
  Button,
  ButtonTone,
  Check,
  ControlBar,
  ControlBarButton,
  ControlBarSeparator,
  IconButton,
  PowerSwitch,
  RadioGroup,
  RecordButton,
  SegmentedControl,
  SegmentedVariant,
  ToggleSwitch,
  type SegmentedOption,
} from '@audiogubbins/design-system';
import type { ReactNode } from 'react';

import type { Specimen } from '../specimen.js';

/** A change handler for a specimen, whose state is fixed by its props. */
function ignore(): void {
  // The inventory draws a state; it never changes one.
}

/** The states the harness forces on any control a pointer or the keyboard reaches. */
const INTERACTIVE = ['default', 'hover', 'focus-visible', 'active'] as const;

/** One specimen per interactive state, each drawn the same way. */
function interactive(component: string, render: () => ReactNode): Specimen[] {
  return INTERACTIVE.map((state) => ({ component, state, render }));
}

/** The tones of the button, each with its words. */
const TONES: readonly {
  readonly tone: ButtonTone;
  readonly name: string;
  readonly words: string;
}[] = [
  { tone: ButtonTone.Primary, name: 'primary', words: 'Export' },
  { tone: ButtonTone.Neutral, name: 'secondary', words: 'Cancel' },
  { tone: ButtonTone.Quiet, name: 'quiet', words: 'Reset layout' },
  { tone: ButtonTone.Destructive, name: 'destructive', words: 'Delete' },
  { tone: ButtonTone.QuietDestructive, name: 'quiet destructive', words: 'Remove' },
];

const UNDO_REASON = 'There is nothing to undo yet.';

const buttonSpecimens: readonly Specimen[] = TONES.flatMap(({ tone, name, words }) => [
  // Forced states are named by the state alone, so the harness forces them;
  // the tone is the component's variant, written after the name.
  ...INTERACTIVE.map((state) => ({
    component: `Button (${name})`,
    state,
    render: () => <Button tone={tone}>{words}</Button>,
  })),
  {
    component: `Button (${name})`,
    state: 'small',
    render: () => (
      <Button tone={tone} compact>
        {words}
      </Button>
    ),
  },
  {
    component: `Button (${name})`,
    state: 'disabled',
    render: () => (
      <Button tone={tone} disabled>
        {words}
      </Button>
    ),
  },
  {
    component: `Button (${name})`,
    state: 'unavailable',
    render: () => (
      <Button tone={tone} unavailableReason={UNDO_REASON}>
        {words}
      </Button>
    ),
  },
]);

const toggledButtonSpecimens: readonly Specimen[] = [
  {
    component: 'Button (secondary)',
    state: 'pressed',
    render: () => <Button aria-pressed>Snap</Button>,
  },
  {
    component: 'Button (quiet)',
    state: 'pressed',
    render: () => (
      <Button tone={ButtonTone.Quiet} aria-pressed>
        Left
      </Button>
    ),
  },
];

const iconButtonSpecimens: readonly Specimen[] = [
  ...INTERACTIVE.map((state) => ({
    component: 'IconButton',
    state,
    render: () => <IconButton icon="settings" label="Settings" />,
  })),
  {
    component: 'IconButton',
    state: 'pressed',
    render: () => <IconButton icon="snap" label="Snap" pressed />,
  },
  {
    component: 'IconButton',
    state: 'small',
    render: () => <IconButton icon="close" label="Close" compact />,
  },
  {
    component: 'IconButton',
    state: 'disabled',
    render: () => <IconButton icon="delete" label="Delete" disabled />,
  },
  {
    component: 'IconButton',
    state: 'unavailable',
    render: () => <IconButton icon="undo" label="Undo" unavailableReason={UNDO_REASON} />,
  },
  {
    // A panel header's actions: full-size targets, so their ink sits as far
    // from the panel's side as from its top.
    component: 'IconButton',
    state: 'header actions',
    render: () => (
      <div style={{ display: 'flex' }}>
        <IconButton icon="more" label="More" />
        <IconButton icon="dock" label="Dock" />
        <IconButton icon="close" label="Close" />
      </div>
    ),
  },
];

/** A toolbar of two groups, the second's mode on. */
function editingBar(): ReactNode {
  return (
    <ControlBar label="Editing">
      <ControlBarButton label="Cut" icon="cut" hint="Cut" onPress={ignore} />
      <ControlBarButton label="Copy" icon="copy" hint="Copy" onPress={ignore} />
      <ControlBarButton label="Paste" icon="paste" hint="Paste" onPress={ignore} />
      <ControlBarSeparator />
      <ControlBarButton label="Snap" icon="snap" pressed onPress={ignore} />
      <ControlBarButton label="Zoom in" onPress={ignore} />
      <ControlBarButton label="Undo" unavailableReason={UNDO_REASON} onPress={ignore} />
    </ControlBar>
  );
}

const controlBarSpecimens: readonly Specimen[] = interactive('ControlBar', editingBar);

const DISPLAY: readonly SegmentedOption[] = [
  { value: 'waveform', label: 'Waveform', icon: 'waveform', caption: 'Level over time' },
  { value: 'spectrogram', label: 'Spectrogram', icon: 'spectrogram', caption: 'Frequency' },
  { value: 'both', label: 'Both', icon: 'spectral', caption: 'One over the other' },
];

const TOOLS: readonly SegmentedOption[] = [
  { value: 'select', label: 'Select', icon: 'locate' },
  { value: 'razor', label: 'Razor', icon: 'razor' },
  { value: 'brush', label: 'Brush', icon: 'spectral-brush' },
];

/** A segmented control in one variant, the first choice chosen. */
function segmented(
  variant: SegmentedVariant,
  extra: {
    readonly small?: boolean;
    readonly unavailableReason?: string;
    readonly disabled?: boolean;
  } = {},
): ReactNode {
  const options = variant === SegmentedVariant.Tools ? TOOLS : DISPLAY;
  const first = options[0]?.value ?? '';
  return (
    <SegmentedControl
      label={variant === SegmentedVariant.Tools ? 'Tools' : 'Display'}
      value={first}
      options={options}
      variant={variant}
      onValueChange={ignore}
      {...extra}
    />
  );
}

const segmentedSpecimens: readonly Specimen[] = [
  ...Object.values(SegmentedVariant).flatMap((variant) =>
    INTERACTIVE.map((state) => ({
      component: `SegmentedControl (${variant})`,
      state,
      render: () => segmented(variant),
    })),
  ),
  {
    component: 'SegmentedControl (text)',
    state: 'small',
    render: () => segmented(SegmentedVariant.Text, { small: true }),
  },
  {
    component: 'SegmentedControl (icons)',
    state: 'small',
    render: () => segmented(SegmentedVariant.Icons, { small: true }),
  },
  {
    component: 'SegmentedControl (text)',
    state: 'disabled',
    render: () => segmented(SegmentedVariant.Text, { disabled: true }),
  },
  {
    component: 'SegmentedControl (text)',
    state: 'unavailable',
    render: () =>
      segmented(SegmentedVariant.Text, {
        unavailableReason: 'Open a sound to choose its display.',
      }),
  },
];

/** A switch, on or off, in any other state its props give. */
function toggle(
  checked: boolean,
  extra: {
    readonly small?: boolean;
    readonly disabled?: boolean;
    readonly unavailableReason?: string;
  } = {},
): ReactNode {
  return (
    <ToggleSwitch
      label="Diagnostic mode"
      description="Collects more detail for a limited time."
      checked={checked}
      onCheckedChange={ignore}
      {...extra}
    />
  );
}

const switchSpecimens: readonly Specimen[] = [
  ...INTERACTIVE.map((state) => ({
    component: 'ToggleSwitch',
    state,
    render: () => toggle(false),
  })),
  { component: 'ToggleSwitch', state: 'on', render: () => toggle(true) },
  {
    component: 'ToggleSwitch',
    state: 'description behind a hint',
    render: () => (
      <ToggleSwitch
        label="Diagnostic mode"
        description={{
          hintLabel: 'About diagnostic mode',
          text: 'Collects more detail for a limited time.',
        }}
        checked
        onCheckedChange={ignore}
      />
    ),
  },
  {
    component: 'ToggleSwitch',
    state: 'long label',
    // The label wraps its words beside the switch, in a column as narrow as a
    // settings page's on a phone.
    render: () => (
      <div style={{ inlineSize: 'calc(110 * var(--ag-grid-unit))' }}>
        <ToggleSwitch
          label="Keep the waveform and analysis caches with the project when it is exported"
          checked={false}
          onCheckedChange={ignore}
        />
      </div>
    ),
  },
  ...[false, true].flatMap((checked) => {
    const word = checked ? 'on' : 'off';
    return [
      {
        component: 'ToggleSwitch',
        state: `${word} small`,
        render: () => toggle(checked, { small: true }),
      },
      {
        component: 'ToggleSwitch',
        state: `${word} disabled`,
        render: () => toggle(checked, { disabled: true }),
      },
      {
        component: 'ToggleSwitch',
        state: `${word} unavailable`,
        render: () =>
          toggle(checked, { unavailableReason: 'Diagnostics are turned off on this device.' }),
      },
    ];
  }),
];

/** A check, made or not, in any other state its props give. */
function check(
  checked: boolean,
  extra: { readonly disabled?: boolean; readonly unavailableReason?: string } = {},
): ReactNode {
  return (
    <Check
      label="Include markers"
      description="Written into the file as cue points."
      checked={checked}
      onCheckedChange={ignore}
      {...extra}
    />
  );
}

const checkSpecimens: readonly Specimen[] = [
  ...INTERACTIVE.map((state) => ({ component: 'Check', state, render: () => check(true) })),
  { component: 'Check', state: 'off', render: () => check(false) },
  { component: 'Check', state: 'on', render: () => check(true) },
  { component: 'Check', state: 'off disabled', render: () => check(false, { disabled: true }) },
  { component: 'Check', state: 'on disabled', render: () => check(true, { disabled: true }) },
  {
    component: 'Check',
    state: 'unavailable',
    render: () => check(false, { unavailableReason: 'This format has no markers.' }),
  },
  {
    component: 'Check',
    state: 'description behind a hint',
    render: () => (
      <Check
        label="Include markers"
        description={{ hintLabel: 'About markers', text: 'Written into the file as cue points.' }}
        checked
        onCheckedChange={ignore}
      />
    ),
  },
];

/** A radio group of takes, the first chosen. */
function takes(
  extra: {
    readonly horizontal?: boolean;
    readonly disabled?: boolean;
    readonly unavailableReason?: string;
  } = {},
): ReactNode {
  return (
    <RadioGroup
      label="Take heard"
      value="one"
      options={[
        { value: 'one', label: 'Take 1', description: 'Recorded at 14:02' },
        { value: 'two', label: 'Take 2', description: 'Recorded at 14:05' },
        { value: 'three', label: 'Take 3' },
      ]}
      onValueChange={ignore}
      {...extra}
    />
  );
}

const radioSpecimens: readonly Specimen[] = [
  ...INTERACTIVE.map((state) => ({ component: 'RadioGroup', state, render: () => takes() })),
  { component: 'RadioGroup', state: 'horizontal', render: () => takes({ horizontal: true }) },
  { component: 'RadioGroup', state: 'disabled', render: () => takes({ disabled: true }) },
  {
    component: 'RadioGroup',
    state: 'unavailable',
    render: () => takes({ unavailableReason: 'Stop recording to choose a take.' }),
  },
  {
    component: 'RadioGroup',
    state: 'descriptions behind hints',
    render: () => (
      <RadioGroup
        label="Format"
        value="wav"
        options={[
          {
            value: 'wav',
            label: 'WAV',
            description: { hintLabel: 'About WAV', text: 'Every sample as it is, uncompressed.' },
          },
          {
            value: 'ogg',
            label: 'Ogg Vorbis',
            description: {
              hintLabel: 'About Ogg Vorbis',
              text: 'Smaller, losing detail the ear is least likely to miss.',
            },
          },
        ]}
        onValueChange={ignore}
      />
    ),
  },
];

/** A power switch, on or off. */
function power(
  checked: boolean,
  extra: { readonly disabled?: boolean; readonly unavailableReason?: string } = {},
): ReactNode {
  return <PowerSwitch label="Equaliser" checked={checked} onCheckedChange={ignore} {...extra} />;
}

const powerSpecimens: readonly Specimen[] = [
  ...INTERACTIVE.map((state) => ({ component: 'PowerSwitch', state, render: () => power(true) })),
  { component: 'PowerSwitch', state: 'on', render: () => power(true) },
  { component: 'PowerSwitch', state: 'off', render: () => power(false) },
  { component: 'PowerSwitch', state: 'on disabled', render: () => power(true, { disabled: true }) },
  {
    component: 'PowerSwitch',
    state: 'unavailable',
    render: () => power(false, { unavailableReason: 'The chain is being rendered.' }),
  },
];

/** A record button, recording or not. */
function record(recording: boolean, unavailableReason?: string): ReactNode {
  return (
    <RecordButton
      label="Record"
      recording={recording}
      onPress={ignore}
      {...(unavailableReason === undefined ? {} : { unavailableReason })}
    />
  );
}

const recordSpecimens: readonly Specimen[] = [
  ...INTERACTIVE.map((state) => ({
    component: 'RecordButton',
    state,
    render: () => record(false),
  })),
  { component: 'RecordButton', state: 'recording', render: () => record(true) },
  { component: 'RecordButton', state: 'idle', render: () => record(false) },
  {
    component: 'RecordButton',
    state: 'unavailable',
    render: () => record(false, 'Choose an input to record from.'),
  },
];

const specimens: readonly Specimen[] = [
  ...buttonSpecimens,
  ...toggledButtonSpecimens,
  ...iconButtonSpecimens,
  ...controlBarSpecimens,
  ...segmentedSpecimens,
  ...switchSpecimens,
  ...checkSpecimens,
  ...radioSpecimens,
  ...powerSpecimens,
  ...recordSpecimens,
];

export default specimens;
