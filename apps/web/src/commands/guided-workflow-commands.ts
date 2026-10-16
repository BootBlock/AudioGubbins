/**
 * The commands of a guided workflow's open dialog (ADR-0105, REQ-GAME-075):
 * analysing what the workflow needs, leaving refused items out, applying the
 * plan and closing; with those that open each dialog
 * (`workflow-opening-commands.ts`).
 *
 * Applying runs the plan the dialog shows as one group of the project's own
 * commands, one history step one undo reverses, all or nothing, and only once
 * no item is refused (`workflowDispatch`). What it makes is ordinary regions,
 * edits, chains, loops, policy and export settings, which the Inspector, the
 * History panel and the rack show and change. An export the plan names
 * follows the step as its own action, never inside it, since an export is
 * never undone (ADR-0092); the dialog offers it once the step has applied.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import {
  workflowDispatch,
  type WorkflowDispatch,
  type WorkflowPlan,
} from '@audiogubbins/guided-workflows';
import { counted } from '@audiogubbins/text';

import { sayWhenSettled } from './project-access.js';
import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';
import { WorkflowCommand } from './workflow-command-ids.js';
import { dialogParts, openParts, readingOf, type OpenParts } from './workflow-dialog-parts.js';
import { workflowOpeningCommands } from './workflow-opening-commands.js';
import { refusedTargets } from './workflow-planning.js';

/** Available while a workflow's dialog is open and being set up, for `why` it can do something now. */
function whileSetting(
  context: ShellContext,
  why: (parts: OpenParts) => string | undefined,
): CommandAvailability {
  const parts = openParts(context);
  if (typeof parts === 'string') return unavailable(parts);
  if (parts.open.step.kind !== 'setting') return unavailable('The workflow has run.');
  return availableUnless(why(parts));
}

/** Why the open dialog has nothing to analyse now, or `undefined` where it has. */
function nothingToAnalyse(context: ShellContext, parts: OpenParts): string | undefined {
  if (context.workflowAnalysis.get().kind === 'running') return 'The analyses are running.';
  const { needs } = readingOf(context, parts);
  if (!needs.ok) return needs.failures[0].summary;
  if (needs.value.length === 0) return 'This workflow needs no analysis.';
  return needs.value.some((status) => status.kind === 'to-analyse')
    ? undefined
    : 'Every sound is analysed as it is now.';
}

function analyseCommand(): Command<ShellContext> {
  return shellCommand(
    WorkflowCommand.Analyse,
    'Analyse for the workflow',
    CommandCategory.Tools,
    (context) => {
      const parts = openParts(context);
      if (typeof parts === 'string') return parts;
      const problem = nothingToAnalyse(context, parts);
      if (problem !== undefined) return problem;
      const { needs } = readingOf(context, parts);
      const jobs = needs.ok
        ? needs.value.flatMap((status) => (status.kind === 'to-analyse' ? [status.job] : []))
        : [];
      context.workflowAnalysis.run(jobs);
      context.interaction.announce(`Analysing ${counted(jobs.length, 'sound', 'sounds')}.`);
      return undefined;
    },
    {
      availability: (context) => whileSetting(context, (parts) => nothingToAnalyse(context, parts)),
      keywords: ['workflow', 'analyse', 'analysis'],
      description:
        'Runs the analyses the open workflow needs, one sound after another, of each sound not analysed as it is now.',
    },
  );
}

function cancelAnalysisCommand(): Command<ShellContext> {
  return shellCommand(
    WorkflowCommand.CancelAnalysis,
    'Stop analysing for the workflow',
    CommandCategory.Tools,
    (context) => {
      if (!context.workflowAnalysis.cancel()) return 'The workflow’s analyses are not running.';
      context.interaction.announce('Stopped analysing for the workflow.');
      return undefined;
    },
    {
      availability: (context) =>
        context.workflowAnalysis.get().kind === 'running'
          ? AVAILABLE
          : unavailable('The workflow’s analyses are not running.'),
      keywords: ['workflow', 'stop', 'cancel', 'analysis'],
    },
  );
}

/** The open dialog's plan, or why it has none. */
function planOf(context: ShellContext, parts: OpenParts): WorkflowPlan | string {
  const { plan } = readingOf(context, parts);
  return plan.ok ? plan.value : plan.failures[0].summary;
}

