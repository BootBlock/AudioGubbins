/**
 * The Inspector's take and take stack (`REQ-EDIT-072`, `ADR-0072`): a take's
 * name, note and placement, which are changed here, its state, its recording,
 * its length and how it is placed, and whether it is chosen; a stack's name,
 * which is changed here, what it punches, and its takes. Each change runs the
 * command of the same name, so the Inspector and the Recording panel change the
 * one take, and an undo takes either back.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, IconButton, TextField } from '@audiogubbins/design-system';
import { takeOf, type Project, type Take, type TakeStack } from '@audiogubbins/domain';

import type { TakeSubject } from '../../recording/recording-focus.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { commandPress } from '../command-press.js';
import { typed } from '../settings/recording-input.js';
import { takeFacts } from './take-stacks-section.js';

const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/**
 * A value of a take or a stack typed here, and the button that changes it by
 * `run`, which Enter in the field presses too.
 */
function TypedChange({
  label,
  initial,
  button,
  run,
}: {
  readonly label: string;
  readonly initial: string;
  readonly button: string;
  readonly run: (typed: string) => void;
}): ReactNode {
  const [value, setValue] = useState(initial);
  const apply = (): void => {
    run(value);
  };
  return (
    <div className="ag-recording-field-row">
      <TextField label={label} value={value} onValueChange={setValue} onSubmit={apply} />
      <Button compact onClick={apply}>
        {button}
      </Button>
    </div>
  );
}

/** A take's name, note and placement, each changed here by its command. */
function TakeFields({
  args,
  take,
  commands,
}: {
  readonly args: { readonly stack: string; readonly take: string };
  readonly take: Take;
  readonly commands: PanelCommands;
}): ReactNode {
  return (
    <div className="ag-recording-form">
      <TypedChange
        label="Name"
        initial={take.name}
        button="Rename the take"
        run={(name) => {
          commands.run('take.rename', { ...args, name });
        }}
      />
      <TypedChange
        label="Note"
        initial={take.note}
        button="Keep the note"
        run={(note) => {
          commands.run('take.note', { ...args, note });
        }}
      />
      <TypedChange
        label="Placement, in frames earlier; below zero for later"
        initial={String(take.compensation)}
        button="Place the take"
        run={(placement) => {
          commands.run('take.set-compensation', { ...args, frames: typed(placement) });
        }}
      />
      <p className="ag-recording-caption">
        The placement moves where the take is read from, never its samples.
      </p>
    </div>
  );
}

/** A take's name and note, changed here, and what is known of it. */
function TakeProperties({
  stack,
  take,
  project,
  commands,
}: {
  readonly stack: TakeStack;
  readonly take: Take;
  readonly project: Project;
  readonly commands: PanelCommands;
}): ReactNode {
  const args = { stack: stack.id, take: take.id };
  const asset = project.assets.get(take.asset);
  const { onPress: hear, ...hearReason } = commandPress(commands, 'take.audition', args);
  return (
    <div className="ag-recording-subject">
      <h3 className="ag-recording-subject-title">{`Take in ${stack.name}`}</h3>
      <TakeFields args={args} take={take} commands={commands} />
      <div className="ag-recording-subject-facts">
        <p>{takeFacts(project, take)}</p>
        <p>{stack.chosen === take.id ? 'It is the chosen take.' : 'It is not the chosen take.'}</p>
        {asset !== undefined && <p>{`Its recording is the asset ${asset.displayName}.`}</p>}
      </div>
      <div className="ag-recording-buttons">
        <IconButton
          icon="audition"
          label="Hear"
          hint="Hear"
          compact
          {...hearReason}
          onClick={hear}
        />
        <CommandButton id="take.choose" label="Choose" commands={commands} args={args} compact />
      </div>
    </div>
  );
}

/** A stack's name, changed here, and what it holds. */
function StackProperties({
  stack,
  commands,
}: {
  readonly stack: TakeStack;
  readonly commands: PanelCommands;
}): ReactNode {
  const chosen = stack.chosen === undefined ? undefined : takeOf(stack, stack.chosen);
  return (
    <div className="ag-recording-subject">
      <h3 className="ag-recording-subject-title">Take stack</h3>
      <TypedChange
        label="Name"
        initial={stack.name}
        button="Rename the stack"
        run={(name) => {
          commands.run('take-stack.rename', { stack: stack.id, name });
        }}
      />
      <div className="ag-recording-subject-facts">
        <p>
          {`${String(stack.takes.length)} ${stack.takes.length === 1 ? 'take' : 'takes'}; ${
            chosen === undefined ? 'none is chosen' : `${chosen.name} is chosen`
          }.`}
        </p>
        {stack.punch !== undefined && (
          <p>{`It is a punch's stack: its chosen take replaces ${String(stack.punch.length)} frames, read after a pre-roll of ${String(stack.punch.preRoll)} frames.`}</p>
        )}
      </div>
    </div>
  );
}

/** The take or stack `subject` names, in the Inspector, or why it is gone. */
export function TakeInspector({
  subject,
  projects,
  commands,
}: {
  readonly subject: TakeSubject;
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  const back = (
    <CommandButton
      id="take.inspect"
      label="Show the recording configuration"
      commands={commands}
      compact
    />
  );
  if (open?.kind !== 'open') return <p className="ag-recording-caption">No project is open.</p>;
  const { project } = open.snapshot.model.state;
  const stack = project.takeStacks.get(subject.stack);
  if (stack === undefined) {
    return <p className="ag-recording-caption">That take stack is no longer in the project.</p>;
  }
  const take = subject.take === undefined ? undefined : takeOf(stack, subject.take);
  if (subject.take !== undefined && take === undefined) {
    return <p className="ag-recording-caption">That take is no longer in its stack.</p>;
  }
  return take === undefined ? (
    // Keyed by what the fields show, so an undo shows its name and note.
    <>
      <StackProperties key={`${stack.id}:${stack.name}`} stack={stack} commands={commands} />
      {back}
    </>
  ) : (
    <>
      <TakeProperties
        key={`${take.id}:${take.name}:${take.note}:${String(take.compensation)}`}
        stack={stack}
        take={take}
        project={project}
        commands={commands}
      />
      {back}
    </>
  );
}
