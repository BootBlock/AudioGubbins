/**
 * A guided workflow's dialog while it is open (ADR-0105): which workflow, what
 * it runs over, its options as the person sets them (`workflow-drafts.ts`),
 * the items they chose to leave out after a plan refused them, and where the
 * dialog is: setting up, applying, or applied with what follows the step.
 *
 * Ephemeral interaction state of the open project: nothing here is saved, and
 * nothing changes the project, which only the step the apply command runs
 * does. The plan shown is derived from the draft, the project and the
 * analyses, and kept for as long as none of them changes, so the step that
 * runs is the plan the person read, its identifiers included. The dialog
 * closes itself once the project it was opened in is no longer open.
 */

import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import type { GroupMember } from '@audiogubbins/game-audio';
import type {
  WorkflowItemTarget,
  WorkflowKey,
  WorkflowPlan,
  WorkflowTarget,
} from '@audiogubbins/guided-workflows';
import type { ProjectState } from '@audiogubbins/project-format';

import { observable, type Observable } from './observable.js';
import type { OpenProjectState } from './open-project-store.js';
import { draftForTargets, workflowDraft, type WorkflowDraft } from './workflow-drafts.js';

/** Where the open dialog is. */
export type WorkflowStep =
  | { readonly kind: 'setting' }
  /** The step is running in the project; nothing can be changed until it settles. */
  | { readonly kind: 'applying' }
  | {
      readonly kind: 'applied';
      /** The history step's name. */
      readonly description: string;
      /** Members whose export the person may run now, as its own action (Export for Godot). */
      readonly exportAfter: readonly GroupMember[];
      /** Members whose loudness is measured now, for conformance (Normalise Game SFX). */
      readonly measureAfter: readonly GroupMember[];
    };

/** What the dialog is opened over. */
export interface WorkflowDialogRequest {
  readonly project: ProjectId;
  readonly key: WorkflowKey;
  /** The project as it opens, which the options' defaults are read from. */
  readonly state: ProjectState;
  readonly targets: readonly WorkflowTarget[];
  /** The sound the editor in use showed as it opened, offered beside the groups as what to run over. */
  readonly sound: GroupMember | undefined;
}

/** The dialog, open. */
export interface OpenWorkflowDialog {
  readonly kind: 'open';
  readonly project: ProjectId;
  readonly draft: WorkflowDraft;
  readonly targets: readonly WorkflowTarget[];
  readonly sound: GroupMember | undefined;
  /** Items the person left out after a plan refused them. */
  readonly leftOut: readonly WorkflowItemTarget[];
  readonly step: WorkflowStep;
}

/** The dialog: shut, or open. */
export type WorkflowDialogState = { readonly kind: 'closed' } | OpenWorkflowDialog;

const CLOSED: WorkflowDialogState = { kind: 'closed' };
const SETTING: WorkflowStep = { kind: 'setting' };

/** A plan, and the inputs it was made from, each compared by identity. */
interface Planned {
  readonly inputs: readonly unknown[];
  readonly plan: DomainResult<WorkflowPlan>;
}

function sameInputs(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((input, index) => Object.is(input, right[index]))
  );
}

/** The open dialog's state (see the module comment). */
export class WorkflowDraftStore implements Observable<WorkflowDialogState> {
  readonly #state = observable<WorkflowDialogState>(CLOSED);
  #planned: Planned | undefined;

  readonly get = this.#state.get;
  readonly subscribe = this.#state.subscribe;

  /** Follows `project`, closing the dialog once the project it was opened in is no longer open. */
  constructor(project: Observable<OpenProjectState>) {
    project.subscribe(() => {
      const shown = this.#state.get();
      if (shown.kind === 'closed') return;
      const open = project.get();
      if (open.kind === 'open' && open.snapshot.project === shown.project) return;
      this.close();
    });
  }

  /** Opens the dialog over `request`, every option at its default, in place of any it showed. */
  readonly open = (request: WorkflowDialogRequest): void => {
    this.#planned = undefined;
    this.#state.set({
      kind: 'open',
      project: request.project,
      draft: workflowDraft(request.key, request.state, request.targets),
      targets: request.targets,
      sound: request.sound,
      leftOut: [],
      step: SETTING,
    });
  };

  /** Shuts the dialog; answers whether it was open. */
  readonly close = (): boolean => {
    if (this.#state.get().kind === 'closed') return false;
    this.#planned = undefined;
    this.#state.set(CLOSED);
    return true;
  };

  /**
   * Changes the options as `change` says, while the dialog is being set up; a
   * change that answers another workflow's draft is a fault in its caller,
   * and changes nothing. `change` sets each option it changes with
   * `withChosen`, so the dialog says the person chose it.
   */
  readonly edit = (change: (draft: WorkflowDraft) => WorkflowDraft): void => {
    this.#setting((open) => {
      const draft = change(open.draft);
      return draft.key === open.draft.key ? { ...open, draft } : open;
    });
  };

  /**
   * Runs the workflow over `targets` instead, with nothing left out; an option
   * the person did not choose is offered again as the new targets give it.
   */
  readonly chooseTargets = (targets: readonly WorkflowTarget[], state: ProjectState): void => {
    this.#setting((open) => ({
      ...open,
      targets,
      draft: draftForTargets(open.draft, state, targets),
      leftOut: [],
    }));
  };

  /** Leaves `targets` out of the run as well as those left out already. */
  readonly leaveOut = (targets: readonly WorkflowItemTarget[]): void => {
    this.#setting((open) => ({ ...open, leftOut: [...open.leftOut, ...targets] }));
  };

  /** Marks the step as running; answers whether the dialog was being set up, as it must be. */
  readonly applying = (): boolean => {
    const shown = this.#state.get();
    if (shown.kind !== 'open' || shown.step.kind !== 'setting') return false;
    this.#state.set({ ...shown, step: { kind: 'applying' } });
    return true;
  };

  /** Records how the running step settled: applied with what follows it, or not, back to setting up. */
  readonly settled = (
    applied: Extract<WorkflowStep, { readonly kind: 'applied' }> | undefined,
  ): void => {
    const shown = this.#state.get();
    if (shown.kind !== 'open' || shown.step.kind !== 'applying') return;
    this.#state.set({ ...shown, leftOut: [], step: applied ?? SETTING });
  };

  /**
   * The plan made from `inputs` by `plan`, made again only where an input is
   * not the one the plan kept was made from, so a plan shown is the plan run.
   */
  readonly planned = (
    inputs: readonly unknown[],
    plan: () => DomainResult<WorkflowPlan>,
  ): DomainResult<WorkflowPlan> => {
    const kept = this.#planned;
    if (kept !== undefined && sameInputs(kept.inputs, inputs)) return kept.plan;
    const made = plan();
    this.#planned = { inputs, plan: made };
    return made;
  };

  /** Replaces the open dialog as `change` says, while it is being set up. */
  #setting(change: (open: OpenWorkflowDialog) => OpenWorkflowDialog): void {
    const shown = this.#state.get();
    if (shown.kind !== 'open' || shown.step.kind !== 'setting') return;
    this.#state.set(change(shown));
  }
}
