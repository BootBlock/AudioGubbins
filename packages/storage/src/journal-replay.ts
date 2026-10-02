/**
 * Applying one journal record to a project being rebuilt (REQ-STOR-101).
 *
 * A change is made again through the command layer from its forward
 * invocations, and where its node recorded the fingerprint of the state it
 * made, the state made again must have that fingerprint, or the journal no
 * longer describes this project and replay stops there. A move reaches its node
 * as a session's move does. Every other event is applied by the same function a
 * session applied it with (`project-model.ts`).
 */

import type { CommandBus } from '@audiogubbins/commands';
import type { Logger } from '@audiogubbins/diagnostics';
import { fail, mapResult, succeed, type DomainResult } from '@audiogubbins/domain';
import type { ProjectState, StateFingerprint } from '@audiogubbins/project-format';

import { arriveAt, replayInvocations, type KeptStates } from './history-moves.js';
import type { JournalEvent } from './journal-events.js';
import type { ProjectFiles } from './project-files.js';
import { withChange, withEvent, withMove, type ProjectModel } from './project-model.js';
import { replayDiverged } from './storage-failures.js';

/** What replaying a project's records needs and gathers. */
export interface ReplayContext {
  readonly files: ProjectFiles;
  readonly bus: CommandBus<ProjectState>;
  readonly logger: Logger;

  /** The states storage holds whole that the history keeps. */
  readonly kept: ReadonlySet<StateFingerprint>;

  /** States the history keeps that are held only in memory, gathered as replay makes them. */
  readonly unwritten: Map<StateFingerprint, ProjectState>;
}

/**
 * The states a move may start from: those storage holds, and those held only in
 * memory so far, which need no reading.
 */
export function keptStatesOf(
  files: ProjectFiles,
  kept: ReadonlySet<StateFingerprint>,
  unwritten: ReadonlyMap<StateFingerprint, ProjectState>,
): KeptStates {
  return {
    isKept: (state) => kept.has(state) || unwritten.has(state),
    load: async (state, signal) => {
      const held = unwritten.get(state);
      return held === undefined ? await files.states.get(state, signal) : succeed(held);
    },
  };
}

/** The model with one replayed record applied. */
export async function replayEvent(
  model: ProjectModel,
  event: JournalEvent,
  context: ReplayContext,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectModel>> {
  switch (event.kind) {
    case 'change': {
      const next = replayInvocations(context.bus, model.state, event.node.forward);
      if (!next.ok) return next;
      const recorded = event.node.stateFingerprint;
      if (recorded !== undefined) {
        if ((await context.files.states.fingerprint(next.value)) !== recorded)
          return fail(replayDiverged());
        if (!context.kept.has(recorded)) context.unwritten.set(recorded, next.value);
      }
      return withChange(model, event.node, next.value);
    }
    case 'move': {
      const arrival = await arriveAt(
        model.history,
        model.state,
        event.to,
        {
          bus: context.bus,
          logger: context.logger,
          states: keptStatesOf(context.files, context.kept, context.unwritten),
        },
        signal,
      );
      return mapResult(arrival, ({ history, state }) => withMove(model, history, state));
    }
    default:
      return withEvent(model, event);
  }
}
