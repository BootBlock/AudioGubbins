/**
 * Giving a project brought in from a bundle, a tree or a backup the identity it
 * is kept under: its own, or a new one for a copy (REQ-STOR-103, REQ-STOR-199).
 *
 * A state names its project, so a copy under a new identity changes every state
 * it keeps, and with it every state's fingerprint. The history is carried over
 * to the new fingerprints: each snapshot names its state's new one, a node
 * whose state travelled names its new one, and a node whose state did not names
 * none, which only means a move to it replays rather than loads. Nothing else
 * changes: node, snapshot and export identifiers are the project's own, and an
 * export record's fingerprint is of the state that was exported, as it was.
 *
 * A history may keep more states than fit in memory (REQ-EXEC-216), and a
 * state's new fingerprint is known only once it is read, so each state is moved
 * as it is read to be written, one at a time, and the history is named after
 * the fingerprints they were written under only once they all are.
 */

import { succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';
import { historyFromRecord } from '@audiogubbins/history';
import {
  withStateFingerprints,
  type HistoryRecord,
  type ProjectState,
  type ProjectTreeHistory,
  type StateFingerprint,
  type TreeStates,
} from '@audiogubbins/project-format';

import type { ProjectContents } from './project-creation.js';

/** The state as a state of `project`. */
export function stateOf(state: ProjectState, project: ProjectId): ProjectState {
  return state.project.id === project
    ? state
    : { ...state, project: { ...state.project, id: project } };
}

/**
 * `states`, each moved to `project` as it is read: listed by the fingerprints
 * they had, and kept under those they have once moved.
 */
function statesOf(states: TreeStates, project: ProjectId): TreeStates {
  return {
    fingerprints: states.fingerprints,
    load: async (fingerprint, signal) => {
      const state = await states.load(fingerprint, signal);
      return state.ok && state.value !== undefined ? succeed(stateOf(state.value, project)) : state;
    },
  };
}

/**
 * The history of `project` with each node's and snapshot's fingerprint carried
 * over by `renamed`, and a node's left out where its state is not among them,
 * unless `renamed` changes nothing.
 */
function historyOver(
  record: HistoryRecord,
  project: ProjectId,
  renamed: ReadonlyMap<StateFingerprint, StateFingerprint>,
): HistoryRecord {
  if (record.project === project && [...renamed].every(([from, to]) => from === to)) return record;
  return { ...withStateFingerprints(record, renamed), project };
}

/**
 * What writing a tree's history as `project`'s history takes: `kept`, the
 * states it keeps, moved as each is read, and the history, accepted now as it
 * is and named after those states once they are written.
 */
export function movedHistory(
  history: ProjectTreeHistory,
  project: ProjectId,
  kept: TreeStates = history.states,
): DomainResult<Pick<ProjectContents, 'history' | 'kept'>> {
  const accepted = historyFromRecord(history.record);
  if (!accepted.ok) return accepted;
  return succeed({
    kept: statesOf(kept, project),
    history: (renamed) => {
      const record = historyOver(history.record, project, renamed);
      return record === history.record ? accepted : historyFromRecord(record);
    },
  });
}
