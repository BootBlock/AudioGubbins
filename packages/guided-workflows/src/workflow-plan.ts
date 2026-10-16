/**
 * A workflow's plan (ADR-0105): one item per target, planned with the
 * sentences that say what will change, skipped with the reason, or refused
 * with its failures, and the invocations of the planned items, in order, which
 * the application runs as one history step.
 *
 * Whether a plan may be dispatched is stated here once, so the dialog and the
 * command that runs it follow one rule: only with no item refused and at least
 * one invocation. A refused item blocks the step until the person leaves it
 * out, which plans again with it skipped.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import type { DomainFailure } from '@audiogubbins/domain';
import { memberKey, type GameAssetGroupId, type GroupMember } from '@audiogubbins/game-audio';

/** What an item is about: a member, or a group whose policy or chain it changes. */
export type WorkflowItemTarget = GroupMember | GameAssetGroupId;

export type WorkflowItem =
  | {
      readonly kind: 'planned';
      readonly target: WorkflowItemTarget;
      /** What will change, one sentence each, in the order the invocations make the changes. */
      readonly changes: readonly string[];
    }
  | { readonly kind: 'skipped'; readonly target: WorkflowItemTarget; readonly reason: string }
  | {
      readonly kind: 'refused';
      readonly target: WorkflowItemTarget;
      readonly failures: readonly [DomainFailure, ...DomainFailure[]];
    };

export interface WorkflowPlan {
  /** The history step's name. */
  readonly description: string;
  /** The planned items' invocations, in order. */
  readonly invocations: readonly CommandInvocation[];
  readonly items: readonly WorkflowItem[];
  /** Members whose export follows the step, as its own non-undoable action (Export for Godot). */
  readonly exportAfter?: readonly GroupMember[];
  /** Members whose loudness is measured once the step has applied, for conformance (Normalise Game SFX). */
  readonly measureAfter?: readonly GroupMember[];
}

/** Whether a plan may run, and what it runs. */
export type WorkflowDispatch =
  | {
      readonly kind: 'ready';
      readonly description: string;
      readonly invocations: readonly [CommandInvocation, ...CommandInvocation[]];
    }
  /** At least one item is refused: nothing runs until the person leaves them out. */
  | { readonly kind: 'blocked'; readonly refused: readonly WorkflowItemTarget[] }
  /** Every item is skipped: there is nothing to do. */
  | { readonly kind: 'nothing' };

/** The key an item's target is known by: equal for one member or one group. */
export function itemKey(target: WorkflowItemTarget): string {
  return typeof target === 'string' ? `group:${target}` : memberKey(target);
}

/** What `plan` runs as one step, or why it runs nothing. */
export function workflowDispatch(plan: WorkflowPlan): WorkflowDispatch {
  const refused = plan.items.filter((item) => item.kind === 'refused').map((item) => item.target);
  if (refused.length > 0) return { kind: 'blocked', refused };
  const [first, ...rest] = plan.invocations;
  return first === undefined
    ? { kind: 'nothing' }
    : { kind: 'ready', description: plan.description, invocations: [first, ...rest] };
}
