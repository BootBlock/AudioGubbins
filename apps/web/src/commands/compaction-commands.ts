/**
 * Letting history go: planning a compaction or a retention policy, carrying a
 * plan out once the person has seen it, and putting one away (REQ-STOR-055,
 * REQ-STOR-106, REQ-STOR-200).
 *
 * Planning removes nothing, so it is its own command: the History panel and the
 * settings show the plan, with the bytes it frees and every undo, branch and
 * export state it takes away, and only then does the person confirm it. The
 * storage checks the confirmation against the plan it was shown, so a plan that
 * went stale is refused rather than carried out.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { RetentionPolicy } from '@audiogubbins/project-format';
import { counted } from '@audiogubbins/text';

import { describeBytes } from '../wording.js';
import { idArgument, sayWhenSettled, sessionAvailability } from './project-access.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The retention policy the arguments describe, or why they describe none. */
function retentionFrom(invocation: CommandInvocation): RetentionPolicy | string {
  const kind = textArgument(invocation, 'kind');
  if (kind === 'unlimited') return { kind: 'unlimited' };
  const value = invocation.arguments?.['value'];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return 'Give a whole number above nought for how much history to keep.';
  }
  switch (kind) {
    case 'budget':
      return { kind: 'budget', bytes: value };
    case 'recent-changes':
      return { kind: 'rules', rules: [{ kind: 'recent-changes', count: value }] };
    case 'recent-days':
      return { kind: 'rules', rules: [{ kind: 'recent-days', days: value }] };
    default:
      return 'Choose how much history to keep.';
  }
}

/** What a plan would do, in a sentence. */
function planned(plan: {
  readonly removable: readonly unknown[];
  readonly reclaimableBytes: number;
}) {
  return plan.removable.length === 0
    ? 'Nothing in the history would be removed.'
    : `The plan would remove ${counted(plan.removable.length, 'point', 'points')} of the history and free ${describeBytes(plan.reclaimableBytes)}. Review it before you confirm it.`;
}

/** Available where a plan waits for the person's decision. */
function planWaiting(context: ShellContext): CommandAvailability {
  return context.projects?.review.get().compaction === undefined
    ? unavailable('No plan to remove history is waiting.')
    : AVAILABLE;
}

function planCompactionCommand(): Command<ShellContext> {
  return shellCommand(
    'history.plan-compaction',
    'Plan removing history',
    CommandCategory.Edit,
    (context, invocation) => {
      const review = context.projects?.review;
      if (review === undefined) return 'No project is open.';
      const branch = textArgument(invocation, 'branch') !== undefined;
      const node = idArgument<'HistoryNodeId'>(
        invocation,
        branch ? 'branch' : 'before',
        'point of the history',
      );
      if ('refused' in node) return node.refused;
      const work = review.planCompaction(
        branch ? { kind: 'branches', firsts: [node.id] } : { kind: 'before', node: node.id },
      );
      sayWhenSettled(context, work, planned);
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function planRetentionCommand(): Command<ShellContext> {
  return shellCommand(
    'history.plan-retention',
    'Plan how much history is kept',
    CommandCategory.Edit,
    (context, invocation) => {
      const review = context.projects?.review;
      if (review === undefined) return 'No project is open.';
      const policy = retentionFrom(invocation);
      if (typeof policy === 'string') return policy;
      sayWhenSettled(context, review.planRetention(policy), planned);
      return undefined;
    },
    { discoverable: false, availability: sessionAvailability },
  );
}

function confirmCompactionCommand(): Command<ShellContext> {
  return shellCommand(
    'history.confirm-compaction',
    'Remove the planned history',
    CommandCategory.Edit,
    (context) => {
      const review = context.projects?.review;
      const pending = review?.get().compaction;
      if (review === undefined || pending === undefined) return 'No plan is waiting.';
      const freed = describeBytes(pending.plan.reclaimableBytes);
      sayWhenSettled(context, review.confirm(), () =>
        pending.policy === undefined
          ? `The history is compacted, freeing ${freed}.`
          : 'The project keeps its history as you chose.',
      );
      return undefined;
    },
    { discoverable: false, availability: planWaiting },
  );
}

function cancelCompactionCommand(): Command<ShellContext> {
  return shellCommand(
    'history.cancel-compaction',
    'Keep the history as it is',
    CommandCategory.Edit,
    (context) => {
      context.projects?.review.cancel();
      context.interaction.announce('Nothing was removed from the history.');
    },
    { discoverable: false, availability: planWaiting },
  );
}

/** Every command that lets history go. */
export function compactionCommands(): readonly Command<ShellContext>[] {
  return [
    planCompactionCommand(),
    planRetentionCommand(),
    confirmCompactionCommand(),
    cancelCompactionCommand(),
  ];
}
