/**
 * The plan of a guided workflow's open dialog (ADR-0105): the options as the
 * person set them, read into the planner's; the analyses its planner needs,
 * with what the session holds of each; and the planner's plan of the project
 * as it is now, from the answers that are current, with the items the person
 * left out skipped.
 *
 * Cut Into Sounds may put the sounds in a group the project does not have
 * yet, which the step adds first (`workflow-group-path.ts`).
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { namingTemplate } from '@audiogubbins/game-audio';
import {
  CLEAN_DIALOGUE,
  CREATE_SEAMLESS_LOOP,
  CUT_INTO_SOUNDS,
  EXPORT_FOR_GODOT,
  NORMALISE_GAME_SFX,
  PREPARE_ONE_SHOT,
  type AnalysisNeed,
  type CutIntoSoundsOptions,
  type ExportForGodotOptions,
  type WorkflowInput,
  type WorkflowItemTarget,
  type WorkflowPlan,
  type WorkflowTarget,
} from '@audiogubbins/guided-workflows';
import type { ExportClock } from '@audiogubbins/import-export';
import type { GameAssetGroupId } from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';

import { exportClockAt } from '../export/page-export.js';
import type { OpenWorkflowDialog } from '../state/workflow-draft-store.js';
import type { CutDraft, DraftFields, GodotDraft, WorkflowDraft } from '../state/workflow-drafts.js';
import {
  assistantAnswers,
  denoisingModel,
  loopAnswers,
  needStatuses,
  type NeedStatus,
} from './workflow-analyses.js';
import type { ShellContext } from './shell-context.js';
import { pathAdded, withGroupAdded } from './workflow-group-path.js';

/** The folders `text` names, `/` between them. */
function folders(text: string): readonly string[] {
  return text
    .split('/')
    .map((folder) => folder.trim())
    .filter((folder) => folder !== '');
}

/** Cut Into Sounds's options, the group a new one where the step adds it. */
function cutOptions(
  fields: DraftFields<CutDraft>,
  group: GameAssetGroupId | undefined,
): DomainResult<CutIntoSoundsOptions> {
  const template = namingTemplate(fields.naming.value);
  if (!template.ok) return template;
  return succeed({
    group,
    naming: template.value,
    threshold: fields.threshold.value,
    shortestPause: fields.shortestPause.value,
    leadInMilliseconds: fields.leadInMilliseconds.value,
    tailMilliseconds: fields.tailMilliseconds.value,
  });
}

function godotOptions(fields: DraftFields<GodotDraft>): DomainResult<ExportForGodotOptions> {
  const template = namingTemplate(fields.naming.value);
  if (!template.ok) return template;
  return succeed({
    format: fields.format.value,
    naming: template.value,
    destinationRoot: folders(fields.destinationRoot.value),
  });
}

/** The analyses the draft's workflow needs over `targets` in `state`, or why its options cannot be read. */
function workflowNeeds(
  draft: WorkflowDraft,
  state: ProjectState,
  targets: readonly WorkflowTarget[],
): DomainResult<readonly AnalysisNeed[]> {
  switch (draft.key) {
    case 'cut-into-sounds': {
      const { destination } = draft.fields;
      const group = destination.value.kind === 'group' ? destination.value.group : undefined;
      const options = cutOptions(draft.fields, group);
      return options.ok
        ? succeed(CUT_INTO_SOUNDS.analysesFor(state, targets, options.value))
        : options;
    }
    case 'prepare-one-shot':
      return succeed(PREPARE_ONE_SHOT.analysesFor(state, targets, valuesOf(draft.fields)));
    case 'create-seamless-loop':
      return succeed(
        CREATE_SEAMLESS_LOOP.analysesFor(state, targets, {
          search: draft.fields.search.value,
          choices: draft.fields.choices.value,
          endAtLoopEnd: draft.fields.endAtLoopEnd.value,
        }),
      );
    case 'clean-dialogue':
      return succeed(
        CLEAN_DIALOGUE.analysesFor(state, targets, { placement: draft.fields.placement.value }),
      );
    case 'normalise-game-sfx':
    case 'export-for-godot':
      return succeed([]);
  }
}

/** Prepare One-Shot's options as the draft holds them. */
function valuesOf(fields: Extract<WorkflowDraft, { readonly key: 'prepare-one-shot' }>['fields']) {
  return {
    threshold: fields.threshold.value,
    leadInMilliseconds: fields.leadInMilliseconds.value,
    tailMilliseconds: fields.tailMilliseconds.value,
    fadeInMilliseconds: fields.fadeInMilliseconds.value,
    fadeInShape: fields.fadeInShape.value,
    fadeOutMilliseconds: fields.fadeOutMilliseconds.value,
    fadeOutShape: fields.fadeOutShape.value,
    peakDbtp: fields.peakDbtp.value,
    placement: fields.placement.value,
  };
}

