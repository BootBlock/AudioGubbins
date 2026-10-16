/**
 * The groups of a path Cut Into Sounds puts its sounds in that the project
 * does not have yet (ADR-0105): added first, in the workflow's own step, so
 * one undo takes the sounds and their group away together. The planner plans
 * against the project with those groups added, which the project's own
 * command makes on a value of the state nobody else sees.
 */

import {
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type IdGenerator,
} from '@audiogubbins/domain';
import { pathText, type GameAssetGroup, type GameAssetGroupId } from '@audiogubbins/game-audio';
import type { WorkflowPlan } from '@audiogubbins/guided-workflows';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { addGroupInvocation, projectCommands } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

/** The logger the command bus takes, as the bus declares it. */
type BusLogger = Parameters<typeof createCommandBus>[1];

/**
 * The trial's logger, which records nothing: adding a path's groups on a value
 * of the state is planning, and a refusal is the plan's, which the dialog
 * shows; the step that runs is logged by the project's own bus.
 */
const TRIAL_LOGGER: BusLogger = {
  category: 'workflows',
  error: () => undefined,
  warning: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  measured: () => undefined,
  forOperation: () => TRIAL_LOGGER,
};

/** The project's commands over this build's processors, which a path's groups are tried by. */
const TRIAL_BUS: CommandBus<ProjectState> = (() => {
  const registry = createCommandRegistry<ProjectState>();
  for (const command of projectCommands(PROCESSOR_CATALOGUE)) registry.register(command);
  return createCommandBus(registry, TRIAL_LOGGER);
})();

function rejected(code: string, summary: string): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary));
}

/** The groups of `path` the project lacks, added: the invocations, the state they make and the last group. */
export interface PathAdded {
  readonly invocations: readonly CommandInvocation[];
  readonly state: ProjectState;
  readonly group: GameAssetGroupId;
  /** The path as the groups are called, for what the plan says of it. */
  readonly words: string;
}

/** The groups of `path`, `/` between their names, that `state` lacks, added in turn with identifiers from `ids`. */
export function pathAdded(
  state: ProjectState,
  path: string,
  ids: IdGenerator,
): DomainResult<PathAdded> {
  const names = path.split('/').map((name) => name.trim());
  if (names.length === 0 || names.some((name) => name === '')) {
    return rejected(
      'workflow.group-path-empty',
      'Name the new group, with a / between a group and the one inside it.',
    );
  }
  const groups = [...(state.gameAudio?.groups.values() ?? [])];
  const invocations: CommandInvocation[] = [];
  let parent: GameAssetGroupId | undefined;
  for (const name of names) {
    const found = groups.find((group) => group.name === name && group.parent === parent);
    if (found !== undefined) {
      parent = found.id;
      continue;
    }
    const added: GameAssetGroup = {
      id: ids.next<'GameAssetGroupId'>(),
      name,
      ...(parent === undefined ? {} : { parent }),
      policy: {},
    };
    groups.push(added);
    invocations.push(addGroupInvocation(added));
    parent = added.id;
  }
  if (parent === undefined) return rejected('workflow.group-path-empty', 'Name the new group.');
  const [first, ...rest] = invocations;
  if (first === undefined) {
    return succeed({ invocations, state, group: parent, words: pathText(names) });
  }
  const tried = TRIAL_BUS.executeGroup(state, 'Add the group', [first, ...rest]);
  if (tried.kind === 'refused') return fail(...tried.failures);
  if (tried.kind === 'unchanged') return rejected(tried.code, tried.reason);
  return succeed({ invocations, state: tried.next, group: parent, words: pathText(names) });
}

/** `plan` with the groups `added` made first, as an item of the group's own. */
export function withGroupAdded(plan: WorkflowPlan, added: PathAdded): WorkflowPlan {
  if (added.invocations.length === 0) return plan;
  return {
    ...plan,
    invocations: [...added.invocations, ...plan.invocations],
    items: [
      {
        kind: 'planned',
        target: added.group,
        changes: [`Add the group ${quoted(added.words)}.`],
      },
      ...plan.items,
    ],
  };
}
