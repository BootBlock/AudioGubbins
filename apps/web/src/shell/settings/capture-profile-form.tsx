/**
 * A Custom capture profile, as a form (`REQ-REC-092`): its name, each kind of
 * browser processing the browser lets a page control, set on or off, and
 * whether it is used with headphones. Saved through one command, which keeps
 * what the person typed where it refuses.
 *
 * A control the browser offers no control of is shown, with why, and left as
 * it is: a page cannot ask for it, and the grant says what the browser did.
 */

import { useState, type ReactNode } from 'react';

import { Button, TextField, ToggleSwitch } from '@audiogubbins/design-system';
import type { SupportedCaptureConstraints } from '@audiogubbins/capabilities';
import {
  CaptureProfileKind,
  PROCESSING_CONTROLS,
  processingOf,
  type CaptureProfile,
  type ProcessingChoice,
} from '@audiogubbins/recording';

import {
  REMOVE_CUSTOM_PROFILE,
  SAVE_CUSTOM_PROFILE,
} from '../../commands/recording-settings-commands.js';
import { PROCESSING_NAMES } from '../../recording/recording-words.js';
import type { RunCommand } from './section.js';

/** The form's values, as the person sets them. */
interface Draft {
  readonly name: string;
  readonly processing: ProcessingChoice;
  readonly headphones: boolean;
}

/** The draft a profile starts the form from: a Custom one as it is, another as a copy to name. */
function draftOf(profile: CaptureProfile): Draft {
  return profile.kind === CaptureProfileKind.Custom
    ? { name: profile.name, processing: profile.processing, headphones: profile.headphones }
    : { name: '', processing: processingOf(profile), headphones: profile.headphones };
}

/** The Custom profile form, starting from the profile in use. */
export function CaptureProfileForm({
  chosen,
  supported,
  run,
}: {
  readonly chosen: CaptureProfile;
  readonly supported: SupportedCaptureConstraints | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const [draft, setDraft] = useState(() => draftOf(chosen));
  const save = (): void => {
    run(SAVE_CUSTOM_PROFILE, {
      name: draft.name,
      ...draft.processing,
      headphones: draft.headphones,
    });
  };
  return (
    <details>
      <summary>
        {chosen.kind === CaptureProfileKind.Custom
          ? `Change the ${chosen.name} profile`
          : 'Make a Custom profile'}
      </summary>
      <TextField
        label="Profile name"
        value={draft.name}
        onValueChange={(name) => {
          setDraft({ ...draft, name });
        }}
        onSubmit={save}
      />
      {PROCESSING_CONTROLS.map((control) => {
        const controllable = supported?.[control] === true;
        return (
          <ToggleSwitch
            key={control}
            label={PROCESSING_NAMES[control]}
            checked={draft.processing[control]}
            disabled={!controllable}
            {...(controllable
              ? {}
              : {
                  description:
                    'This browser offers no control of it, so it is not asked for; the grant says whether it is applied.',
                })}
            onCheckedChange={(on) => {
              setDraft({ ...draft, processing: { ...draft.processing, [control]: on } });
            }}
          />
        );
      })}
      <ToggleSwitch
        label="Used with headphones"
        description="Only a profile used with headphones may start monitoring by itself. No browser can tell headphones from speakers."
        checked={draft.headphones}
        onCheckedChange={(headphones) => {
          setDraft({ ...draft, headphones });
        }}
      />
      <div className="ag-settings-row">
        <Button onClick={save}>Save the Custom profile</Button>
        {chosen.kind === CaptureProfileKind.Custom && (
          <Button
            onClick={() => {
              run(REMOVE_CUSTOM_PROFILE, { profile: chosen.name });
            }}
          >
            {`Remove ${chosen.name}`}
          </Button>
        )}
      </div>
    </details>
  );
}
