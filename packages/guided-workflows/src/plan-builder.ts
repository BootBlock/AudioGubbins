/**
 * How a workflow's items are planned in turn (ADR-0105): each against the
 * project as the items before it leave it, and each tried through the
 * project's own commands before it is planned.
 *
 * Trying an item is what makes its outcome exact. Its invocations run as one
 * group of a command bus over the project's commands, on a value of the state
 * the planner holds and nobody else sees: where a command refuses, the item
 * is refused with the command's own failures, so the dialog shows what the
 * step would refuse before the person runs it; where it applies, the next
 * item is planned against the state it made, so a group's chain changed by
 * one item is the chain the next item extends. Nothing is dispatched: the
 * plan's invocations are run by the application, as one step, from the state
 * the plan was made from, and reach the state the trials reached.
 */

import {
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { DomainFailure, ProcessorCatalogue } from '@audiogubbins/domain';
import type { GroupMember } from '@audiogubbins/game-audio';
import { projectCommands } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';

import {
  itemKey,
  type WorkflowItem,
  type WorkflowItemTarget,
  type WorkflowPlan,
} from './workflow-plan.js';

/** The logger the command bus takes, as the bus declares it. */
type BusLogger = Parameters<typeof createCommandBus>[1];

/**
 * The trials' logger, which records nothing: a trial is planning, and its
 * refusals become the plan's refused items, which the dialog shows; the step
 * the application runs is logged by its own bus.
 */
const TRIAL_LOGGER: BusLogger = {
  category: 'guided-workflows',
  error: () => undefined,
  warning: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  measured: () => undefined,
  forOperation: () => TRIAL_LOGGER,
};

/** One bus for each catalogue the planners are given, made once. */
const BUSES = new WeakMap<ProcessorCatalogue, CommandBus<ProjectState>>();

function busFor(catalogue: ProcessorCatalogue): CommandBus<ProjectState> {
  const known = BUSES.get(catalogue);
  if (known !== undefined) return known;
  const registry = createCommandRegistry<ProjectState>();
  for (const command of projectCommands(catalogue)) registry.register(command);
  const bus = createCommandBus(registry, TRIAL_LOGGER);
  BUSES.set(catalogue, bus);
  return bus;
}

/** Why an item was left out. */
const LEFT_OUT = 'Left out of this run.';

export class PlanBuilder {
  readonly #bus: CommandBus<ProjectState>;
  readonly #leftOut: ReadonlySet<string>;
  readonly #items: WorkflowItem[] = [];
  readonly #invocations: CommandInvocation[] = [];
  readonly #answered = new Set<string>();
  #state: ProjectState;

  constructor(
    state: ProjectState,
    catalogue: ProcessorCatalogue,
    leftOut: readonly WorkflowItemTarget[] = [],
  ) {
    this.#bus = busFor(catalogue);
    this.#state = state;
    this.#leftOut = new Set(leftOut.map(itemKey));
  }

  /** The project as the items planned so far leave it. */
  get state(): ProjectState {
    return this.#state;
  }

  /** Whether `target` has an item already, which a target reached twice is not given again. */
  answered(target: WorkflowItemTarget): boolean {
    return this.#answered.has(itemKey(target));
  }

  /**
   * Whether `target` is to be planned: not answered yet, and not left out,
   * which is answered here as skipped.
   */
  takes(target: WorkflowItemTarget): boolean {
    if (this.answered(target)) return false;
    if (!this.#leftOut.has(itemKey(target))) return true;
    this.skip(target, LEFT_OUT);
    return false;
  }

  skip(target: WorkflowItemTarget, reason: string): void {
    this.#answer({ kind: 'skipped', target, reason });
  }

  refuse(target: WorkflowItemTarget, failures: readonly [DomainFailure, ...DomainFailure[]]): void {
    this.#answer({ kind: 'refused', target, failures });
  }

  /**
   * Tries `invocations` as one step on the state as planned so far: planned
   * with `changes` where it applies, refused with the commands' failures
   * where one refuses, and skipped as `already` where none is given or none
   * changes anything.
   */
  attempt(
    target: WorkflowItemTarget,
    changes: readonly string[],
    invocations: readonly CommandInvocation[],
    already: string,
  ): void {
    const [first, ...rest] = invocations;
    if (first === undefined) {
      this.skip(target, already);
      return;
    }
    const tried = this.#bus.executeGroup(this.#state, changes.join(' '), [first, ...rest]);
    if (tried.kind === 'refused') {
      this.refuse(target, tried.failures);
      return;
    }
    if (tried.kind === 'unchanged') {
      this.skip(target, already);
      return;
    }
    this.#state = tried.next;
    this.#invocations.push(first, ...rest);
    this.#answer({ kind: 'planned', target, changes });
  }

  /** Whether `target`'s item was refused. */
  refused(target: WorkflowItemTarget): boolean {
    const key = itemKey(target);
    return this.#items.some((item) => item.kind === 'refused' && itemKey(item.target) === key);
  }

  /** The plan of the items answered, in order. */
  plan(
    description: string,
    after: {
      readonly exportAfter?: readonly GroupMember[];
      readonly measureAfter?: readonly GroupMember[];
    } = {},
  ): WorkflowPlan {
    return {
      description,
      invocations: [...this.#invocations],
      items: [...this.#items],
      ...after,
    };
  }

  #answer(item: WorkflowItem): void {
    this.#answered.add(itemKey(item.target));
    this.#items.push(item);
  }
}
