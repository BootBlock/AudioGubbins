/**
 * The updates an open project is sent to the page as: everything it opens
 * with, then after each change what differs from the project last sent
 * (ADR-0022).
 *
 * The models a session publishes share whatever a change did not touch, so a
 * member the same object as the one last sent is unchanged, and is left out.
 * The history is sent as its delta from the history last sent, which skips
 * every subtree the two share. A project opens with its whole history, which
 * is cut into slices of a bounded number of entries, so the page reads and
 * applies a long history a slice at a time, each in a task of its own, rather
 * than the whole of it in one.
 */

import { historyDelta, type Comparison, type HistoryDelta } from '@audiogubbins/history';
import type { ProjectModel, ProjectSnapshot } from '@audiogubbins/storage';

import type {
  ComparisonUpdate,
  FirstUpdate,
  ProjectUpdate,
} from '../protocol/project-operations.js';

/** The update a project opens with: all of it. */
export function firstUpdate(snapshot: ProjectSnapshot): FirstUpdate {
  const { model, save, access } = snapshot;
  const { comparison } = model;
  return {
    save,
    access,
    history: historyDelta(undefined, model.history),
    state: model.state,
    exports: model.exports,
    retention: model.retention,
    backup: model.backup,
    ...(comparison === undefined ? {} : { comparison: comparisonUpdate(comparison) }),
  };
}

/** The update from the project last sent, `sent`, to `snapshot`. */
export function updateSince(sent: ProjectModel, snapshot: ProjectSnapshot): ProjectUpdate {
  const { model, save, access } = snapshot;
  const { state, exports, retention, backup, comparison } = model;
  return {
    save,
    access,
    history: historyDelta(sent.history, model.history),
    ...(state === sent.state ? {} : { state }),
    ...(exports === sent.exports ? {} : { exports }),
    ...(retention === sent.retention ? {} : { retention }),
    ...(backup === sent.backup ? {} : { backup }),
    ...(comparison === sent.comparison ? {} : { comparison: comparisonUpdate(comparison) }),
  };
}

/**
 * At most how many entries of each of a history's maps one slice of it
 * carries: measured at 16,000 changes, the page reads and applies a slice of
 * this many in about as long as a frame lasts.
 */
export const SLICE_ENTRIES = 1_000;

/** The entries of `items`, in runs of `size`. */
function runsOf<TItem>(items: readonly TItem[], size: number): (readonly TItem[])[] {
  const runs: (readonly TItem[])[] = [];
  for (let at = 0; at < items.length; at += size) runs.push(items.slice(at, at + size));
  return runs;
}

/**
 * `delta` cut into slices of at most `size` entries of each map, which applied
 * in order make the history `delta` makes. The first carries the removals and
 * the branch names and snapshots it has, every slice the root and the cursor.
 */
export function historySlices(delta: HistoryDelta, size = SLICE_ENTRIES): HistoryDelta[] {
  const { project, root, cursor, branchNames, snapshots } = delta;
  const nodes = runsOf(delta.nodes.set, size);
  const children = runsOf(delta.children.set, size);
  const preferred = runsOf(delta.preferred.set, size);
  const count = Math.max(1, nodes.length, children.length, preferred.length);
  return Array.from({ length: count }, (_unused, index) => {
    const first = index === 0;
    return {
      project,
      root,
      cursor,
      nodes: { set: nodes[index] ?? [], removed: first ? delta.nodes.removed : [] },
      children: { set: children[index] ?? [], removed: first ? delta.children.removed : [] },
      preferred: { set: preferred[index] ?? [], removed: first ? delta.preferred.removed : [] },
      ...(first && branchNames !== undefined ? { branchNames } : {}),
      ...(first && snapshots !== undefined ? { snapshots } : {}),
    };
  });
}

function comparisonUpdate(comparison: Comparison | undefined): ComparisonUpdate {
  return comparison === undefined ? { kind: 'closed' } : { kind: 'open', comparison };
}