function leaveOutCommand(): Command<ShellContext> {
  const why = (context: ShellContext, parts: OpenParts): string | undefined => {
    const plan = planOf(context, parts);
    if (typeof plan === 'string') return plan;
    return refusedTargets(plan).length === 0 ? 'No item is refused.' : undefined;
  };
  return shellCommand(
    WorkflowCommand.LeaveOutRefused,
    'Leave the refused items out',
    CommandCategory.Tools,
    (context) => {
      const parts = openParts(context);
      if (typeof parts === 'string') return parts;
      const plan = planOf(context, parts);
      if (typeof plan === 'string') return plan;
      const refused = refusedTargets(plan);
      if (refused.length === 0) return 'No item is refused.';
      parts.store.leaveOut(refused);
      context.interaction.announce(
        `Left ${counted(refused.length, 'item', 'items')} out; the rest is planned again.`,
      );
      return undefined;
    },
    {
      availability: (context) => whileSetting(context, (parts) => why(context, parts)),
      keywords: ['workflow', 'leave out', 'skip', 'refused'],
    },
  );
}

/** What is said once a plan's step has applied. */
function appliedWords(plan: WorkflowPlan): string {
  const planned = plan.items.filter((item) => item.kind === 'planned').length;
  const skipped = plan.items.length - planned;
  const rest = skipped === 0 ? '' : `, ${counted(skipped, 'item', 'items')} skipped`;
  return `${plan.description}: ${counted(planned, 'item', 'items')} changed${rest}. One undo reverses it.`;
}

/** A plan that may run, and what it runs. */
interface Ready {
  readonly plan: WorkflowPlan;
  readonly dispatch: Extract<WorkflowDispatch, { readonly kind: 'ready' }>;
}

/** Why the open dialog's plan cannot run, or what it runs. */
function runnable(context: ShellContext, parts: OpenParts): Ready | string {
  const plan = planOf(context, parts);
  if (typeof plan === 'string') return plan;
  const dispatch = workflowDispatch(plan);
  switch (dispatch.kind) {
    case 'blocked':
      return `${counted(dispatch.refused.length, 'item is', 'items are')} refused. Leave them out to run the rest, or close the workflow.`;
    case 'nothing':
      return 'Every item is done already or left out, so there is nothing to run.';
    case 'ready':
      return { plan, dispatch };
  }
}

/** Why the open dialog's plan cannot be applied now, or what it applies. */
function applicable(context: ShellContext, parts: OpenParts): Ready | string {
  return context.workflowAnalysis.get().kind === 'running'
    ? 'Wait for the analyses to finish, or stop them.'
    : runnable(context, parts);
}

/**
 * Runs `plan` as the one step `dispatch` names, the dialog applying until it
 * settles, and says what it came to.
 */
function dispatched(
  context: ShellContext,
  parts: OpenParts,
  { plan, dispatch }: Ready,
): string | undefined {
  const { store, session } = parts;
  if (!store.applying()) return 'The workflow has run.';
  const work = session.runGroup(dispatch.description, dispatch.invocations);
  const applied = {
    kind: 'applied',
    description: plan.description,
    exportAfter: plan.exportAfter ?? [],
    measureAfter: plan.measureAfter ?? [],
  } as const;
  work.then(
    (result) => {
      store.settled(result.ok && result.value.kind === 'applied' ? applied : undefined);
    },
    () => {
      store.settled(undefined);
    },
  );
  sayWhenSettled(context, work, (outcome) =>
    outcome.kind === 'applied' ? appliedWords(plan) : outcome.reason,
  );
  return undefined;
}

function applyCommand(): Command<ShellContext> {
  return shellCommand(
    WorkflowCommand.Apply,
    'Apply the workflow',
    CommandCategory.Tools,
    (context) => {
      const parts = openParts(context);
      if (typeof parts === 'string') return parts;
      const ready = applicable(context, parts);
      return typeof ready === 'string' ? ready : dispatched(context, parts, ready);
    },
    {
      availability: (context) =>
        whileSetting(context, (parts) => {
          const ready = applicable(context, parts);
          return typeof ready === 'string' ? ready : undefined;
        }),
      keywords: ['workflow', 'apply', 'run'],
      description:
        'Runs every planned item of the open workflow as one step of the history, which one undo reverses.',
    },
  );
}

function closeCommand(): Command<ShellContext> {
  return shellCommand(
    WorkflowCommand.Close,
    'Close the workflow',
    CommandCategory.Tools,
    (context) => {
      const parts = dialogParts(context);
      if (typeof parts === 'string') return parts;
      context.workflowAnalysis.cancel();
      if (!parts.store.close()) return 'No workflow is open.';
      return undefined;
    },
    {
      availability: (context) => {
        const parts = openParts(context);
        return availableUnless(typeof parts === 'string' ? parts : undefined);
      },
      keywords: ['workflow', 'close', 'cancel'],
    },
  );
}

/** The guided workflows' commands (see the module comment). */
export function guidedWorkflowCommands(): readonly Command<ShellContext>[] {
  return [
    ...workflowOpeningCommands(),
    analyseCommand(),
    cancelAnalysisCommand(),
    leaveOutCommand(),
    applyCommand(),
    closeCommand(),
  ];
}
