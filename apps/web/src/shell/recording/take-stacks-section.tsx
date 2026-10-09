/**
 * The Recording panel's take stacks (`ADR-0072`, `REQ-REC-089`, `REQ-UX-005`):
 * each stack of the open project, a punch's with the audio it punches, and each
 * of its takes with its name, note, state, length, placement, whether it is
 * chosen and, for a punch's, why it cannot serve it; with the commands that
 * hear, choose, reject, keep, remove, restore, duplicate and branch a take, arm
 * the stack's next take, keep only its chosen take, withdraw its punch or
 * remove it, and show a take or a stack in the Inspector, where it is named and
 * noted.
 *
 * Every control runs a command, so each is as much the keyboard's and a screen
 * reader's as the pointer's; a take's mark is its words as well as its look.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import {
  TakeState,
  punchTakeProblem,
  shapesOf,
  stackUsers,
  type Project,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import { ARM } from '../../commands/take-recording-commands.js';
import { punchPlaceOf } from '../../recording/take-target.js';
import { TAKE_STATE_NAMES, compensationText, recordedText } from '../../recording/take-words.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, type PanelCommands } from '../command-button.js';

const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** A take's facts in one line: its state, length, placement and note. */
export function takeFacts(project: Project, take: Take): string {
  const asset = project.assets.get(take.asset);
  const length = asset === undefined ? '' : `, ${recordedText(asset.length / asset.sampleRate)}`;
  const placed =
    asset === undefined ? '' : `, placed ${compensationText(take.compensation, asset.sampleRate)}`;
  const note = take.note === '' ? '' : `. ${take.note}`;
  return `${TAKE_STATE_NAMES[take.state]}${length}${placed}${note}`;
}

/** Why `take` cannot serve the punch of `stack`, where the stack is a punch's and it cannot. */
function punchProblemOf(project: Project, stack: TakeStack, take: Take): string | undefined {
  if (stack.punch === undefined) return undefined;
  const place = punchPlaceOf(project, stack);
  const target = place.ok ? shapesOf(place.value.asset).at(-1) : undefined;
  return target === undefined
    ? undefined
    : punchTakeProblem(take, stack.punch, target, project.assets);
}

/** One take, and what can be done with it. */
function TakeRow({
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
  const chosen = stack.chosen === take.id;
  const problem = punchProblemOf(project, stack, take);
  const button = (id: string, label: string): ReactNode => (
    <CommandButton id={id} label={label} commands={commands} args={args} compact />
  );
  return (
    <li aria-current={chosen ? 'true' : undefined} data-ag-take={take.id}>
      <p>
        <strong>{take.name}</strong>
        {chosen ? ' (chosen)' : ''}: {takeFacts(project, take)}
      </p>
      {problem !== undefined && (
        <p className="ag-panel-note" data-ag-status="reduced">
          {`It cannot serve the punch. ${problem}`}
        </p>
      )}
      <div className="ag-settings-row" role="group" aria-label={`Take ${quoted(take.name)}`}>
        {button('take.audition', 'Hear')}
        {take.state === TakeState.Kept && !chosen && button('take.choose', 'Choose')}
        {take.state === TakeState.Kept && button('take.reject', 'Reject')}
        {take.state === TakeState.Rejected && button('take.keep', 'Keep')}
        {take.state === TakeState.Removed
          ? button('take.restore', 'Restore')
          : button('take.remove', 'Remove')}
        {button('take.duplicate', 'Duplicate')}
        {button('take.branch', 'Branch')}
        {button('take.inspect', 'Inspect')}
      </div>
    </li>
  );
}

/** What a stack is, in words: a punch's, over which audio, or a stack of takes. */
function stackText(project: Project, stack: TakeStack): string {
  const count = `${String(stack.takes.length)} ${stack.takes.length === 1 ? 'take' : 'takes'}`;
  if (stack.punch === undefined) return count;
  const [use] = stackUsers(project, stack.id);
  const asset = use === undefined ? undefined : project.assets.get(use.asset);
  if (asset !== undefined) return `A punch over ${quoted(asset.displayName)}, ${count}`;
  return `A punch withdrawn from its audio, ${count}`;
}

/** One stack, its takes, and what can be done with it. */
function StackItem({
  stack,
  project,
  commands,
}: {
  readonly stack: TakeStack;
  readonly project: Project;
  readonly commands: PanelCommands;
}): ReactNode {
  const args = { stack: stack.id };
  return (
    <li data-ag-stack={stack.id}>
      <h4>{stack.name}</h4>
      <p className="ag-panel-note">{stackText(project, stack)}</p>
      <div className="ag-settings-row" role="group" aria-label={`Stack ${quoted(stack.name)}`}>
        <CommandButton id={ARM} label="Arm the next take" commands={commands} args={args} compact />
        <CommandButton
          id="take-stack.consolidate"
          label="Keep only the chosen take"
          commands={commands}
          args={args}
          compact
        />
        {stack.punch === undefined ? (
          <CommandButton
            id="take-stack.remove"
            label="Remove the stack"
            commands={commands}
            args={args}
            compact
          />
        ) : (
          <CommandButton
            id="take-stack.remove-punch"
            label="Withdraw the punch"
            commands={commands}
            args={args}
            compact
          />
        )}
        <CommandButton id="take.inspect" label="Inspect" commands={commands} args={args} compact />
      </div>
      <ol aria-label={`Takes of ${quoted(stack.name)}`}>
        {stack.takes.map((take) => (
          <TakeRow key={take.id} stack={stack} take={take} project={project} commands={commands} />
        ))}
      </ol>
    </li>
  );
}

/** The open project's take stacks, in the Recording panel. */
export function TakeStacksSection({
  projects,
  commands,
}: {
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  if (open?.kind !== 'open') return null;
  const { project } = open.snapshot.model.state;
  const stacks = [...project.takeStacks.values()];
  return (
    <div>
      <h3>Take stacks</h3>
      {stacks.length === 0 ? (
        <p className="ag-panel-note">No takes are recorded in this project yet.</p>
      ) : (
        <ul className="ag-take-stacks">
          {stacks.map((stack) => (
            <StackItem key={stack.id} stack={stack} project={project} commands={commands} />
          ))}
        </ul>
      )}
    </div>
  );
}
