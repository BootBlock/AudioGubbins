/**
 * What a workflow runs over (ADR-0105): the sound it was opened on, or one of
 * the project's asset groups, its subgroups too where asked. Choosing another
 * plans again, with nothing left out.
 */

import type { ReactNode } from 'react';

import {
  NO_GAME_AUDIO,
  groupPath,
  memberKey,
  pathText,
  type GroupMember,
} from '@audiogubbins/game-audio';
import { itemKey, targetMembers, type WorkflowTarget } from '@audiogubbins/guided-workflows';
import type { ProjectState } from '@audiogubbins/project-format';
import { ToggleSwitch } from '@audiogubbins/design-system';
import { counted } from '@audiogubbins/text';

import { ChoiceField, type Choice } from '../export/setting-fields.js';
import { memberName } from './workflow-words.js';

/** The key a target is chosen by: a group's whether or not it takes its subgroups. */
function keyOf(target: WorkflowTarget): string {
  return itemKey(target.kind === 'group' ? target.group : target);
}

/** What it may run on: the sound it was opened on, a member it was asked to run on, every group. */
function subjectChoices(
  targets: readonly WorkflowTarget[],
  sound: GroupMember | undefined,
  state: ProjectState,
): readonly Choice<WorkflowTarget | undefined>[] {
  const { groups } = state.gameAudio ?? NO_GAME_AUDIO;
  const game = state.gameAudio ?? NO_GAME_AUDIO;
  const members = [
    ...(sound === undefined ? [] : [sound]),
    ...targets.flatMap((target) =>
      target.kind === 'group' || (sound !== undefined && memberKey(target) === memberKey(sound))
        ? []
        : [target],
    ),
  ];
  const [current] = targets;
  return [
    ...(current === undefined ? [{ value: undefined, label: 'Choose what to run it on' }] : []),
    ...members.map((member) => ({
      value: member,
      label: `The sound ${memberName(member, state)}`,
    })),
    ...[...groups.keys()].map((group) => {
      const value: WorkflowTarget =
        current?.kind === 'group' && current.group === group
          ? current
          : { kind: 'group', group, subgroups: false };
      const sounds = targetMembers(game, [value]).length;
      return {
        value,
        label: `The group “${pathText(groupPath(groups, group))}”, ${counted(sounds, 'sound', 'sounds')}`,
      };
    }),
  ];
}

export function WorkflowSubject({
  targets,
  sound,
  state,
  onTargets,
}: {
  readonly targets: readonly WorkflowTarget[];
  /** The sound the editor showed as the dialog opened. */
  readonly sound: GroupMember | undefined;
  readonly state: ProjectState;
  readonly onTargets: (targets: readonly WorkflowTarget[]) => void;
}): ReactNode {
  const [current] = targets;
  const choices = subjectChoices(targets, sound, state);
  const chosen = choices.find(
    (choice) =>
      choice.value !== undefined && current !== undefined && keyOf(choice.value) === keyOf(current),
  );
  return (
    <section className="ag-workflow-subject" aria-label="What it runs on">
      <ChoiceField
        label="Run it on"
        value={chosen?.value}
        choices={choices}
        onChoose={(value) => {
          if (value !== undefined) onTargets([value]);
        }}
      />
      {current?.kind === 'group' && (
        <ToggleSwitch
          label="Include its subgroups"
          description="Runs on the sounds of every group inside it as well."
          checked={current.subgroups}
          onCheckedChange={(subgroups) => {
            onTargets([{ ...current, subgroups }]);
          }}
        />
      )}
    </section>
  );
}
