/**
 * The Asset groups panel (ADR-0101, ADR-0102): the project's asset groups as a
 * tree, the commands that make, move, name, delete and export them, and, for
 * the group chosen, its members in their assignment order, each with how it
 * stands to its group's processing, what it overrides, its loudness against the
 * target it resolves to, and its export as the game export plan has it, planned
 * with the owner of each value or refused with every reason.
 *
 * It reads the stores and runs commands, and writes nothing itself (`CLAUDE.md`
 * G2): the policy is the game-audio package's resolution of the project state
 * as it stands, the plan is worked out from it as it is drawn
 * (`export-plan.tsx`), and the loudness readings are the session's measurements
 * (`group-members.tsx`).
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import { OptionSelect } from '@audiogubbins/design-system';
import type { GameAssetGroup, GameAssetGroupId } from '@audiogubbins/game-audio';
import type { ProjectState } from '@audiogubbins/project-format';

import { gamePolicyView, type GamePolicyView } from '../../state/game-policy-view.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ExportPlan } from './export-plan.js';
import { GroupMembers } from './group-members.js';
import { GroupTree } from './group-tree.js';
import type { GroupsParts } from './groups-parts.js';

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** Where the group chosen may move: the top, or any group not inside it. */
function MoveControl({
  group,
  view,
  commands,
}: {
  readonly group: GameAssetGroup;
  readonly view: GamePolicyView;
  readonly commands: PanelCommands;
}): ReactNode {
  /** Whether `candidate` is the group or inside it, where it cannot move. */
  const within = (candidate: GameAssetGroupId): boolean => {
    for (let at = view.game.groups.get(candidate); at !== undefined;) {
      if (at.id === group.id) return true;
      at = at.parent === undefined ? undefined : view.game.groups.get(at.parent);
    }
    return false;
  };
  const options = [
    { value: '', label: 'The top level' },
    ...[...view.game.groups.values()]
      .filter((one) => !within(one.id))
      .map((one) => ({ value: one.id, label: view.pathOf(one.id).join('/') })),
  ];
  const [parent, setParent] = useState(group.parent ?? '');
  return (
    <div className="ag-inspector-row">
      <OptionSelect label="Move into" value={parent} options={options} onValueChange={setParent} />
      <CommandButton
        id="game.move-group"
        label="Move"
        commands={commands}
        args={{ group: group.id, ...(parent === '' ? {} : { parent }) }}
        compact
      />
    </div>
  );
}

/** What can be done with the group chosen, each a command given the group: its label here. */
const GROUP_ACTIONS: readonly (readonly [id: string, label: string])[] = [
  ['game.new-group', 'New group inside'],
  ['game.assign-selection', 'Put the selection in it'],
  ['game.choose-group', 'Show its policy'],
  ['game.measure-loudness', 'Measure loudness'],
  ['game.name-members', 'Name its regions'],
  ['game.delete-group', 'Delete'],
];

/** The group chosen: its commands, its members and its export plan. */
function ChosenGroup({
  group,
  state,
  view,
  parts,
  commands,
}: {
  readonly group: GameAssetGroup;
  readonly state: ProjectState;
  readonly view: GamePolicyView;
  readonly parts: GroupsParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  const memberships = view.membersOf(group.id);
  const args = { group: group.id };
  return (
    <section aria-labelledby={heading}>
      <h3 className="ag-section-heading" id={heading}>
        {view.pathOf(group.id).join('/')}
      </h3>
      <div className="ag-inspector-row">
        {GROUP_ACTIONS.map(([id, label]) => (
          <CommandButton
            key={id}
            id={id}
            label={label}
            commands={commands}
            args={id === 'game.new-group' ? { parent: group.id } : args}
            compact
          />
        ))}
      </div>
      <MoveControl key={group.id} group={group} view={view} commands={commands} />
      <GroupMembers
        group={group}
        memberships={memberships}
        state={state}
        view={view}
        parts={parts}
        commands={commands}
      />
      <ExportPlan
        group={group}
        memberships={memberships}
        state={state}
        view={view}
        parts={parts}
        commands={commands}
      />
    </section>
  );
}

/** The groups of the open project, and the group chosen. */
function OpenGroups({
  state,
  parts,
  commands,
}: {
  readonly state: ProjectState;
  readonly parts: GroupsParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const choice = useSyncExternalStore(parts.groups.subscribe, parts.groups.get);
  const view = gamePolicyView(state);
  const chosen = choice === undefined ? undefined : view.game.groups.get(choice.group);
  return (
    <>
      <div className="ag-inspector-row">
        <CommandButton id="game.new-group" label="New group" commands={commands} compact />
        <CommandButton
          id="game.cancel-loudness"
          label="Stop measuring"
          commands={commands}
          compact
        />
      </div>
      <GroupTree view={view} chosen={chosen?.id} commands={commands} label="Asset groups" />
      {chosen === undefined ? (
        <p>Choose a group to see its members, their loudness and its export plan.</p>
      ) : (
        <ChosenGroup group={chosen} state={state} view={view} parts={parts} commands={commands} />
      )}
    </>
  );
}

/** The Asset groups panel. */
export function GroupsPanel({
  title,
  parts,
  commands,
}: {
  readonly title: string;
  readonly parts: GroupsParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const open = useSyncExternalStore(
    parts.projects?.project.subscribe ?? NO_PROJECT.subscribe,
    parts.projects?.project.get ?? NO_PROJECT.get,
  );
  const state = open?.kind === 'open' ? open.snapshot.model.state : undefined;
  return (
    <section className="ag-panel ag-game-groups">
      <h2 className="ag-panel-title">{title}</h2>
      <p className="ag-panel-note">
        Groups give their members a shared policy: processing, loudness, export, naming and how the
        game plays them. A member inherits each value unless it sets its own.
      </p>
      {state === undefined ? (
        <p>Open a project to group its sounds.</p>
      ) : (
        <OpenGroups state={state} parts={parts} commands={commands} />
      )}
    </section>
  );
}
