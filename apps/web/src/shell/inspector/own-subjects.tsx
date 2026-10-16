/**
 * The Inspector's subjects of their own, apart from what the editor acts on
 * (REQ-EDIT-072): an asset group the person chose, its policy with where each
 * value comes from (ADR-0101), an export the person asked to have described,
 * and recording, with its configuration or the take or stack inspected.
 *
 * Whichever made itself the subject last is shown. A group is the subject
 * until recording, an export or an editor takes the Inspector back
 * (`group-focus.ts`), so where one is, it was chosen after the others. An
 * export is the subject only until recording claims the Inspector or an
 * editor is brought into use (`export-focus.ts`), so where one is, it was
 * asked for after recording; recording is the subject until an editor is
 * brought into use (`recording-focus.ts`). Where none is, the Inspector
 * follows the editor.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import type { ProjectState } from '@audiogubbins/project-format';

import type { GameAssetGroupId } from '@audiogubbins/game-audio';

import type { ExportSubject } from '../../export/export-focus.js';
import type { ExportRunState } from '../../export/export-types.js';
import type { TakeSubject } from '../../recording/recording-focus.js';
import type { RecordingParts } from '../../recording/recording-part.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { GroupChoice } from '../../state/group-focus.js';
import type { UserPreferences } from '../../state/preferences-store.js';
import type { Observable } from '../../state/observable.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';
import { RecordingConfiguration } from '../recording/recording-configuration.js';
import { TakeInspector } from '../recording/take-inspector.js';
import { GroupPolicySection } from '../game/group-policy.js';
import { usePolicyParts } from '../game/policy-parts.js';
import { ExportDescription } from './export-description.js';

/** What the subjects of their own are read from. */
export interface OwnSubjectParts {
  readonly recording: RecordingParts;
  readonly audioSettings: Observable<AudioSettings>;

  /** The page's export, absent where this browser keeps no projects. */
  readonly exports: Observable<ExportRunState> | undefined;

  /** The export described, while one is the subject. */
  readonly exportSubject: Observable<ExportSubject | undefined>;

  /** The asset group chosen, and whether the Inspector describes it. */
  readonly groups: Observable<GroupChoice | undefined>;

  /** The person's preferences, whose export presets a group's profile may be set from. */
  readonly preferences: Observable<UserPreferences>;
}

/** The subject of its own the Inspector shows, where it shows one. */
export type OwnSubject =
  | { readonly kind: 'group'; readonly group: GameAssetGroupId }
  | { readonly kind: 'export'; readonly subject: ExportSubject }
  | { readonly kind: 'recording'; readonly take: TakeSubject | undefined };

/** The subject of its own the Inspector shows, following each store it is read from. */
export function useOwnSubject(parts: OwnSubjectParts): OwnSubject | undefined {
  const { recording } = parts;
  const recordingInFocus = useSyncExternalStore(recording.focus.subscribe, recording.focus.get);
  const take = useSyncExternalStore(recording.inspected.subscribe, recording.inspected.get);
  const exported = useSyncExternalStore(parts.exportSubject.subscribe, parts.exportSubject.get);
  const chosen = useSyncExternalStore(parts.groups.subscribe, parts.groups.get);
  if (chosen?.inspected === true) return { kind: 'group', group: chosen.group };
  if (exported !== undefined) return { kind: 'export', subject: exported };
  return recordingInFocus ? { kind: 'recording', take } : undefined;
}

/** What the Inspector shows of a subject of its own. */
export function OwnSubjectView({
  own,
  parts,
  projects,
  commands,
}: {
  readonly own: OwnSubject;
  readonly parts: OwnSubjectParts;
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  if (own.kind === 'group') {
    return <GroupSubject group={own.group} parts={parts} projects={projects} commands={commands} />;
  }
  if (own.kind === 'export') {
    return <ExportDescription subject={own.subject} parts={{ exports: parts.exports, projects }} />;
  }
  return own.take === undefined ? (
    <RecordingConfiguration
      recording={parts.recording}
      audioSettings={parts.audioSettings}
      commands={commands}
    />
  ) : (
    <TakeInspector subject={own.take} projects={projects} commands={commands} />
  );
}

/** A store that never changes, standing in for the project where this browser keeps none. */
const NO_PROJECT = { get: () => undefined, subscribe: () => () => undefined };

/** The policy of the asset group chosen, as the project now holds it. */
function GroupSubject({
  group,
  parts,
  projects,
  commands,
}: {
  readonly group: GameAssetGroupId;
  readonly parts: OwnSubjectParts;
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const open = useSyncExternalStore(
    projects?.project.subscribe ?? NO_PROJECT.subscribe,
    projects?.project.get ?? NO_PROJECT.get,
  );
  const state = open?.kind === 'open' ? open.snapshot.model.state : undefined;
  if (state === undefined) return <p>Open a project to see its asset groups.</p>;
  return (
    <OpenGroup group={group} state={state} parts={parts} projects={projects} commands={commands} />
  );
}

/** The policy of `group` in `state`, or that the group is no longer in the project. */
function OpenGroup({
  group,
  state,
  parts,
  projects,
  commands,
}: {
  readonly group: GameAssetGroupId;
  readonly state: ProjectState;
  readonly parts: OwnSubjectParts;
  readonly projects: ProjectStores | undefined;
  readonly commands: PanelCommands;
}): ReactNode {
  const policyParts = usePolicyParts({ projects, preferences: parts.preferences, commands }, state);
  const held = policyParts.view.game.groups.get(group);
  return held === undefined ? (
    <p>That asset group is no longer in the project.</p>
  ) : (
    <GroupPolicySection group={held} parts={policyParts} />
  );
}
