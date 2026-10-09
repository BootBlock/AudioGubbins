/**
 * Stand-ins for the project commands a finished recording runs (ADR-0072),
 * for this package's tests: creating a take stack, adding a take to one, and
 * punching in with a new punch stack, each undoable through an inverse
 * invocation and carrying its values as the project commands do, as JSON in
 * one argument. They check only what the storage's tests rely on; the take
 * commands' own rules are tested with the commands.
 */

import {
  CommandCategory,
  commandId,
  refusal,
  type Command,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import {
  unsafeBrandId,
  type Asset,
  type EditOperation,
  type Take,
  type TakeStack,
} from '@audiogubbins/domain';
import {
  NESTED_ARGUMENT_LIMITS,
  canonicalJson,
  parseJson,
  readEditOperation,
  readTake,
  readTakeStack,
  startReading,
  writeEditOperation,
  writeTake,
  writeTakeStack,
  type Converter,
  type ProjectState,
} from '@audiogubbins/project-format';

import type { RecordingCommands } from '../recording-takes.js';

const CREATE_STACK = commandId('test.create-stack');
const REMOVE_STACK = commandId('test.remove-stack');
const ADD_TAKE = commandId('test.add-take');
const WITHDRAW_TAKE = commandId('test.withdraw-take');
const ADD_PUNCH = commandId('test.add-punch');
const REMOVE_PUNCH = commandId('test.remove-punch');

function command(
  id: CommandInvocation['commandId'],
  run: Command<ProjectState>['run'],
): Command<ProjectState> {
  return {
    id,
    label: id,
    category: CommandCategory.Edit,
    undoable: true,
    availability: () => ({ available: true }),
    run,
  };
}

/** The value argument `name` carries as JSON, read by `read`. */
function nested<TValue>(
  invocation: CommandInvocation,
  name: string,
  read: Converter<TValue>,
): TValue | undefined {
  const text = invocation.arguments?.[name];
  const parsed = typeof text === 'string' ? parseJson(text, NESTED_ARGUMENT_LIMITS) : undefined;
  if (parsed?.ok !== true) return undefined;
  const reading = startReading();
  const outcome = reading.outcome(read(reading, parsed.value, '', name));
  return outcome.ok ? outcome.value : undefined;
}

function idOf(invocation: CommandInvocation, name: string): string | undefined {
  const value = invocation.arguments?.[name];
  return typeof value === 'string' ? value : undefined;
}

function withStacks(state: ProjectState, stacks: ProjectState['project']['takeStacks']) {
  return { ...state, project: { ...state.project, takeStacks: stacks } };
}

function createStack(stack: TakeStack): CommandInvocation {
  return { commandId: CREATE_STACK, arguments: { stack: canonicalJson(writeTakeStack(stack)) } };
}

function addTake(stack: Pick<TakeStack, 'id'>, take: Take, choose: boolean): CommandInvocation {
  return {
    commandId: ADD_TAKE,
    arguments: { stackId: stack.id, take: canonicalJson(writeTake(take)), choose },
  };
}

function addPunch(
  asset: Pick<Asset, 'id'>,
  operation: EditOperation,
  stack: TakeStack,
): CommandInvocation {
  return {
    commandId: ADD_PUNCH,
    arguments: {
      assetId: asset.id,
      operation: canonicalJson(writeEditOperation(operation)),
      stack: canonicalJson(writeTakeStack(stack)),
    },
  };
}

function createStackCommand(): Command<ProjectState> {
  return command(CREATE_STACK, (state, invocation): CommandOutcome<ProjectState> => {
    const stack = nested(invocation, 'stack', readTakeStack);
    if (stack === undefined) return refusal('test.stack', 'A stack is needed.');
    if (state.project.takeStacks.has(stack.id)) return refusal('test.stack-taken', 'Taken.');
    return {
      kind: 'applied',
      next: withStacks(state, new Map(state.project.takeStacks).set(stack.id, stack)),
      inverse: { commandId: REMOVE_STACK, arguments: { stackId: stack.id } },
      description: 'Create a stack',
    };
  });
}

function removeStackCommand(): Command<ProjectState> {
  return command(REMOVE_STACK, (state, invocation): CommandOutcome<ProjectState> => {
    const id = unsafeBrandId<'TakeStackId'>(idOf(invocation, 'stackId') ?? '');
    const stack = state.project.takeStacks.get(id);
    if (stack === undefined) return refusal('test.stack-missing', 'No such stack.');
    const stacks = new Map(state.project.takeStacks);
    stacks.delete(id);
    return {
      kind: 'applied',
      next: withStacks(state, stacks),
      inverse: createStack(stack),
      description: 'Remove a stack',
    };
  });
}

function addTakeCommand(): Command<ProjectState> {
  return command(ADD_TAKE, (state, invocation): CommandOutcome<ProjectState> => {
    const stack = state.project.takeStacks.get(
      unsafeBrandId<'TakeStackId'>(idOf(invocation, 'stackId') ?? ''),
    );
    const take = nested(invocation, 'take', readTake);
    if (stack === undefined || take === undefined) {
      return refusal('test.take', 'A stack the project has and a take are needed.');
    }
    const chosen = invocation.arguments?.['choose'] === true ? take.id : stack.chosen;
    const next: TakeStack = {
      ...stack,
      takes: [...stack.takes, take],
      ...(chosen === undefined ? {} : { chosen }),
    };
    return {
      kind: 'applied',
      next: withStacks(state, new Map(state.project.takeStacks).set(stack.id, next)),
      inverse: {
        commandId: WITHDRAW_TAKE,
        arguments: { stack: canonicalJson(writeTakeStack(stack)) },
      },
      description: 'Add a take',
    };
  });
}

function withdrawTakeCommand(): Command<ProjectState> {
  return command(WITHDRAW_TAKE, (state, invocation): CommandOutcome<ProjectState> => {
    const before = nested(invocation, 'stack', readTakeStack);
    const now = before === undefined ? undefined : state.project.takeStacks.get(before.id);
    const take = now?.takes.at(-1);
    if (before === undefined || now === undefined || take === undefined) {
      return refusal('test.take', 'No take to withdraw.');
    }
    return {
      kind: 'applied',
      next: withStacks(state, new Map(state.project.takeStacks).set(before.id, before)),
      inverse: addTake(before, take, now.chosen === take.id),
      description: 'Withdraw a take',
    };
  });
}

function addPunchCommand(): Command<ProjectState> {
  return command(ADD_PUNCH, (state, invocation): CommandOutcome<ProjectState> => {
    const asset = state.project.assets.get(
      unsafeBrandId<'AssetId'>(idOf(invocation, 'assetId') ?? ''),
    );
    const operation = nested(invocation, 'operation', readEditOperation);
    const stack = nested(invocation, 'stack', readTakeStack);
    if (asset === undefined || operation === undefined || stack === undefined) {
      return refusal('test.punch', 'An asset, a punch edit and its stack are needed.');
    }
    const edited = { ...asset, edits: [...asset.edits, operation] };
    return {
      kind: 'applied',
      next: {
        ...state,
        project: {
          ...state.project,
          assets: new Map(state.project.assets).set(asset.id, edited),
          takeStacks: new Map(state.project.takeStacks).set(stack.id, stack),
        },
      },
      inverse: { commandId: REMOVE_PUNCH, arguments: { assetId: asset.id, stackId: stack.id } },
      description: 'Punch in',
    };
  });
}

function removePunchCommand(): Command<ProjectState> {
  return command(REMOVE_PUNCH, (state, invocation): CommandOutcome<ProjectState> => {
    const asset = state.project.assets.get(
      unsafeBrandId<'AssetId'>(idOf(invocation, 'assetId') ?? ''),
    );
    const stack = state.project.takeStacks.get(
      unsafeBrandId<'TakeStackId'>(idOf(invocation, 'stackId') ?? ''),
    );
    const operation = asset?.edits.at(-1);
    if (asset === undefined || stack === undefined || operation === undefined) {
      return refusal('test.punch', 'No punch to withdraw.');
    }
    const stacks = new Map(state.project.takeStacks);
    stacks.delete(stack.id);
    const withdrawn = { ...asset, edits: asset.edits.slice(0, -1) };
    return {
      kind: 'applied',
      next: {
        ...state,
        project: {
          ...state.project,
          assets: new Map(state.project.assets).set(asset.id, withdrawn),
          takeStacks: stacks,
        },
      },
      inverse: addPunch(asset, operation, stack),
      description: 'Withdraw a punch',
    };
  });
}

/** The stand-in take commands, to register on a test bus. */
export function takeCommands(): readonly Command<ProjectState>[] {
  return [
    createStackCommand(),
    removeStackCommand(),
    addTakeCommand(),
    withdrawTakeCommand(),
    addPunchCommand(),
    removePunchCommand(),
  ];
}

/** The invocations a finished recording is made with, over the stand-ins. */
export function testRecordingCommands(addAsset: RecordingCommands['addAsset']): RecordingCommands {
  return { addAsset, createStack, addTake, addPunch };
}
