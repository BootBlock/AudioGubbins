/**
 * What a guided workflow is (ADR-0105): a planner, not a mode or an executor.
 *
 * A workflow states its key and label, the options it asks for with the
 * default of each and where that default came from, the analyses it needs run
 * first in the detection worker, and how it turns a subject, its options, the
 * project and those analyses into a plan of ordinary project-command
 * invocations. It reads no audio, clock or global and dispatches nothing: the
 * application shows the plan's items and runs its invocations as one history
 * step. The same input gives the same plan.
 */

import type {
  DetectorValues,
  DomainResult,
  IdGenerator,
  ProcessorCatalogue,
} from '@audiogubbins/domain';
import type { GameAssetGroupId, GroupMember, PolicySource } from '@audiogubbins/game-audio';
import type { ExportClock } from '@audiogubbins/import-export';
import type { LoopAnalysisRequest } from '@audiogubbins/loop-analysis';
import type { ProjectState } from '@audiogubbins/project-format';

import type { WorkflowItemTarget, WorkflowPlan } from './workflow-plan.js';

/** What a workflow is run over: a member, or a group's members, its subgroups' too where asked. */
export type WorkflowTarget =
  | GroupMember
  | { readonly kind: 'group'; readonly group: GameAssetGroupId; readonly subgroups: boolean };

export type WorkflowKey =
  | 'cut-into-sounds'
  | 'prepare-one-shot'
  | 'create-seamless-loop'
  | 'normalise-game-sfx'
  | 'clean-dialogue'
  | 'export-for-godot';

/** Where an option's default came from, which the dialog shows beside it. */
export type OptionSource =
  /** The workflow's own default. */
  | { readonly kind: 'workflow' }
  /** The targets themselves, such as the one group they are all in. */
  | { readonly kind: 'targets' }
  /** A group's policy, resolved with its source. */
  | { readonly kind: 'policy'; readonly source: PolicySource };

export interface WorkflowOption<T> {
  readonly value: T;
  readonly source: OptionSource;
}

/** Each option with its default and where that default came from. */
export type WorkflowOptions<Options> = {
  readonly [K in keyof Options]-?: WorkflowOption<Options[K]>;
};

/** An analysis a workflow needs run before it plans, in the detection worker. */
export type AnalysisNeed =
  | {
      readonly kind: 'assistants';
      readonly target: GroupMember;
      /** The assistants' keys, in the order their reports are answered. */
      readonly assistants: readonly string[];
      readonly detectors: DetectorValues;
    }
  | { readonly kind: 'loop'; readonly target: GroupMember; readonly request: LoopAnalysisRequest };

/** What a workflow that needs no analysis is given: nothing. */
export type NoAnalyses = undefined;

export interface WorkflowInput<Options, Analyses> {
  readonly state: ProjectState;
  readonly targets: readonly WorkflowTarget[];
  readonly options: Options;
  /** What the needs `analysesFor` stated answered, for the targets and options as they are now. */
  readonly analyses: Analyses;
  readonly catalogue: ProcessorCatalogue;
  /** Every identifier the plan mints, in the order it plans: the same generator, the same plan. */
  readonly ids: IdGenerator;
  /** When the workflow runs, which naming's `{date}` reads. */
  readonly clock: ExportClock;
  /** Items the person chose to leave out after a plan refused them, each skipped as left out. */
  readonly leftOut?: readonly WorkflowItemTarget[];
}

export interface GuidedWorkflow<Options, Analyses> {
  readonly key: WorkflowKey;
  /** The British-English name the interface shows. */
  readonly label: string;

  /** The options with their defaults for these targets, each with where its default came from. */
  defaults(state: ProjectState, targets: readonly WorkflowTarget[]): WorkflowOptions<Options>;

  /** The analyses to run first, in the detection worker. */
  analysesFor(
    state: ProjectState,
    targets: readonly WorkflowTarget[],
    options: Options,
  ): readonly AnalysisNeed[];

  /** The plan, or why none can be made at all; a target that cannot be planned is refused in it. */
  plan(input: WorkflowInput<Options, Analyses>): DomainResult<WorkflowPlan>;
}
