/**
 * What a history keeps alive in storage: the states its nodes and snapshots
 * name, and, for each piece of media, which parts of the history retain it
 * (REQ-STOR-193, REQ-STOR-200).
 *
 * The storage layer keeps a state or a media object while anything retains it,
 * and branching never copies media, so one object may be retained by the
 * current state, by earlier states on the active line, by snapshots, or only by
 * an alternative branch. Saying which is what lets the Storage panel put each
 * object's bytes in the right category, and say what a compaction would free.
 */

import type {
  ContentId,
  HistoryNodeId,
  SnapshotId,
  StateFingerprint,
} from '@audiogubbins/project-format';

import type { History, HistoryNode } from './history.js';
import { activeLine } from './lines.js';

/** Every state fingerprint the history's nodes and snapshots name. */
export function retainedStates(history: History): ReadonlySet<StateFingerprint> {
  const states = new Set<StateFingerprint>();
  for (const node of history.nodes.values()) {
    if (node.stateFingerprint !== undefined) states.add(node.stateFingerprint);
  }
  for (const snapshot of history.snapshots.values()) states.add(snapshot.stateFingerprint);
  return states;
}

/** Which parts of a history retain one piece of media. */
export interface ContentRetention {
  /** The nodes that retain it, in the order the history holds them. */
  readonly nodes: readonly HistoryNodeId[];

  /** Whether the state the project is in holds it. */
  readonly inCurrentState: boolean;

  /** Whether any node of the active line retains it. */
  readonly onActiveLine: boolean;

  /** The snapshots whose node retains it. */
  readonly snapshots: readonly SnapshotId[];
}

/**
 * Which parts of the history retain each piece of media. `contentOf` says what
 * a node retains: the media its state holds and any its invocations name, which
 * only the storage layer can read.
 */
export function contentRetention(
  history: History,
  contentOf: (node: HistoryNode) => Iterable<ContentId>,
): ReadonlyMap<ContentId, ContentRetention> {
  const line = new Set(activeLine(history).map((node) => node.id));
  const snapshotsAt = new Map<HistoryNodeId, SnapshotId[]>();
  for (const snapshot of history.snapshots.values()) {
    const held = snapshotsAt.get(snapshot.node);
    if (held === undefined) snapshotsAt.set(snapshot.node, [snapshot.id]);
    else held.push(snapshot.id);
  }

  const retention = new Map<
    ContentId,
    {
      nodes: HistoryNodeId[];
      inCurrentState: boolean;
      onActiveLine: boolean;
      snapshots: SnapshotId[];
    }
  >();
  for (const node of history.nodes.values()) {
    for (const content of new Set(contentOf(node))) {
      let entry = retention.get(content);
      if (entry === undefined) {
        entry = { nodes: [], inCurrentState: false, onActiveLine: false, snapshots: [] };
        retention.set(content, entry);
      }
      entry.nodes.push(node.id);
      entry.inCurrentState ||= node.id === history.cursor;
      entry.onActiveLine ||= line.has(node.id);
      entry.snapshots.push(...(snapshotsAt.get(node.id) ?? []));
    }
  }
  return retention;
}
