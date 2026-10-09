/**
 * The Inspector's take and take stack (`REQ-EDIT-072`, `ADR-0072`): a take's
 * name, note and placement, which are changed here, its state, its recording,
 * its length and how it is placed, and whether it is chosen; a stack's name,
 * which is changed here, what it punches, and its takes. Each change runs the
 * command of the same name, so the Inspector and the Recording panel change the
 * one take, and an undo takes either back.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { Button, TextField } from '@audiogubbins/design-system';
import { takeOf, type Project, type Take, type TakeStack } from '@audiogubbins/domain';

import type { TakeSubject } from '../../recording/recording-focus.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { typed } from '../settings/recording-input.js';
import { takeFacts } from './take-stacks-section.js';

const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

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
  const [name, setName] = useState(take.name);
  const [note, setNote] = useState(take.note);
  const [placement, setPlacement] = useState(String(take.compensation));
  const args = { stack: stack.id, take: take.id };
  const rename = (): void => {
    commands.run('take.rename', { ...args, name });
  };
  const annotate = (): void => {
    commands.run('take.note', { ...args, note });
  };
  const place = (): void => {
    commands.run('take.set-compensation', { ...args, frames: typed(placement) });
  };
  const asset = project.assets.get(take.asset);
  return (
    <div>
      <h3>{`Take in ${stack.name}`}</h3>
      <TextField label="Name" value={name} onValueChange={setName} onSubmit={rename} />
      <Button onClick={rename}>Rename the take</Button>
      <TextField label="Note" value={note} onValueChange={setNote} onSubmit={annotate} />
      <Button onClick={annotate}>Keep the note</Button>
      <TextField
        label="Placement, in frames earlier; below zero for later"
        value={placement}
        onValueChange={setPlacement}
        onSubmit={place}
      />
      <Button onClick={place}>Place the take</Button>
      <p className="ag-panel-note">
        The placement moves where the take is read from, never its samples.
      </p>
      <p>{takeFacts(project, take)}</p>
      <p>{stack.chosen === take.id ? 'It is the chosen take.' : 'It is not the chosen take.'}</p>
      {asset !== undefined && <p>{`Its recording is the asset ${asset.displayName}.`}</p>}
      <div className="ag-settings-row">
        <CommandButton id="take.audition" label="Hear" commands={commands} args={args} compact />
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
  const [name, setName] = useState(stack.name);
  const rename = (): void => {
    commands.run('take-stack.rename', { stack: stack.id, name });
  };
  const chosen = stack.chosen === undefined ? undefined : takeOf(stack, stack.chosen);
  return (
    <div>
      <h3>Take stack</h3>
      <TextField label="Name" value={name} onValueChange={setName} onSubmit={rename} />
      <Button onClick={rename}>Rename the stack</Button>
      <p>
        {`${String(stack.takes.length)} ${stack.takes.length === 1 ? 'take' : 'takes'}; ${
          chosen === undefined ? 'none is chosen' : `${chosen.name} is chosen`
        }.`}
      </p>
      {stack.punch !== undefined && (
        <p>{`It is a punch's stack: its chosen take replaces ${String(stack.punch.length)} frames, read after a pre-roll of ${String(stack.punch.preRoll)} frames.`}</p>
      )}
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
  if (open?.kind !== 'open') return <p>No project is open.</p>;
  const { project } = open.snapshot.model.state;
  const stack = project.takeStacks.get(subject.stack);
  if (stack === undefined) return <p>That take stack is no longer in the project.</p>;
  const take = subject.take === undefined ? undefined : takeOf(stack, subject.take);
  if (subject.take !== undefined && take === undefined) {
    return <p>That take is no longer in its stack.</p>;
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
