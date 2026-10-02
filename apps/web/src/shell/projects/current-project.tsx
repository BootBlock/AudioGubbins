/**
 * What can be done with the open project as a whole: renaming it, forking it
 * from where it is, taking it out as a bundle or a folder, copying the files it
 * links to into it, backing it up and deleting it (REQ-STOR-026, REQ-STOR-099,
 * REQ-STOR-103, REQ-STOR-105, REQ-STOR-199).
 *
 * Every control runs a command, and each command's own reason for not running
 * is shown beside its button, as the menus show it.
 */

import { useState, type ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  OptionSelect,
  TextField,
  ToggleSwitch,
} from '@audiogubbins/design-system';
import { LONGEST_NAME } from '@audiogubbins/project-format';
import type { AnotherProject } from '@audiogubbins/storage';

import { quoted } from '../../wording.js';
import { ReasonedButton } from '../settings/reasoned-button.js';
import type { RunCommand } from '../settings/section.js';

/** What the section needs. */
export interface CurrentProjectProps {
  /** The open project's name, where one is open. */
  readonly name: string | undefined;

  /** The project a folder chosen to export into holds, while the person decides. */
  readonly replacing: AnotherProject | undefined;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}

/** A name typed and the command it is given to, emptied once the command runs. */
function NamedAction({
  label,
  action,
  command,
  initial,
  run,
  unavailable,
}: {
  readonly label: string;
  readonly action: string;
  readonly command: string;
  readonly initial: string;
  readonly run: RunCommand;
  readonly unavailable: string | undefined;
}): ReactNode {
  const [name, setName] = useState(initial);
  const chosen = name.trim();
  const go = (): void => {
    run(command, { name: chosen });
  };
  return (
    <div className="ag-settings-row">
      <TextField
        label={label}
        value={name}
        onValueChange={setName}
        onSubmit={go}
        maxLength={LONGEST_NAME}
      />
      <ReasonedButton
        reason={unavailable ?? (chosen === '' ? 'Type a name first.' : undefined)}
        onPress={go}
      >
        {action}
      </ReasonedButton>
    </div>
  );
}

/** How much of the history an export holds. */
const SCOPES = [
  { value: 'whole-history', label: 'The whole history' },
  { value: 'current-state', label: 'The current state alone' },
] as const;

/**
 * How much of where the audio came from an export keeps, each level named by
 * what it leaves out (`provenance-stripping.ts` says what each one does).
 */
const PROVENANCE = [
  { value: 'full', label: 'Keep all of it' },
  { value: 'minimal', label: 'Leave out names and places' },
  { value: 'none', label: 'Leave it all out' },
] as const;

/** Exactly what each level keeps and leaves out, shown beside the choice. */
const PROVENANCE_KEPT: ReadonlyMap<string, string> = new Map([
  ['full', 'Keeps every file’s name and folder, when it came in, and where each export went.'],
  [
    'minimal',
    'Keeps when each file came in, what it was and the project it first came into. Leaves out the names and folders of files, and where each export went, with its Godot links and messages.',
  ],
  [
    'none',
    'Leaves out how each file came in and every export. A linked file keeps only its length, type, time and fingerprints, which tell it again.',
  ],
]);

/** Why a whole history keeps all of where its audio came from. */
const WHOLE_HISTORY_KEEPS =
  'A whole history keeps all of it, since its changes record where the audio came from. Export the current state alone to leave any of it out.';

/** The two ways out, each a command and its button's words. */
const EXPORTS = [
  ['file.export-bundle', 'Export as a bundle…'],
  ['file.export-folder', 'Export to a folder…'],
] as const;

/** How much of the project a bundle or folder holds. */
function ExportChoices({
  run,
  unavailableReason,
}: Pick<CurrentProjectProps, 'run' | 'unavailableReason'>): ReactNode {
  const [scope, setScope] = useState('whole-history');
  const [provenance, setProvenance] = useState('full');
  const [caches, setCaches] = useState(false);
  const wholeHistory = scope === 'whole-history';
  const kept = wholeHistory ? 'full' : provenance;
  const args = { scope, provenance: kept, caches };
  return (
    <div role="group" aria-label="Export">
      <h3 className="ag-section-heading">Export</h3>
      <div className="ag-settings-row">
        <OptionSelect
          label="What to include"
          value={scope}
          onValueChange={setScope}
          options={SCOPES}
        />
        <OptionSelect
          label="Where the audio came from"
          value={kept}
          onValueChange={setProvenance}
          options={PROVENANCE}
          disabled={wholeHistory}
        />
      </div>
      <p className="ag-settings-note">
        {wholeHistory ? WHOLE_HISTORY_KEEPS : PROVENANCE_KEPT.get(kept)}
      </p>
      <ToggleSwitch
        label="Include caches"
        description="Waveforms and analysis are made again when needed, so they only make the export larger."
        checked={caches}
        onCheckedChange={setCaches}
      />
      <div className="ag-settings-row">
        {EXPORTS.map(([id, label]) => (
          <ReasonedButton key={id} reason={unavailableReason(id)} onPress={() => run(id, args)}>
            {label}
          </ReasonedButton>
        ))}
      </div>
    </div>
  );
}

/** The question put when the folder chosen to export into holds another project. */
function FolderReplacement({
  replacing,
  run,
}: {
  readonly replacing: AnotherProject;
  readonly run: RunCommand;
}): ReactNode {
  return (
    <div role="group" aria-label="The folder holds another project">
      <p data-ag-status="reduced">
        {replacing.name === undefined
          ? 'The folder holds files of a project whose header cannot be read. Replacing them deletes them.'
          : `The folder holds another project, ${quoted(replacing.name)}. Replacing it deletes its files from the folder.`}
      </p>
      <div className="ag-settings-row">
        <Button tone={ButtonTone.Destructive} onClick={() => run('file.export-folder-replace')}>
          Replace its files
        </Button>
        <Button onClick={() => run('file.export-folder-keep')}>Keep the folder as it is</Button>
      </div>
    </div>
  );
}

/** The This project section. */
export function CurrentProject({
  name,
  replacing,
  run,
  unavailableReason,
}: CurrentProjectProps): ReactNode {
  if (name === undefined) return <p className="ag-settings-note">No project is open.</p>;
  return (
    <div className="ag-settings-section">
      <NamedAction
        label="Project name"
        action="Rename"
        command="file.rename-project"
        initial={name}
        run={run}
        unavailable={unavailableReason('file.rename-project')}
      />
      <NamedAction
        label="Name of the fork"
        action="Fork from here"
        command="file.fork-project"
        initial={`${name} (fork)`}
        run={run}
        unavailable={unavailableReason('file.fork-project')}
      />
      <ExportChoices run={run} unavailableReason={unavailableReason} />
      {replacing === undefined ? undefined : <FolderReplacement replacing={replacing} run={run} />}
      <div className="ag-settings-row">
        <ReasonedButton
          reason={unavailableReason('file.consolidate')}
          onPress={() => run('file.consolidate')}
        >
          Copy linked files into the project
        </ReasonedButton>
        <ReasonedButton
          reason={unavailableReason('file.back-up-now')}
          onPress={() => run('file.back-up-now')}
        >
          Back up now
        </ReasonedButton>
        <ReasonedButton
          tone={ButtonTone.Destructive}
          reason={unavailableReason('file.delete-project')}
          onPress={() => run('file.delete-project')}
        >
          Delete this project
        </ReasonedButton>
      </div>
    </div>
  );
}
