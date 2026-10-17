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
  IconButton,
  Menu,
  type MenuItemDescriptor,
  Section,
  VisuallyHidden,
} from '@audiogubbins/design-system';

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
import { commandPress } from '../command-press.js';

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

/** A menu entry that runs the command `id` with `args`, unavailable with its reason. */
function commandEntry(
  commands: PanelCommands,
  id: string,
  label: string,
  args: Readonly<Record<string, string>>,
): MenuItemDescriptor {
  const { onPress, ...reason } = commandPress(commands, id, args);
  return { key: id, label, ...reason, onSelect: onPress };
}

/** The "more" button of a row, opening the actions it does not show. */
function MoreMenu({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly MenuItemDescriptor[];
}): ReactNode {
  return (
    <Menu
      label={label}
      groups={[{ key: 'more', items }]}
      trigger={<IconButton icon="more" label={label} hint={label} compact />}
    />
  );
}

/**
 * One take, and what can be done with it: hearing it and choosing it at
 * hand, as a take is judged, and the rest behind its "more" button.
 */
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
  const { onPress: hear, ...hearReason } = commandPress(commands, 'take.audition', args);
  const entry = (id: string, label: string): MenuItemDescriptor =>
    commandEntry(commands, id, label, args);
  const more = [
    ...(take.state === TakeState.Kept ? [entry('take.reject', 'Reject')] : []),
    ...(take.state === TakeState.Rejected ? [entry('take.keep', 'Keep')] : []),
    take.state === TakeState.Removed
      ? entry('take.restore', 'Restore')
      : entry('take.remove', 'Remove'),
    entry('take.duplicate', 'Duplicate'),
    entry('take.branch', 'Branch'),
    entry('take.inspect', 'Inspect'),
  ];
  return (
    <li
      className="ag-recording-take ag-lit-row"
      aria-current={chosen ? 'true' : undefined}
      data-ag-take={take.id}
      data-ag-lit={chosen ? '' : undefined}
      data-ag-state={take.state}
    >
      <span className="ag-recording-take-lamp" aria-hidden="true" />
      <div className="ag-recording-take-text">
        <p className="ag-recording-take-name">
          {take.name}
          {chosen && <VisuallyHidden> (chosen)</VisuallyHidden>}
        </p>
        <p className="ag-recording-take-facts">{takeFacts(project, take)}</p>
        {problem !== undefined && (
          <p className="ag-recording-caption" data-ag-status="reduced">
            {`It cannot serve the punch. ${problem}`}
          </p>
        )}
      </div>
      <div className="ag-recording-buttons" role="group" aria-label={`Take ${quoted(take.name)}`}>
        <IconButton
          icon="audition"
          label="Hear"
          hint="Hear"
          compact
          {...hearReason}
          onClick={hear}
        />
        {take.state === TakeState.Kept && !chosen && (
          <CommandButton id="take.choose" label="Choose" commands={commands} args={args} compact />
        )}
        <MoreMenu label={`More for ${quoted(take.name)}`} items={more} />
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
  const { onPress: arm, ...armReason } = commandPress(commands, ARM, args);
  const more = [
    commandEntry(commands, 'take-stack.consolidate', 'Keep only the chosen take', args),
    stack.punch === undefined
      ? commandEntry(commands, 'take-stack.remove', 'Remove the stack', args)
      : commandEntry(commands, 'take-stack.remove-punch', 'Withdraw the punch', args),
    commandEntry(commands, 'take.inspect', 'Inspect', args),
  ];
  return (
    <li className="ag-recording-stack" data-ag-stack={stack.id}>
      <div className="ag-recording-stack-header">
        <div className="ag-recording-stack-text">
          <h4 className="ag-recording-stack-name">{stack.name}</h4>
          <p className="ag-recording-caption">{stackText(project, stack)}</p>
        </div>
        <div
          className="ag-recording-buttons"
          role="group"
          aria-label={`Stack ${quoted(stack.name)}`}
        >
          <IconButton
            icon="armed"
            label="Arm the next take"
            hint="Arm the next take"
            compact
            {...armReason}
            onClick={arm}
          />
          <MoreMenu label={`More for ${quoted(stack.name)}`} items={more} />
        </div>
      </div>
      <ol className="ag-recording-take-list" aria-label={`Takes of ${quoted(stack.name)}`}>
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
    <Section
      title="Takes"
      {...(stacks.length === 0
        ? {}
        : {
            summary: `${String(stacks.length)} ${stacks.length === 1 ? 'stack' : 'stacks'}`,
          })}
    >
      {stacks.length === 0 ? (
        <p className="ag-recording-caption">No takes are recorded in this project yet.</p>
      ) : (
        <ul className="ag-recording-stacks">
          {stacks.map((stack) => (
            <StackItem key={stack.id} stack={stack} project={project} commands={commands} />
          ))}
        </ul>
      )}
    </Section>
  );
}
