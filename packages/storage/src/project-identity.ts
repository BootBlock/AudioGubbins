/**
 * Giving a project brought in from a bundle or a tree the identity it is kept
 * under: its own, or a new one for a copy (REQ-STOR-103, REQ-STOR-199).
 *
 * A state names its project, so a copy under a new identity changes every state
 * it keeps, and with it every state's fingerprint. The history is carried over
 * to the new fingerprints: each snapshot names its state's new one, a node
 * whose state travelled names its new one, and a node whose state did not names
 * none, which only means a move to it replays rather than loads. Nothing else
 * changes: node, snapshot and export identifiers are the project's own, and an
 * export record's fingerprint is of the state that was exported, as it was.
 */

import type { ProjectId } from '@audiogubbins/domain';
import {
  stateFingerprintOf,
  type Digest,
  type HistoryRecord,
  type ProjectState,
  type ProjectTreeContent,
  type StateFingerprint,
} from '@audiogubbins/project-format';

/** The state as a state of `project`. */
export function stateOf(state: ProjectState, project: ProjectId): ProjectState {
  return state.project.id === project
    ? state
    : { ...state, project: { ...state.project, id: project } };
}

/**
 * The history with each node's and snapshot's fingerprint carried over by
 * `renamed`, and a node's left out where its state is not among them.
 */
function historyOver(
  record: HistoryRecord,
  project: ProjectId,
  renamed: ReadonlyMap<StateFingerprint, StateFingerprint>,
): HistoryRecord {
  return {
    ...record,
    project,
    nodes: record.nodes.map((node) => {
      const { stateFingerprint, ...rest } = node;
      const carried = stateFingerprint === undefined ? undefined : renamed.get(stateFingerprint);
      return carried === undefined ? rest : { ...rest, stateFingerprint: carried };
    }),
    snapshots: record.snapshots.map((snapshot) => ({
      ...snapshot,
      stateFingerprint: renamed.get(snapshot.stateFingerprint) ?? snapshot.stateFingerprint,
    })),
  };
}

/** What a tree holds, as the project `project` holds it. */
export async function contentAs(
  content: ProjectTreeContent,
  project: ProjectId,
  digest: Digest,
): Promise<ProjectTreeContent> {
  const { scope } = content;
  const moved: ProjectTreeContent = { ...content, state: stateOf(content.state, project) };
  if (scope.kind === 'state') return moved;

  const states = new Map<StateFingerprint, ProjectState>();
  const renamed = new Map<StateFingerprint, StateFingerprint>();
  for (const [fingerprint, state] of scope.history.states) {
    const kept = stateOf(state, project);
    const carried = await stateFingerprintOf(kept, digest);
    states.set(carried, kept);
    renamed.set(fingerprint, carried);
  }
  return {
    ...moved,
    scope: {
      kind: 'history',
      history: {
        ...scope.history,
        record: historyOver(scope.history.record, project, renamed),
        states,
      },
    },
  };
}
