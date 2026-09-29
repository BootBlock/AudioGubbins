/**
 * Making a project: its name, and the sample rate and channels it is made at
 * (REQ-STOR-026).
 *
 * A dialogue section rather than a command's prompt, because a command cannot
 * open a dialogue and wait for a name. What is typed is the section's own until
 * the command runs, and stays in the field where the command refuses it, so the
 * person can correct it rather than type it again.
 */

import { useState, type ReactNode } from 'react';

import { ButtonTone, OptionSelect, TextField } from '@audiogubbins/design-system';
import { LONGEST_NAME } from '@audiogubbins/project-format';

import { ReasonedButton } from '../settings/reasoned-button.js';
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

/** The New project section. */
export function NewProject({
  run,
  unavailable,
}: {
  readonly run: RunCommand;

  /** Why no project can be made now, or `undefined` where one can. */
  readonly unavailable: string | undefined;
}): ReactNode {
  const [name, setName] = useState('');
  const [rate, setRate] = useState<string>(SAMPLE_RATES[0].value);
  const [channels, setChannels] = useState<string>(CHANNELS[0].value);
  const chosen = name.trim();

  const make = (): void => {
    run('file.create-project', { name: chosen, sampleRate: Number(rate), channels });
  };

  return (
    <div className="ag-settings-section">
      <p className="ag-settings-note">
        A project keeps its audio, its edits and every state it has been in, saved as you work.
      </p>
      <TextField
        label="Name"
        value={name}
        onValueChange={setName}
        onSubmit={make}
        maxLength={LONGEST_NAME}
      />
      <div className="ag-settings-row">
        <OptionSelect
          label="Sample rate"
          value={rate}
          options={SAMPLE_RATES}
          onValueChange={setRate}
        />
        <OptionSelect
          label="Channels"
          value={channels}
          options={CHANNELS}
          onValueChange={setChannels}
        />
      </div>
      <ReasonedButton
        tone={ButtonTone.Primary}
        reason={unavailable ?? (chosen === '' ? 'Type a name for the new project.' : undefined)}
        onPress={make}
      >
        Make the project
      </ReasonedButton>
    </div>
  );
}
