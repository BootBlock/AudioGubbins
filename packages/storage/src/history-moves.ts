/**
 * Reaching the state at a node of a project's history: replaying invocations
 * through the command layer, and choosing between the way from the cursor and
 * the way from a state kept whole (REQ-STOR-021, REQ-STOR-193).
 *
 * The history plans every move and says which states are kept; this module
 * carries a plan out. Going to a node reverses the changes from the cursor up
 * to the nodes' common ancestor and replays those down to the target, unless a
 * state kept at or above the target is nearer in changes, in which case the
 * target is rebuilt from that state. Both ways give the same state, because
 * every command is deterministic over its arguments, so the choice is one of
 * speed alone. A kept state that cannot be read is logged and passed over for
 * the way from the cursor, never trusted.
 */

import type { CommandBus, CommandInvocation } from '@audiogubbins/commands';
import type { Logger } from '@audiogubbins/diagnostics';
import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  moveTo,
  pathBetween,
  restorationOf,
  type History,
  type HistoryPath,
  type Navigation,
} from '@audiogubbins/history';
import type { HistoryNodeId, ProjectState, StateFingerprint } from '@audiogubbins/project-format';

import { replayRefused } from './storage-failures.js';

/** The states a move may start from, and how to read one. */
export interface KeptStates {
  /** Whether the state of this fingerprint is kept whole. */
  isKept(fingerprint: StateFingerprint): boolean;

  /** The state of this fingerprint, read and checked. */
  load(fingerprint: StateFingerprint, signal?: AbortSignal): Promise<DomainResult<ProjectState>>;
}

/** What reaching a node needs. */
export interface MoveServices {
  readonly bus: CommandBus<ProjectState>;
  readonly states: KeptStates;
  readonly logger: Logger;
}

/**
 * The state after running each invocation in turn from `state`. Refused where
 * the command layer refuses one: a stored change it will not make again means
 * the history no longer describes this project.
 */
export function replayInvocations(
  bus: CommandBus<ProjectState>,
  state: ProjectState,
  invocations: Iterable<CommandInvocation>,
): DomainResult<ProjectState> {
  let current = state;
  for (const invocation of invocations) {
    const result = bus.execute(current, invocation);
    if (result.kind === 'refused') return fail(replayRefused(result.failures[0]));
    // Unchanged is accepted: the state already holds what the invocation asks,
    // which is what replaying it is for.
    if (result.kind === 'applied') current = result.next;
  }
  return succeed(current);
}

/** The state at `target` of a history whose cursor's state is `state`. */
export async function stateAt(
  history: History,
  state: ProjectState,
  target: HistoryNodeId,
  services: MoveServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectState>> {
  if (target === history.cursor) return succeed(state);
  const planned = pathBetween(history, history.cursor, target);
  if (!planned.ok) return planned;
  return await stateAlong(history, state, target, planned.value, services, signal);
}

/**
 * The state at `target`, `path` from the cursor, by the way with fewer changes
 * to replay. The way from a kept state is looked for only as far up as it
 * could be the shorter, so a short move never climbs the history.
 */
async function stateAlong(
  history: History,
  state: ProjectState,
  target: HistoryNodeId,
  path: HistoryPath,
  services: MoveServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectState>> {
  const length = path.undo.length + path.redo.length;
  const restoration = restorationOf(
    history,
    target,
    (kept) => services.states.isKept(kept),
    length - 1,
  );
  if (restoration.ok) {
    const base = await services.states.load(restoration.value.baseState, signal);
    if (base.ok) {
      return replayInvocations(
        services.bus,
        base.value,
        restoration.value.redo.flatMap((node) => node.forward),
      );
    }
    services.logger.warning('A kept state could not be read, so a move replays from the cursor.', {
      code: base.failures[0].code,
    });
  }
  return replayInvocations(services.bus, state, [
    ...path.undo.flatMap((node) => node.inverse),
    ...path.redo.flatMap((node) => node.forward),
  ]);
}

/** Where a move arrives: the history with its cursor at the target, and the state there. */
export interface Arrival {
  readonly history: History;
  readonly state: ProjectState;
}

/** A move of the cursor to `target`, and the state it arrives at. */
export async function arriveAt(
  history: History,
  state: ProjectState,
  target: HistoryNodeId,
  services: MoveServices,
  signal?: AbortSignal,
): Promise<DomainResult<Arrival>> {
  const moved = moveTo(history, target);
  if (!moved.ok) return moved;
  return await arriveBy(history, state, moved.value, services, signal);
}

/**
 * A move the history planned, such as the promotion of a side of a
 * comparison, and the state it arrives at.
 */
export async function arriveBy(
  history: History,
  state: ProjectState,
  navigation: Navigation,
  services: MoveServices,
  signal?: AbortSignal,
): Promise<DomainResult<Arrival>> {
  const target = navigation.history.cursor;
  if (target === history.cursor) return succeed({ history: navigation.history, state });
  const reached = await stateAlong(history, state, target, navigation.path, services, signal);
  return reached.ok ? succeed({ history: navigation.history, state: reached.value }) : reached;
}
