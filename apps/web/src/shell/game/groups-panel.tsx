/**
 * The Asset groups panel (ADR-0101, ADR-0102): the project's asset groups as
 * a tree, the commands that make, move, name, delete and export them, and, for
 * the group chosen, its members in their assignment order, each with how it
 * stands to its group's processing, what it overrides, its loudness against
 * the target it resolves to, and its export as the game export plan has it,
 * planned with the owner of each value or refused with every reason.
 *
 * It reads the stores and runs commands, and writes nothing itself (`CLAUDE.md`
 * G2): the policy is the game-audio package's resolution of the project state
 * as it stands, the plan is worked out from it as it is drawn, and the
 * loudness readings are the session's measurements. Every verdict is words,
 * with its sign written as text.
 */

import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';

import { OptionSelect, VisuallyHidden } from '@audiogubbins/design-system';
import type { CodecEnvironment } from '@audiogubbins/codecs';
import {
  memberKey,
  type GameAssetGroup,
  type GameAssetGroupId,
  type GameExportItem,
  type GroupMembership,
  type PolicySource,
} from '@audiogubbins/game-audio';
import { safeFileName } from '@audiogubbins/import-export';
import type { ProjectState } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';

import { detectionIdentity } from '../../analysis/detection-control.js';
import { assetEntryId, regionEntryId } from '../../assets/project-entry.js';
import { gameExportPlan } from '../../commands/game-export-commands.js';
import { memberArgument, memberName } from '../../commands/game-target.js';
import { exportClockAt } from '../../export/page-export.js';
import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import { gamePolicyView, type GamePolicyView } from '../../state/game-policy-view.js';
import type { GroupChoice } from '../../state/group-focus.js';
import type { LoudnessReadings } from '../../state/loudness-store.js';
import type { Observable } from '../../state/observable.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { loudnessWords } from './game-words.js';
import { GroupTree } from './group-tree.js';
import { conformance, conformanceWords } from './loudness-conformance.js';

/** What the panel reads. */
export interface GroupsParts {
  readonly projects: ProjectStores | undefined;
  readonly groups: Observable<GroupChoice | undefined>;
  readonly loudness: Observable<LoudnessReadings>;
  readonly assets: Pick<AssetCatalogue, 'find' | 'get' | 'subscribe'>;
  readonly audioSettings: Observable<AudioSettings>;
  readonly codecs: Observable<CodecEnvironment>;
}

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** Where a value of a planned file comes from, in a phrase. */
function ownerWords(source: PolicySource, view: GamePolicyView): string {
  switch (source.kind) {
    case 'override':
      return 'its own';
    case 'group':
      return view.pathOf(source.group).join('/');
    case 'unset':
      return 'not set';
  }
}

/** One item of the game export plan, in words. */
function itemWords(item: GameExportItem, state: ProjectState, view: GamePolicyView): string {
  const name = memberName(state.project, item.member);
  if (item.kind === 'refused') {
    return `✗ ${name}: ${item.failures.map((one) => one.summary).join(' ')}`;
  }
  const folder = item.destination.segments.join('/');
  const file = safeFileName(item.file.name);
  const where = folder === '' ? file : `${folder}/${file}`;
  const { provenance } = item;
  return `✓ ${name} → ${where} (profile: ${ownerWords(provenance.exportProfile, view)}; name: ${ownerWords(provenance.naming, view)}; folder: ${ownerWords(provenance.destination, view)})`;
}

