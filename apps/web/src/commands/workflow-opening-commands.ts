/**
 * The commands that open each guided workflow's dialog (ADR-0105) over what
 * it is asked to run on: a group, its subgroups too where asked, a region or
 * an asset named, or with none named, the sound the editor in use shows, with
 * the project's groups offered beside it in the dialog.
 */

import {
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { GroupMember } from '@audiogubbins/game-audio';
import {
  CLEAN_DIALOGUE,
  CREATE_SEAMLESS_LOOP,
  CUT_INTO_SOUNDS,
  EXPORT_FOR_GODOT,
  NORMALISE_GAME_SFX,
  PREPARE_ONE_SHOT,
  type WorkflowKey,
  type WorkflowTarget,
} from '@audiogubbins/guided-workflows';
import type { ProjectId } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';

import type { WorkflowDraftStore } from '../state/workflow-draft-store.js';

import { focusedEditor } from './editor-target.js';
import { idArgument } from './project-access.js';
import { availableUnless, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { WORKFLOW_KEYS, WORKFLOW_OPENING } from './workflow-command-ids.js';
import { dialogParts } from './workflow-dialog-parts.js';

/** Each workflow's label, as its planner gives it. */
const LABELS: Readonly<Record<WorkflowKey, string>> = {
  'cut-into-sounds': CUT_INTO_SOUNDS.label,
  'prepare-one-shot': PREPARE_ONE_SHOT.label,
  'create-seamless-loop': CREATE_SEAMLESS_LOOP.label,
  'normalise-game-sfx': NORMALISE_GAME_SFX.label,
  'clean-dialogue': CLEAN_DIALOGUE.label,
  'export-for-godot': EXPORT_FOR_GODOT.label,
};

/** What each workflow does, for the palette. */
const DESCRIPTIONS: Readonly<Record<WorkflowKey, string>> = {
  'cut-into-sounds':
    'Finds the sounds between the silences of a recording and makes a region of each, named and put in a group, as one step.',
  'prepare-one-shot':
    'Trims each sound to its start and end, fades its edges, removes a DC offset and sets its level, as one step.',
  'create-seamless-loop':
    'Searches a region for loop points that join without a click, and loops it at the candidate you choose, as one step.',
  'normalise-game-sfx':
    'Sets a group’s loudness target and normalises its sounds to it at the end of their processing, then measures them.',
  'clean-dialogue':
    'Treats dialogue with the restoration and repair assistants’ recommendations, a high-pass filter, a de-esser, denoising and loudness normalisation.',
  'export-for-godot':
    'Sets each group’s export format, naming and folder to what Godot 4 imports, then offers the export as its own action.',
};

const KEYWORDS: Readonly<Record<WorkflowKey, readonly string[]>> = {
  'cut-into-sounds': ['workflow', 'cut', 'split', 'silence', 'regions', 'sounds', 'game'],
  'prepare-one-shot': ['workflow', 'one-shot', 'trim', 'fade', 'normalise', 'game', 'sfx'],
  'create-seamless-loop': ['workflow', 'loop', 'seamless', 'crossfade', 'game'],
  'normalise-game-sfx': ['workflow', 'normalise', 'loudness', 'lufs', 'game', 'sfx'],
  'clean-dialogue': ['workflow', 'dialogue', 'voice', 'clean', 'denoise', 'de-ess'],
  'export-for-godot': ['workflow', 'godot', 'export', 'game', 'naming'],
};

/** The sound the editor in use shows, as a member of the project, or why there is none. */
function editorSound(context: ShellContext): GroupMember | string {
  const target = focusedEditor(context);
  if (typeof target === 'string') return target;
  const { owner } = target.asset;
  if (owner.kind !== 'project') return owner.reason;
  return owner.region === undefined
    ? { kind: 'asset', asset: owner.asset.id }
    : { kind: 'region', region: owner.region.id };
}

/**
 * The targets an invocation names: a group, its subgroups too where
 * `subgroups` is true; a region; or an asset; or none named.
 */
function namedTargets(
  invocation: CommandInvocation,
  state: ProjectState,
): readonly WorkflowTarget[] | string | undefined {
  const args = invocation.arguments ?? {};
  if (textArgument(invocation, 'group') !== undefined) {
    const group = idArgument<'GameAssetGroupId'>(invocation, 'group', 'group');
    if ('refused' in group) return group.refused;
    if (state.gameAudio?.groups.has(group.id) !== true) return 'There is no such group.';
    return [{ kind: 'group', group: group.id, subgroups: args['subgroups'] === true }];
  }
  if (textArgument(invocation, 'region') !== undefined) {
    const region = idArgument<'RegionId'>(invocation, 'region', 'region');
    if ('refused' in region) return region.refused;
    if (!state.project.regions.has(region.id)) return 'There is no such region.';
    return [{ kind: 'region', region: region.id }];
  }
  if (textArgument(invocation, 'asset') !== undefined) {
    const asset = idArgument<'AssetId'>(invocation, 'asset', 'asset');
    if ('refused' in asset) return asset.refused;
    if (!state.project.assets.has(asset.id)) return 'There is no such asset.';
    return [{ kind: 'asset', asset: asset.id }];
  }
  return undefined;
}

/** Why a workflow cannot open with nothing named: no sound in the editor, and no group to choose. */
function nothingToRunOn(context: ShellContext, state: ProjectState): string | undefined {
  const sound = editorSound(context);
  if (typeof sound !== 'string' || (state.gameAudio?.groups.size ?? 0) > 0) return undefined;
  return `${sound} Or make an asset group to run it over.`;
}

/** Whether `store` shows the workflow keyed `key` over `targets` of `project`, being set up. */
function showing(
  store: WorkflowDraftStore,
  key: WorkflowKey,
  project: ProjectId,
  targets: readonly WorkflowTarget[],
): boolean {
  const shown = store.get();
  // A target is plain data written the same way however it was named.
  return (
    shown.kind === 'open' &&
    shown.step.kind === 'setting' &&
    shown.project === project &&
    shown.draft.key === key &&
    JSON.stringify(shown.targets) === JSON.stringify(targets)
  );
}

function openingAvailability(context: ShellContext): CommandAvailability {
  const parts = dialogParts(context);
  if (typeof parts === 'string') return unavailable(parts);
  return availableUnless(nothingToRunOn(context, parts.session.getSnapshot().model.state));
}

function openingCommand(key: WorkflowKey): Command<ShellContext> {
  return shellCommand(
    WORKFLOW_OPENING[key],
    `${LABELS[key]}…`,
    CommandCategory.Tools,
    (context, invocation) => {
      const parts = dialogParts(context);
      if (typeof parts === 'string') return parts;
      const { store, session } = parts;
      const state = session.getSnapshot().model.state;
      const named = namedTargets(invocation, state);
      if (typeof named === 'string') return named;
      const sound = editorSound(context);
      if (named === undefined) {
        const problem = nothingToRunOn(context, state);
        if (problem !== undefined) return problem;
      }
      const editorMember = typeof sound === 'string' ? undefined : sound;
      const targets = named ?? (editorMember === undefined ? [] : [editorMember]);
      if (showing(store, key, session.project, targets)) {
        return unchanged('workflow.open-already', `${LABELS[key]} is open over these already.`);
      }
      context.workflowAnalysis.cancel();
      store.open({
        project: session.project,
        key,
        state,
        targets,
        sound: editorMember,
      });
      return undefined;
    },
    {
      availability: openingAvailability,
      keywords: KEYWORDS[key],
      description: `${DESCRIPTIONS[key]} Shows every item and what it will change before anything runs. A group may be given as group (with subgroups true to take its subgroups), or a region or an asset; with none, the sound the editor shows.`,
    },
  );
}

/** The commands that open each workflow's dialog. */
export function workflowOpeningCommands(): readonly Command<ShellContext>[] {
  return WORKFLOW_KEYS.map(openingCommand);
}
