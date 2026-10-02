/**
 * What changed from one history to a later one of the same project, as plain
 * values, and the later history made again from the earlier and the change.
 *
 * The storage worker holds an open project's history and the page holds a copy
 * to show (ADR-0022). A structured clone keeps plain records and maps but not
 * the persistent maps' tries, and sending the whole history at every change
 * would cost the page as much as the history is long. A delta holds only the
 * entries of each persistent map that differ, found by skipping the subtrees
 * the two histories share, so a change costs one node and a path; the page's
 * copy is persistent too, and keeps every entry it was not sent. Branch names
 * and snapshots are few, and are sent whole when they changed. A delta that
 * changes nothing gives back the earlier history itself, so the copy's
 * identity changes only with what it holds, as the history it copies does.
 */

import type { ProjectId } from '@audiogubbins/domain';
import type {
  HistoryLabel,
  HistoryNodeId,
  NamedSnapshot,
  SnapshotId,
} from '@audiogubbins/project-format';

import type { History, HistoryNode } from './history.js';
import { emptyPersistentMap, type MapChanges } from './persistent-map.js';

/** What changed from one history to a later one (see the module comment). */
export interface HistoryDelta {
  readonly project: ProjectId;
  readonly root: HistoryNodeId;
  readonly cursor: HistoryNodeId;
  readonly nodes: MapChanges<HistoryNodeId, HistoryNode>;
  readonly children: MapChanges<HistoryNodeId, readonly HistoryNodeId[]>;
  readonly preferred: MapChanges<HistoryNodeId, HistoryNodeId>;

  /** The later history's branch names, where they are not the earlier one's. */
  readonly branchNames?: ReadonlyMap<HistoryNodeId, HistoryLabel>;

  /** The later history's snapshots, where they are not the earlier one's. */
  readonly snapshots?: ReadonlyMap<SnapshotId, NamedSnapshot>;
}

/** What changed from `earlier` to `later`; everything in `later` where there is no earlier. */
export function historyDelta(earlier: History | undefined, later: History): HistoryDelta {
  return {
    project: later.project,
    root: later.root,
    cursor: later.cursor,
    nodes: later.nodes.changesSince(earlier?.nodes ?? emptyPersistentMap()),
    children: later.children.changesSince(earlier?.children ?? emptyPersistentMap()),
    preferred: later.preferred.changesSince(earlier?.preferred ?? emptyPersistentMap()),
    ...(later.branchNames === earlier?.branchNames ? {} : { branchNames: later.branchNames }),
    ...(later.snapshots === earlier?.snapshots ? {} : { snapshots: later.snapshots }),
  };
}

/** Whether `delta` leaves `earlier` as it was. */
function changesNothing(earlier: History, delta: HistoryDelta): boolean {
  const unchanged = ({ set, removed }: MapChanges<string, unknown>): boolean =>
    set.length === 0 && removed.length === 0;
  return (
    delta.project === earlier.project &&
    delta.root === earlier.root &&
    delta.cursor === earlier.cursor &&
    unchanged(delta.nodes) &&
    unchanged(delta.children) &&
    unchanged(delta.preferred) &&
    delta.branchNames === undefined &&
    delta.snapshots === undefined
  );
}

/**
 * The later history `delta` was taken to, made from `earlier`, the history it
 * was taken from (`undefined` for a delta taken from no history): `earlier`
 * itself where the delta changes nothing.
 */
export function applyHistoryDelta(earlier: History | undefined, delta: HistoryDelta): History {
  if (earlier !== undefined && changesNothing(earlier, delta)) return earlier;
  return {
    project: delta.project,
    root: delta.root,
    cursor: delta.cursor,
    nodes: (earlier?.nodes ?? emptyPersistentMap()).withChanges(delta.nodes),
    children: (earlier?.children ?? emptyPersistentMap()).withChanges(delta.children),
    preferred: (earlier?.preferred ?? emptyPersistentMap()).withChanges(delta.preferred),
    branchNames: delta.branchNames ?? keptFrom(earlier).branchNames,
    snapshots: delta.snapshots ?? keptFrom(earlier).snapshots,
  };
}

/**
 * The earlier history a delta leaves a member unchanged from. A delta taken
 * from no history carries every member, so its absence is a defect.
 */
function keptFrom(earlier: History | undefined): History {
  if (earlier === undefined) {
    throw new Error('A history delta that leaves a member unchanged was applied to no history.');
  }
  return earlier;
}
