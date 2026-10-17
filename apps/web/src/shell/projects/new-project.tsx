/**
 * Making a project: its name, and the sample rate and channels it is made at
 * (REQ-STOR-026).
 *
 * A dialogue section rather than a command's prompt, because a command cannot
 * open a dialogue and wait for a name. What is typed is the section's own until
 * the command runs, and stays in the field where the command refuses it, so the
 * person can correct it rather than type it again.
 *
 * The section's fields are in the dialogue's body and its button in the
 * dialogue's footer, with the reason it waits beside it, as every dialogue's
 * main action is (design language, section 11). Both read one draft, which the
 * dialogue holds while the section shows and lets go as another section opens,
 * as the section's own state went when its tab was left.
 */

import { useState, type ReactNode } from 'react';

import { Button, ButtonTone, Icon, SegmentedControl, TextField } from '@audiogubbins/design-system';
import { LONGEST_NAME, givenName } from '@audiogubbins/project-format';

import type { RunCommand } from '../settings/section.js';

/** The sample rates offered, the one most projects are made at first. */
const SAMPLE_RATES = [
  { value: '48000', label: '48 kHz' },
  { value: '44100', label: '44.1 kHz' },
  { value: '96000', label: '96 kHz' },
] as const;

const CHANNELS = [
  { value: 'stereo', label: 'Stereo' },
  { value: 'mono', label: 'Mono' },
] as const;

/** What the person has set for the project to be made, and what makes it. */
export interface NewProjectDraft {
  readonly name: string;
  readonly rate: string;
  readonly channels: string;
  readonly setName: (name: string) => void;
  readonly setRate: (rate: string) => void;
  readonly setChannels: (channels: string) => void;

  /** Runs the command that makes the project from the draft. */
  readonly make: () => void;

  /** Why no project can be made from the draft now, or `undefined` where one can. */
  readonly reason: string | undefined;
}

/**
 * The draft of the project to be made, started afresh each time the section
 * shows.
 *
 * `unavailable` is the command's own reason, which comes before the name's: a
 * name typed cannot make a project the command refuses.
 */
export function useNewProjectDraft(
  showing: boolean,
  run: RunCommand,
  unavailable: string | undefined,
): NewProjectDraft {
  const [name, setName] = useState('');
  const [rate, setRate] = useState<string>(SAMPLE_RATES[0].value);
  const [channels, setChannels] = useState<string>(CHANNELS[0].value);
  // Let go as the section is left, while the dialogue draws, so the section
  // never shows the last draft for a frame when it is next opened.
  const [wasShowing, setWasShowing] = useState(showing);
  if (wasShowing !== showing) {
    setWasShowing(showing);
    if (!showing) {
      setName('');
      setRate(SAMPLE_RATES[0].value);
      setChannels(CHANNELS[0].value);
    }
  }
  const named = givenName('project', name);
  return {
    name,
    rate,
    channels,
    setName,
    setRate,
    setChannels,
    make: () => {
      run('file.create-project', { name, sampleRate: Number(rate), channels });
    },
    reason: unavailable ?? (named.ok ? undefined : named.failures[0].summary),
  };
}

/** The New project section's fields. */
export function NewProject({ draft }: { readonly draft: NewProjectDraft }): ReactNode {
  return (
    <div className="ag-dialogue-stack ag-projects-section">
      <p className="ag-dialogue-note">
        A project keeps its audio, its edits and every state it has been in, saved as you work.
      </p>
      <div className="ag-dialogue-form">
        <TextField
          label="Name"
          value={draft.name}
          onValueChange={draft.setName}
          onSubmit={draft.make}
          maxLength={LONGEST_NAME}
        />
        <div className="ag-dialogue-field">
          <span aria-hidden="true">Sample rate</span>
          <SegmentedControl
            label="Sample rate"
            value={draft.rate}
            options={SAMPLE_RATES}
            onValueChange={draft.setRate}
            small
          />
        </div>
        <div className="ag-dialogue-field">
          <span aria-hidden="true">Channels</span>
          <SegmentedControl
            label="Channels"
            value={draft.channels}
            options={CHANNELS}
            onValueChange={draft.setChannels}
            small
          />
        </div>
      </div>
    </div>
  );
}

/** The section's button, for the dialogue's footer, waiting with its reason where it must. */
export function MakeProjectButton({ draft }: { readonly draft: NewProjectDraft }): ReactNode {
  return (
    <Button
      tone={ButtonTone.Primary}
      {...(draft.reason === undefined ? {} : { unavailableReason: draft.reason })}
      onClick={draft.make}
    >
      <Icon name="add" />
      Make the project
    </Button>
  );
}
