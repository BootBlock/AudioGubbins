/**
 * A guided workflow's options as its dialog holds them while the person sets
 * them up (ADR-0105): each option's value, and where it came from, the
 * workflow's own default, the targets, a group's policy, or the person, which
 * the dialog shows beside it.
 *
 * Most workflows' options are held as the planner takes them. Two hold some as
 * the person types or chooses them: Cut Into Sounds's group, which may be one
 * the step makes, and the naming of it and of Export for Godot, which is the
 * template's text, read when the plan is made, so a template being typed is
 * never lost for not reading yet.
 */

import type { GameAssetGroupId } from '@audiogubbins/game-audio';
import {
  CLEAN_DIALOGUE,
  CREATE_SEAMLESS_LOOP,
  CUT_INTO_SOUNDS,
  EXPORT_FOR_GODOT,
  NORMALISE_GAME_SFX,
  PREPARE_ONE_SHOT,
  type CleanDialogueOptions,
  type CreateSeamlessLoopOptions,
  type GodotFormat,
  type NormaliseGameSfxOptions,
  type OptionSource,
  type PrepareOneShotOptions,
  type WorkflowKey,
  type WorkflowTarget,
} from '@audiogubbins/guided-workflows';
import type { ProjectState } from '@audiogubbins/project-format';

/** Where an option's value came from: as the workflow offered it, or chosen by the person. */
export type DraftSource = OptionSource | { readonly kind: 'chosen' };

/** An option's value and where it came from. */
export interface DraftField<T> {
  readonly value: T;
  readonly source: DraftSource;
}

/** Every option of `O`, each with where its value came from. */
export type DraftFields<O> = { readonly [F in keyof O]-?: DraftField<O[F]> };

/** The group Cut Into Sounds puts the sounds in: one the project has, or one the step makes. */
export type CutDestination =
  | { readonly kind: 'group'; readonly group: GameAssetGroupId | undefined }
  /** A group path, `/` between its names, whose groups the project lacks are added in the step. */
  | { readonly kind: 'new'; readonly path: string };

/** Cut Into Sounds's options as the dialog holds them. */
export interface CutDraft {
  readonly destination: CutDestination;
  /** The naming template's text. */
  readonly naming: string;
  readonly threshold: number | undefined;
  readonly shortestPause: number | undefined;
  readonly leadInMilliseconds: number;
  readonly tailMilliseconds: number;
}

/** Export for Godot's options as the dialog holds them. */
export interface GodotDraft {
  readonly format: GodotFormat;
  /** The naming template's text. */
  readonly naming: string;
  /** The folders every group's path is placed under, `/` between them. */
  readonly destinationRoot: string;
}

interface DraftOf<K extends WorkflowKey, O> {
  readonly key: K;
  readonly fields: DraftFields<O>;
}

/** A workflow's options as its dialog holds them, by the workflow. */
export type WorkflowDraft =
  | DraftOf<'cut-into-sounds', CutDraft>
  | DraftOf<'prepare-one-shot', PrepareOneShotOptions>
  | DraftOf<'create-seamless-loop', CreateSeamlessLoopOptions>
  | DraftOf<'normalise-game-sfx', NormaliseGameSfxOptions>
  | DraftOf<'clean-dialogue', CleanDialogueOptions>
  | DraftOf<'export-for-godot', GodotDraft>;

const CHOSEN: DraftSource = { kind: 'chosen' };

/** `fields` with `field` set to `value`, as the person chose it. */
export function withChosen<O, F extends keyof O>(
  fields: DraftFields<O>,
  field: F,
  value: O[F],
): DraftFields<O> {
  return { ...fields, [field]: { value, source: CHOSEN } };
}

function cutDraft(state: ProjectState, targets: readonly WorkflowTarget[]): DraftFields<CutDraft> {
  const offered = CUT_INTO_SOUNDS.defaults(state, targets);
  return {
    destination: {
      value: { kind: 'group', group: offered.group.value },
      source: offered.group.source,
    },
    naming: { value: offered.naming.value.source, source: offered.naming.source },
    threshold: offered.threshold,
    shortestPause: offered.shortestPause,
    leadInMilliseconds: offered.leadInMilliseconds,
    tailMilliseconds: offered.tailMilliseconds,
  };
}

function godotDraft(
  state: ProjectState,
  targets: readonly WorkflowTarget[],
): DraftFields<GodotDraft> {
  const offered = EXPORT_FOR_GODOT.defaults(state, targets);
  return {
    format: offered.format,
    naming: { value: offered.naming.value.source, source: offered.naming.source },
    destinationRoot: {
      value: offered.destinationRoot.value.join('/'),
      source: offered.destinationRoot.source,
    },
  };
}

/** The draft of the workflow keyed `key` over `targets` in `state`, every option at its default. */
export function workflowDraft(
  key: WorkflowKey,
  state: ProjectState,
  targets: readonly WorkflowTarget[],
): WorkflowDraft {
  switch (key) {
    case 'cut-into-sounds':
      return { key, fields: cutDraft(state, targets) };
    case 'prepare-one-shot':
      return { key, fields: PREPARE_ONE_SHOT.defaults(state, targets) };
    case 'create-seamless-loop':
      return { key, fields: CREATE_SEAMLESS_LOOP.defaults(state, targets) };
    case 'normalise-game-sfx':
      return { key, fields: NORMALISE_GAME_SFX.defaults(state, targets) };
    case 'clean-dialogue':
      return { key, fields: CLEAN_DIALOGUE.defaults(state, targets) };
    case 'export-for-godot':
      return { key, fields: godotDraft(state, targets) };
  }
}

/** `field` as the person left it where they chose it, and otherwise as `offered` offers it now. */
function keptIfChosen<T>(current: DraftField<T>, offered: DraftField<T>): DraftField<T> {
  return current.source.kind === 'chosen' ? current : offered;
}

/**
 * `draft` for new targets: an option the person chose is kept, and one they
 * did not is offered again as the new targets give it. Only Cut Into Sounds
 * takes defaults from its targets, the group they are in and its naming.
 */
export function draftForTargets(
  draft: WorkflowDraft,
  state: ProjectState,
  targets: readonly WorkflowTarget[],
): WorkflowDraft {
  if (draft.key !== 'cut-into-sounds') return draft;
  const offered = cutDraft(state, targets);
  const { fields } = draft;
  return {
    key: draft.key,
    fields: {
      ...fields,
      destination: keptIfChosen(fields.destination, offered.destination),
      naming: keptIfChosen(fields.naming, offered.naming),
    },
  };
}
