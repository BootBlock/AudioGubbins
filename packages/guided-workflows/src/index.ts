/**
 * The public contract of @audiogubbins/guided-workflows (ADR-0105).
 *
 * The guided workflows as deterministic planners: Cut Into Sounds, Prepare
 * One-Shot, Create Seamless Loop, Normalise Game SFX, Clean Dialogue and
 * Export for Godot. Each states its options with their defaults, the analyses
 * it needs run first in the detection worker, and how it turns its targets,
 * members or groups, into a plan of the project's ordinary command
 * invocations: one item per target, planned, skipped or refused, each item
 * tried through the project's own commands as it is planned. The application
 * runs a plan as one history step, all or nothing, and only with no item
 * refused; an export a plan names follows that step as its own action.
 *
 * Nothing here dispatches, reads audio or a clock, or knows the interface.
 */

export {
  type AnalysisNeed,
  type GuidedWorkflow,
  type NoAnalyses,
  type OptionSource,
  type WorkflowInput,
  type WorkflowKey,
  type WorkflowOption,
  type WorkflowOptions,
  type WorkflowTarget,
} from './guided-workflow.js';
export {
  type WorkflowDispatch,
  type WorkflowItem,
  type WorkflowItemTarget,
  type WorkflowPlan,
  itemKey,
  workflowDispatch,
} from './workflow-plan.js';
export { targetMembers } from './workflow-subjects.js';
export { type AssistantAnalyses, type AssistantAnalysis } from './assistant-analyses.js';
export { type Placement } from './processing-placement.js';

export { CUT_INTO_SOUNDS, type CutIntoSoundsOptions } from './cut-into-sounds.js';
export { PREPARE_ONE_SHOT, type PrepareOneShotOptions } from './prepare-one-shot.js';
export {
  CREATE_SEAMLESS_LOOP,
  type CreateSeamlessLoopOptions,
  type LoopAnalyses,
  type LoopAnswer,
  type LoopChoice,
} from './create-seamless-loop.js';
export { NORMALISE_GAME_SFX, type NormaliseGameSfxOptions } from './normalise-game-sfx.js';
export {
  CLEAN_DIALOGUE,
  type CleanDialogueAnalyses,
  type CleanDialogueOptions,
} from './clean-dialogue.js';
export {
  EXPORT_FOR_GODOT,
  type ExportForGodotOptions,
  type GodotFormat,
} from './export-for-godot.js';