/** What every planner is given besides the options and the analyses. */
type Common = Omit<WorkflowInput<unknown, unknown>, 'options' | 'analyses'>;

function cutPlan(
  fields: DraftFields<CutDraft>,
  common: Common,
  statuses: readonly NeedStatus[],
): DomainResult<WorkflowPlan> {
  const { destination } = fields;
  if (destination.value.kind === 'group') {
    const options = cutOptions(fields, destination.value.group);
    if (!options.ok) return options;
    return CUT_INTO_SOUNDS.plan({
      ...common,
      options: options.value,
      analyses: assistantAnswers(statuses),
    });
  }
  const added = pathAdded(common.state, destination.value.path, common.ids);
  if (!added.ok) return added;
  const options = cutOptions(fields, added.value.group);
  if (!options.ok) return options;
  const plan = CUT_INTO_SOUNDS.plan({
    ...common,
    state: added.value.state,
    options: options.value,
    analyses: assistantAnswers(statuses),
  });
  return plan.ok ? succeed(withGroupAdded(plan.value, added.value)) : plan;
}

/** The plan of `draft` over `common`'s targets, from the answers among `statuses`. */
function planOf(
  context: ShellContext,
  draft: WorkflowDraft,
  common: Common,
  statuses: readonly NeedStatus[],
): DomainResult<WorkflowPlan> {
  switch (draft.key) {
    case 'cut-into-sounds':
      return cutPlan(draft.fields, common, statuses);
    case 'prepare-one-shot':
      return PREPARE_ONE_SHOT.plan({
        ...common,
        options: valuesOf(draft.fields),
        analyses: assistantAnswers(statuses),
      });
    case 'create-seamless-loop':
      return CREATE_SEAMLESS_LOOP.plan({
        ...common,
        options: {
          search: draft.fields.search.value,
          choices: draft.fields.choices.value,
          endAtLoopEnd: draft.fields.endAtLoopEnd.value,
        },
        analyses: loopAnswers(statuses),
      });
    case 'normalise-game-sfx':
      return NORMALISE_GAME_SFX.plan({
        ...common,
        options: {
          loudness: draft.fields.loudness.value,
          placement: draft.fields.placement.value,
        },
        analyses: undefined,
      });
    case 'clean-dialogue':
      return CLEAN_DIALOGUE.plan({
        ...common,
        options: { placement: draft.fields.placement.value },
        analyses: {
          assistants: assistantAnswers(statuses),
          denoisingModel: denoisingModel(context.packs.availability.get()),
        },
      });
    case 'export-for-godot': {
      const options = godotOptions(draft.fields);
      if (!options.ok) return options;
      return EXPORT_FOR_GODOT.plan({ ...common, options: options.value, analyses: undefined });
    }
  }
}

/** What the open dialog's workflow needs analysed, with what the session holds of each, and its plan. */
export interface WorkflowReading {
  /** Each need with what the session holds of it, or why the options cannot be read to say. */
  readonly needs: DomainResult<readonly NeedStatus[]>;
  /** The plan, or every reason none can be made yet. */
  readonly plan: DomainResult<WorkflowPlan>;
}

/**
 * The open dialog's reading of the project as `state` holds it: its needs and
 * its plan, the plan kept by the dialog's store while nothing it is made from
 * changes (`WorkflowDraftStore.planned`), so the plan run is the plan shown.
 */
export function readWorkflow(
  context: ShellContext,
  open: OpenWorkflowDialog,
  state: ProjectState,
  planned: (
    inputs: readonly unknown[],
    plan: () => DomainResult<WorkflowPlan>,
  ) => DomainResult<WorkflowPlan>,
): WorkflowReading {
  const { draft, targets, leftOut } = open;
  const asked = workflowNeeds(draft, state, targets);
  const needs = asked.ok ? succeed(needStatuses(context, state, asked.value)) : asked;
  const inputs = [
    draft,
    targets,
    leftOut,
    state,
    context.detection.get(),
    context.loopAnalysis.analyses.get(),
    context.packs.availability.get(),
    context.assets.get(),
    context.audioSettings.get().renderQuality,
  ];
  const plan = planned(inputs, () => {
    if (!needs.ok) return needs;
    const common: Common = {
      state,
      targets,
      catalogue: PROCESSOR_CATALOGUE,
      ids: context.ids,
      clock: clockOf(context),
      leftOut,
    };
    return planOf(context, draft, common, needs.value);
  });
  return { needs, plan };
}

function clockOf(context: ShellContext): ExportClock {
  return exportClockAt(context.clock.now());
}

/** The targets of the items a plan refused, which "Leave these out" leaves out. */
export function refusedTargets(plan: WorkflowPlan): readonly WorkflowItemTarget[] {
  return plan.items.flatMap((item) => (item.kind === 'refused' ? [item.target] : []));
}
