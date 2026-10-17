/**
 * The words of the guided workflows' dialogs (ADR-0105), British English:
 * what each workflow is for, where each option's value came from, what each
 * item is about and how it stands, and the names of the choices.
 */

import { ValueSource } from '@audiogubbins/design-system';
import { FadeShape } from '@audiogubbins/domain';
import {
  groupPath,
  pathText,
  type GameAssetGroupId,
  type GroupMember,
} from '@audiogubbins/game-audio';
import type {
  GodotFormat,
  OptionSource,
  WorkflowItem,
  WorkflowItemTarget,
  WorkflowKey,
} from '@audiogubbins/guided-workflows';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import type { DraftSource } from '../../state/workflow-drafts.js';

/** The sentence each dialog opens with, saying what it does. */
export const WORKFLOW_PURPOSES: Readonly<Record<WorkflowKey, string>> = {
  'cut-into-sounds':
    'Makes a region of each sound between the silences, named and put in a group. Every item is shown before anything changes, and one undo takes them all away.',
  'prepare-one-shot':
    'Trims each sound to its start and end, fades its edges, removes a DC offset where one is found and sets its level. Every item is shown before anything changes.',
  'create-seamless-loop':
    'Searches each region for loop points that join cleanly, and loops it at the candidate you choose. Nothing is looped that you did not choose.',
  'normalise-game-sfx':
    'Normalises each sound to its loudness target at the end of its processing, then measures it. Every item is shown before anything changes.',
  'clean-dialogue':
    'Treats each line with the assistants’ recommendations, a high-pass filter, a de-esser, denoising and loudness normalisation. Every item is shown before anything changes.',
  'export-for-godot':
    'Sets each group’s export format, naming and folder for Godot 4. The export itself is offered after the change, as its own action, since an export is never undone.',
};

/**
 * What Godot 4 does with what Export for Godot writes, as its documentation
 * says: a WAV file's loop is read from its metadata where the import's loop
 * mode is Detect From WAV, the default; an Ogg Vorbis file's loop is set only
 * in Godot's import settings, and has a start and no end.
 */
export const GODOT_LOOPS =
  'Godot 4 reads a WAV file’s loop points from the file when its import’s loop mode is Detect From WAV, the default. An Ogg Vorbis file’s loop is set in Godot’s import settings and has no end point, so a looping sound in an Ogg Vorbis group is given its own WAV profile, shown as an override.';

/** Where an option's value came from, in words. */
export function sourceWords(source: DraftSource | OptionSource): string {
  switch (source.kind) {
    case 'chosen':
      return 'Chosen here';
    case 'workflow':
      return 'The workflow’s default';
    case 'targets':
      return 'From what it runs on';
    case 'policy': {
      const { source: policy } = source;
      switch (policy.kind) {
        case 'override':
          return `Overridden on this ${policy.member.kind}`;
        case 'group':
          return `Set on ${quoted(pathText(policy.path))}`;
        case 'unset':
          return 'Not set';
      }
    }
  }
}

/**
 * How a source chip draws where an option's value came from: set here or on
 * the member it runs on, taken from the workflow, what it runs on or a group
 * above, or set nowhere.
 */
export function sourceKind(source: DraftSource | OptionSource): ValueSource {
  switch (source.kind) {
    case 'chosen':
      return ValueSource.Set;
    case 'workflow':
    case 'targets':
      return ValueSource.Inherited;
    case 'policy':
      switch (source.source.kind) {
        case 'override':
          return ValueSource.Set;
        case 'group':
          return ValueSource.Inherited;
        case 'unset':
          return ValueSource.Unset;
      }
  }
}

/** The units a workflow's numbers are in, each named as said and shown as its symbol. */
export const UNITS = {
  milliseconds: { name: 'milliseconds', symbol: 'ms' },
  seconds: { name: 'seconds', symbol: 's' },
  dbfs: { name: 'dBFS', symbol: 'dBFS' },
  lufs: { name: 'LUFS', symbol: 'LUFS' },
  lu: { name: 'LU', symbol: 'LU' },
  dbtp: { name: 'dBTP', symbol: 'dBTP' },
} as const;

/** What a member is called in `state`, or what it was where the project no longer has it. */
export function memberName(member: GroupMember, state: ProjectState): string {
  const name =
    member.kind === 'region'
      ? state.project.regions.get(member.region)?.displayName
      : state.project.assets.get(member.asset)?.displayName;
  return name === undefined ? `A ${member.kind} no longer in the project` : quoted(name);
}

/** What a group is called, its whole path, or a new one the step adds. */
function groupName(group: GameAssetGroupId, state: ProjectState): string {
  const groups = state.gameAudio?.groups;
  return groups?.has(group) === true
    ? `The group ${quoted(pathText(groupPath(groups, group)))}`
    : 'A new group';
}

/** What an item is about, in words. */
export function targetName(target: WorkflowItemTarget, state: ProjectState): string {
  return typeof target === 'string' ? groupName(target, state) : memberName(target, state);
}

/** How an item stands, in a word or two. */
export const ITEM_STANDING: Readonly<Record<WorkflowItem['kind'], string>> = {
  planned: 'Will change',
  skipped: 'Skipped',
  refused: 'Refused',
};

export const FADE_SHAPES: readonly { readonly value: FadeShape; readonly label: string }[] = [
  { value: FadeShape.Linear, label: 'Linear' },
  { value: FadeShape.EqualPower, label: 'Equal power' },
  { value: FadeShape.SCurve, label: 'S-curve' },
  { value: FadeShape.Square, label: 'Square' },
];

export const PLACEMENTS = [
  { value: 'member', label: 'Give each sound its own processing' },
  { value: 'group', label: 'Add to the group’s chain, which every sound inheriting it hears' },
] as const;

export const GODOT_FORMATS: readonly { readonly value: GodotFormat; readonly label: string }[] = [
  { value: 'wav', label: 'WAV, 16-bit, at the project’s rate' },
  { value: 'ogg-vorbis', label: 'Ogg Vorbis' },
];
