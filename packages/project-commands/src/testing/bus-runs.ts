/**
 * Running the project commands through a real command bus in a test, and
 * reading what each run gave: the state, the history entry, or the code of a
 * refusal or of nothing changed. A state is valid when it reads back through
 * the project document as itself, which the format's reader alone decides.
 */

import {
  createCommandBus,
  createCommandRegistry,
  type AppliedExecution,
  type CommandBus,
  type CommandInvocation,
  type ExecutionResult,
  type HistoryEntry,
} from '@audiogubbins/commands';
import {
  canonicalJson,
  readProjectDocument,
  writeProjectDocument,
  type ProjectState,
} from '@audiogubbins/project-format';

import { TEST_CATALOGUE } from '@audiogubbins/domain/testing';
import { projectCommands } from '../project-commands.js';

/** The compact canonical text of a state's document: equal states, equal text. */
export function canonicalTextOf(state: ProjectState): string {
  return canonicalJson(writeProjectDocument(state));
}

/**
 * Throws unless the state reads back through the project document as itself:
 * the format's reader is the authority on what a valid state is.
 */
export function assertReadsBack(state: ProjectState): void {
  const read = readProjectDocument(writeProjectDocument(state));
  if (!read.ok) {
    const codes = read.failures.map(
      (problem) => `${problem.code} ${String(problem.details?.['at'])}`,
    );
    throw new Error(`The state does not read back: ${codes.join('; ')}`);
  }
  if (canonicalTextOf(read.value) !== canonicalTextOf(state)) {
    throw new Error('The state read back as another state.');
  }
}

/** The logger the command bus takes, as the bus declares it. */
type BusLogger = Parameters<typeof createCommandBus>[1];

/** A bus running the project commands, with a logger that keeps nothing. */
export function projectBus(): CommandBus<ProjectState> {
  const registry = createCommandRegistry<ProjectState>();
  for (const command of projectCommands(TEST_CATALOGUE)) registry.register(command);
  return createCommandBus(registry, silentLogger());
}

function silentLogger(): BusLogger {
  const logger: BusLogger = {
    category: 'project-commands',
    error: () => undefined,
    warning: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    measured: () => undefined,
    forOperation: () => logger,
  };
  return logger;
}

/** Runs each invocation in turn through the bus and gives the state reached. */
export function runAll(
  bus: CommandBus<ProjectState>,
  start: ProjectState,
  invocations: readonly CommandInvocation[],
): ProjectState {
  let state = start;
  for (const invocation of invocations) {
    const result = bus.execute(state, invocation);
    if (result.kind === 'applied') state = result.next;
  }
  return state;
}

/** The applied execution, or a thrown error naming what happened instead. */
export function appliedOf(result: ExecutionResult<ProjectState>): AppliedExecution<ProjectState> {
  if (result.kind === 'applied') return result;
  const why =
    result.kind === 'refused' ? result.failures.map((problem) => problem.code) : [result.code];
  throw new Error(`Expected the command to apply; it was ${result.kind}: ${why.join(', ')}.`);
}

/** The history entry an applied execution recorded. */
export function entryOf(result: ExecutionResult<ProjectState>): HistoryEntry {
  const { entry } = appliedOf(result);
  if (entry === undefined) throw new Error('The command applied without a history entry.');
  return entry;
}

/** The code of the refusal, or a thrown error naming what happened instead. */
export function refusalCodeOf(result: ExecutionResult<ProjectState>): string {
  if (result.kind !== 'refused') throw new Error(`Expected a refusal; it was ${result.kind}.`);
  return result.failures[0].code;
}

/** The code of an unchanged outcome, or a thrown error naming what happened instead. */
export function unchangedCodeOf(result: ExecutionResult<ProjectState>): string {
  if (result.kind !== 'unchanged') throw new Error(`Expected no change; it was ${result.kind}.`);
  return result.code;
}