/** The members of the group chosen, each with its processing, overrides and loudness. */
function Members({
  group,
  memberships,
  state,
  view,
  parts,
  commands,
}: {
  readonly group: GameAssetGroup;
  readonly memberships: readonly GroupMembership[];
  readonly state: ProjectState;
  readonly view: GamePolicyView;
  readonly parts: GroupsParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const caption = useId();
  const readings = useSyncExternalStore(parts.loudness.subscribe, parts.loudness.get);
  const settings = useSyncExternalStore(parts.audioSettings.subscribe, parts.audioSettings.get);
  useSyncExternalStore(parts.assets.subscribe, parts.assets.get);
  if (memberships.length === 0) {
    return (
      <p>
        No members yet. Select regions in the editor, or show an asset, and put them in the group.
      </p>
    );
  }
  return (
    <table className="ag-group-members" aria-labelledby={caption}>
      <caption id={caption}>{`Members of ${view.pathOf(group.id).join('/')}`}</caption>
      <thead>
        <tr>
          <th scope="col">Member</th>
          <th scope="col">Processing</th>
          <th scope="col">Overrides</th>
          <th scope="col">Loudness target</th>
          <th scope="col">Loudness</th>
          <th scope="col">
            <VisuallyHidden>Actions</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {memberships.map((membership) => {
          const { member } = membership;
          const policy = view.member(member);
          const target = policy.loudness.value;
          const audio = parts.assets.find(
            member.kind === 'region' ? regionEntryId(member.region) : assetEntryId(member.asset),
          );
          const identity =
            audio === undefined ? undefined : detectionIdentity(audio, settings.renderQuality);
          const verdict = conformance(target, readings.get(memberKey(member)), identity);
          const overrides = Object.keys(membership.overrides).length;
          return (
            <tr key={memberKey(member)}>
              <th scope="row">{memberName(state.project, member)}</th>
              <td>{membership.processing === 'inherit' ? 'Inherits' : 'Its own'}</td>
              <td>{overrides === 0 ? 'None' : counted(overrides, 'field', 'fields')}</td>
              <td>{target === undefined ? 'Not set' : loudnessWords(target)}</td>
              <td>{conformanceWords(verdict)}</td>
              <td>
                <CommandButton
                  id="game.remove-from-group"
                  label="Take out"
                  commands={commands}
                  args={{ member: memberArgument(member) }}
                  compact
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The game export plan of the group chosen, and the command that exports its planned members. */
function ExportPlan({
  group,
  memberships,
  state,
  view,
  parts,
  commands,
}: {
  readonly group: GameAssetGroup;
  readonly memberships: readonly GroupMembership[];
  readonly state: ProjectState;
  readonly view: GamePolicyView;
  readonly parts: GroupsParts;
  readonly commands: PanelCommands;
}): ReactNode {
  const heading = useId();
  useSyncExternalStore(parts.codecs.subscribe, parts.codecs.get);
  // The moment the plan is shown from, which a `{date}` in a name reads; the
  // export itself is planned again at the moment it is asked for.
  const [asked] = useState(() => exportClockAt(Date.now()));
  if (memberships.length === 0) return null;
  const plan = gameExportPlan(
    parts,
    state,
    memberships.map((one) => one.member),
    asked,
  );
  const planned = plan.items.filter((item) => item.kind === 'planned').length;
  return (
    <section aria-labelledby={heading}>
      <h3 className="ag-section-heading" id={heading}>
        Export plan
      </h3>
      <p>
        {`${counted(planned, 'member is', 'members are')} planned and ${counted(plan.items.length - planned, 'is', 'are')} refused. The folder each goes into is inside the folder you export to; a download has none.`}
      </p>
      <ul>
        {plan.items.map((item) => (
          <li key={memberKey(item.member)}>{itemWords(item, state, view)}</li>
        ))}
      </ul>
      <CommandButton
        id="game.export-group"
        label="Export the planned members…"
        commands={commands}
        args={{ group: group.id }}
        refusal={planned === 0 ? 'No member of the group is planned yet.' : undefined}
      />
    </section>
  );
}

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
        <CommandButton
          id="game.new-group"
          label="New group inside"
          commands={commands}
          args={{ parent: group.id }}
          compact
        />
        <CommandButton
          id="game.assign-selection"
          label="Put the selection in it"
          commands={commands}
          args={args}
          compact
        />
        <CommandButton
          id="game.choose-group"
          label="Show its policy"
          commands={commands}
          args={args}
          compact
        />
        <CommandButton
          id="game.measure-loudness"
          label="Measure loudness"
          commands={commands}
          args={args}
          compact
        />
        <CommandButton
          id="game.name-members"
          label="Name its regions"
          commands={commands}
          args={args}
          compact
        />
        <CommandButton
          id="game.delete-group"
          label="Delete"
          commands={commands}
          args={args}
          compact
        />
      </div>
      <MoveControl key={group.id} group={group} view={view} commands={commands} />
      <Members
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
