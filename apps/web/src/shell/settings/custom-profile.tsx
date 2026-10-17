/**
 * The Custom performance profile's settings (REQ-ARCH-083), as a form: they are
 * checked together, so a person sets the fields and applies them, and a
 * refusal names every field that is wrong while keeping what they typed.
 * Nothing here switches a feature on or off; each setting changes how soon
 * audio is heard, how much is buffered, or how work is queued.
 */

import { useState, type ReactNode } from 'react';

import { Button, OptionSelect, TextField } from '@audiogubbins/design-system';
import {
  LATENCY_CATEGORIES,
  type LatencyCategory,
  type PerformanceSettings,
} from '@audiogubbins/audio-engine';

import { SET_CUSTOM_PROFILE } from '../../commands/audio-settings-commands.js';
import type { RunCommand } from './section.js';

/** A latency hint as the form offers it: a category, or a latency the person types. */
type LatencyChoice = LatencyCategory | 'milliseconds';

const LATENCY_NAMES: Readonly<Record<LatencyChoice, string>> = {
  interactive: 'As low as the device allows',
  balanced: 'Balanced',
  playback: 'Smooth playback over low latency',
  milliseconds: 'A latency I set',
};

const LATENCY_CHOICES: readonly LatencyChoice[] = [...LATENCY_CATEGORIES, 'milliseconds'];

/** The form's text, as typed, for each Custom setting. */
interface CustomDraft {
  readonly latency: LatencyChoice;
  readonly latencyMilliseconds: string;
  readonly feedAhead: string;
  readonly background: string;
  readonly chunk: string;
}

function draftOf(custom: PerformanceSettings): CustomDraft {
  const hint = custom.latencyHint;
  return {
    latency: typeof hint === 'number' ? 'milliseconds' : hint,
    latencyMilliseconds: typeof hint === 'number' ? String(hint * 1000) : '',
    feedAhead: String(custom.feedAheadMilliseconds),
    background: String(custom.backgroundConcurrencyWhileInteractive),
    chunk: String(custom.renderChunkMilliseconds),
  };
}

/**
 * A field's text as the command takes it: the number it reads as, or the text
 * itself where it reads as none, so the command says which field is wrong.
 */
function typed(text: string): number | string {
  const trimmed = text.trim();
  const value = Number(trimmed);
  return trimmed !== '' && Number.isFinite(value) ? value : text;
}

function argumentsOf(draft: CustomDraft): Readonly<Record<string, string | number>> {
  const latency = typed(draft.latencyMilliseconds);
  return {
    latencyHint:
      draft.latency !== 'milliseconds'
        ? draft.latency
        : typeof latency === 'number'
          ? latency / 1000
          : latency,
    feedAheadMilliseconds: typed(draft.feedAhead),
    backgroundConcurrencyWhileInteractive: typed(draft.background),
    renderChunkMilliseconds: typed(draft.chunk),
  };
}

/** The number fields of the Custom form, each with what it asks and why it matters. */
const NUMBER_FIELDS: readonly {
  readonly field: 'feedAhead' | 'background' | 'chunk';
  readonly label: string;
  readonly description: string;
}[] = [
  {
    field: 'feedAhead',
    label: 'Audio kept ready ahead of playback, in milliseconds',
    description: 'More survives a busy moment without a drop-out, and a change is heard later.',
  },
  {
    field: 'background',
    label: 'Background jobs at once while playing or editing',
    description: 'A whole number of at least one. Fewer keeps more of the machine for playback.',
  },
  {
    field: 'chunk',
    label: 'Render chunk length, in milliseconds',
    description:
      'Shorter chunks hand the processor back sooner. The rendered audio is identical either way.',
  },
];

/** What each part of the Custom form is given: the draft, how to change it, and how to apply it. */
interface DraftProps {
  readonly draft: CustomDraft;
  readonly change: (changes: Partial<CustomDraft>) => void;
  readonly apply: () => void;
}

/** The output latency: a category, or a number of milliseconds the person types. */
function LatencyFields({ draft, change, apply }: DraftProps): ReactNode {
  return (
    <>
      <OptionSelect
        label="Output latency"
        value={draft.latency}
        options={LATENCY_CHOICES.map((one) => ({ value: one, label: LATENCY_NAMES[one] }))}
        onValueChange={(value) => {
          const latency = LATENCY_CHOICES.find((one) => one === value);
          if (latency !== undefined) change({ latency });
        }}
      />
      {draft.latency === 'milliseconds' && (
        <TextField
          label="Output latency, in milliseconds"
          description="What the browser is asked for; the device may give more."
          value={draft.latencyMilliseconds}
          onValueChange={(latencyMilliseconds) => {
            change({ latencyMilliseconds });
          }}
          onSubmit={apply}
        />
      )}
    </>
  );
}

/** The Custom profile's settings, as a form applied through one command. */
export function CustomProfile({
  custom,
  inForce,
  run,
}: {
  readonly custom: PerformanceSettings;
  readonly inForce: boolean;
  readonly run: RunCommand;
}): ReactNode {
  const [draft, setDraft] = useState(() => draftOf(custom));
  const change = (changes: Partial<CustomDraft>): void => {
    setDraft({ ...draft, ...changes });
  };
  const apply = (): void => {
    run(SET_CUSTOM_PROFILE, argumentsOf(draft));
  };

  return (
    <fieldset className="ag-settings-group">
      <legend>Custom profile</legend>
      <p className="ag-settings-note">
        {inForce
          ? 'These settings are in force. A change closes the audio context and opens another, and playback goes on from where it was.'
          : 'These settings are kept for when you choose the Custom profile.'}
      </p>
      <LatencyFields draft={draft} change={change} apply={apply} />
      {NUMBER_FIELDS.map(({ field, label, description }) => (
        <TextField
          key={field}
          label={label}
          description={description}
          value={draft[field]}
          onValueChange={(value) => {
            change({ [field]: value });
          }}
          onSubmit={apply}
        />
      ))}
      <div className="ag-settings-row">
        <Button onClick={apply}>Apply the Custom settings</Button>
        <Button
          onClick={() => {
            setDraft(draftOf(custom));
          }}
        >
          Discard changes
        </Button>
      </div>
    </fieldset>
  );
}
