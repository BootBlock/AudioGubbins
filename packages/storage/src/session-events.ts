/**
 * Making the journal events of an open project's richer operations, and the
 * project each leaves: a change the command bus applied, a snapshot of the
 * current state, and an A/B comparison with what differs between its sides
 * (REQ-STOR-193 to REQ-STOR-196).
 *
 * Each is made here from the project as it is and applied through the same
 * functions replay uses (`project-model.ts`); the session only adopts what
 * comes back and writes the event. Identifiers and times come from the
 * injected generator and clock, so a test makes the same events every run.
 */

import type { AppliedExecution } from '@audiogubbins/commands';
import { fail, flatMapResult, mapResult, type DomainResult } from '@audiogubbins/domain';
import {
  affectedBy,
  changeNodeOf,
  comparedDifference,
  comparisonSide,
  differenceNames,
  startComparison,
  type Comparison,
  type ComparisonSource,
  type History,
} from '@audiogubbins/history';
import {
  historyLabelFrom,
  type ProjectState,
  type StateFingerprint,
} from '@audiogubbins/project-format';
import { PRODUCT_VERSION } from '@audiogubbins/version';

import { choiceOf } from './comparison-record.js';
import { stateAt, type MoveServices } from './history-moves.js';
import type { JournalEvent } from './journal-events.js';
import { withChange, withEvent, type ProjectModel, type SettledEvent } from './project-model.js';
import type { ComparedStates, SessionServices, SnapshotRequest } from './session-contracts.js';
import { notRecordable } from './session-failures.js';

/** An event made, and the project once it is applied. */
export interface Made<TEvent extends JournalEvent = JournalEvent> {
  readonly event: TEvent;
  readonly model: ProjectModel;
}

/** A state made along the way that the history now keeps. */
export interface KeptState {
  readonly fingerprint: StateFingerprint;
  readonly state: ProjectState;
}

/**
 * The change node for what the bus applied, recorded at the cursor, and the
 * state it made where that is far enough from the nearest kept one to be kept.
 */
export async function changeMade(
  model: ProjectModel,
  applied: AppliedExecution<ProjectState>,
  services: SessionServices,
  keepStateEvery: number,
): Promise<DomainResult<Made & { readonly kept?: KeptState }>> {
  if (applied.entry === undefined) return fail(notRecordable());
  const next = applied.next;
  const fingerprint = dueForKeeping(model.history, keepStateEvery)
    ? await services.files.states.fingerprint(next)
    : undefined;
  const node = changeNodeOf(model.history, {
    id: services.ids.next<'HistoryNodeId'>(),
    at: services.clock.now(),
    entry: applied.entry,
    affects: affectedBy(model.state, next),
    ...(fingerprint === undefined ? {} : { stateFingerprint: fingerprint }),
  });
  return mapResult(withChange(model, node, next), (changed) => ({
    event: { kind: 'change', node },
    model: changed,
    ...(fingerprint === undefined ? {} : { kept: { fingerprint, state: next } }),
  }));
}

/**
 * Whether a change recorded at the cursor would be `every` changes or more
 * from the nearest node whose state is kept.
 */
function dueForKeeping(history: History, every: number): boolean {
  let node = history.nodes.get(history.cursor);
  for (let steps = 1; node !== undefined; steps += 1) {
    if (node.stateFingerprint !== undefined) return false;
    if (steps >= every) return true;
    node =
      node.kind === 'change' && node.parent !== undefined
        ? history.nodes.get(node.parent)
        : undefined;
  }
  return false;
}

/** A named snapshot of the current state, which records the exports made from it. */
export async function snapshotMade(
  model: ProjectModel,
  request: SnapshotRequest,
  services: SessionServices,
): Promise<DomainResult<Made<SettledEvent> & { readonly kept: KeptState }>> {
  const name = historyLabelFrom(request.name);
  if (!name.ok) return name;
  const { state, history, exports } = model;
  const fingerprint = await services.files.states.fingerprint(state);
  const event: SettledEvent = {
    kind: 'snapshot-created',
    snapshot: {
      id: services.ids.next<'SnapshotId'>(),
      kind: request.kind ?? 'named',
      name: name.value,
      ...(request.notes === undefined ? {} : { notes: request.notes }),
      at: services.clock.now(),
      ...(request.author === undefined ? {} : { author: request.author }),
      application: `AudioGubbins ${PRODUCT_VERSION}`,
      node: history.cursor,
      stateFingerprint: fingerprint,
      exports: exports
        .filter((record) => record.stateFingerprint === fingerprint)
        .map((record) => record.id),
    },
  };
  return mapResult(withEvent(model, event), (next) => ({
    event,
    model: next,
    kept: { fingerprint, state },
  }));
}

/** A comparison of two states, listening to `a`, and what differs between them. */
export async function comparisonMade(
  model: ProjectModel,
  a: ComparisonSource,
  b: ComparisonSource,
  moves: MoveServices,
): Promise<DomainResult<Made<SettledEvent> & { readonly compared: ComparedStates }>> {
  const { history } = model;
  const started = flatMapResult(comparisonSide(history, a), (sideA) =>
    flatMapResult(comparisonSide(history, b), (sideB) => startComparison(sideA, sideB)),
  );
  if (!started.ok) return started;
  const compared = await comparedStates(model, started.value, moves);
  if (!compared.ok) return compared;
  const event: SettledEvent = { kind: 'comparison', choice: choiceOf(started.value) };
  return mapResult(withEvent(model, event), (next) => ({
    event,
    model: next,
    compared: compared.value,
  }));
}

/**
 * What differs between the sides of `comparison` in `model`, each side's state
 * reached as a move would reach it, without moving.
 */
export async function comparedStates(
  model: ProjectModel,
  comparison: Comparison,
  moves: MoveServices,
): Promise<DomainResult<ComparedStates>> {
  const { history, state } = model;
  const stateA = await stateAt(history, state, comparison.a.node, moves);
  if (!stateA.ok) return stateA;
  const stateB = await stateAt(history, state, comparison.b.node, moves);
  if (!stateB.ok) return stateB;
  return mapResult(comparedDifference(comparison, stateA.value, stateB.value), (difference) => ({
    a: comparison.a.node,
    b: comparison.b.node,
    difference,
    names: differenceNames(stateA.value, stateB.value, difference),
  }));
}
