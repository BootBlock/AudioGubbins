/**
 * A project's history stored in parts, so a store writes each node once
 * (REQ-STOR-021, REQ-STOR-101, REQ-STOR-193).
 *
 * A segment holds some of a history's nodes as they were when it was written,
 * and is never changed afterwards. A segmented history holds everything else:
 * the cursor, the segments that hold its nodes, the state fingerprints learned
 * for nodes after their segments were written, the redo preferences, the branch
 * names and the snapshots. So what a store rewrites at each checkpoint grows
 * with what changes, never with every node the history holds.
 *
 * Assembling the parts refuses a segment of another project, a node two
 * segments hold, and a fingerprint for a node no segment holds or one that
 * differs from the fingerprint its segment holds, and then checks the graph
 * whole as `readHistoryRecord` does.
 */

import type { Branded, ProjectId } from '@audiogubbins/domain';

import type { JsonObject } from './canonical-json.js';
import type { StateFingerprint } from './content-identity.js';
import {
  listConverter,
  objectOf,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers, sortedBy } from './document-writing.js';
import {
  MAXIMUM_HISTORY_NODES,
  asBranchNames,
  asPreferences,
  asSnapshots,
  checkedHistoryRecord,
  nodeMap,
  readHistoryNodes,
} from './history-json.js';
import { writeHistoryNodeRecord } from './history-node-json.js';
import type {
  HistoryLabel,
  HistoryNodeId,
  HistoryNodeRecord,
  HistoryRecord,
  NamedSnapshot,
} from './history-record.js';
import { asId, asStateFingerprint, integerConverter } from './scalar-reading.js';
import { writeSnapshotRecord } from './snapshot-json.js';

/** Identifies one segment of a history. */
export type HistorySegmentId = Branded<'HistorySegmentId'>;

/**
 * The most an epoch a segment is filed under can be: twelve decimal digits, the
 * widest number a store names a file by.
 */
const LARGEST_SEGMENT_EPOCH = 999_999_999_999;

/**
 * Where a segment is: its identifier, and the epoch of the write lease it was
 * written under, which a store files it by so a writer that lost the project
 * never removes another's segments.
 */
export interface HistorySegmentReference {
  readonly epoch: number;
  readonly id: HistorySegmentId;
}

/** Some of a history's nodes, as they were when the segment was written. */
export interface HistorySegmentRecord {
  readonly project: ProjectId;
  readonly nodes: readonly HistoryNodeRecord[];
}

/** A history whose nodes are held by segments. */
export interface SegmentedHistoryRecord {
  readonly project: ProjectId;

  /** The node the project is at. */
  readonly cursor: HistoryNodeId;

  /** Every segment holding the history's nodes, each node in exactly one. */
  readonly segments: readonly HistorySegmentReference[];

  /** The fingerprint of each node whose segment does not hold the one it has. */
  readonly fingerprints: ReadonlyMap<HistoryNodeId, StateFingerprint>;

  /** As {@link HistoryRecord.preferred} is. */
  readonly preferred: ReadonlyMap<HistoryNodeId, HistoryNodeId>;
  readonly branchNames: ReadonlyMap<HistoryNodeId, HistoryLabel>;
  readonly snapshots: readonly NamedSnapshot[];
}

const SEGMENT_MEMBERS: ReadonlySet<string> = new Set(['project', 'nodes']);
const SEGMENTED_MEMBERS: ReadonlySet<string> = new Set([
  'project',
  'cursor',
  'segments',
  'fingerprints',
  'preferred',
  'branchNames',
  'snapshots',
]);
const REFERENCE_MEMBERS: ReadonlySet<string> = new Set(['epoch', 'id']);
const FINGERPRINT_MEMBERS: ReadonlySet<string> = new Set(['node', 'state']);

const asEpoch = integerConverter(0, LARGEST_SEGMENT_EPOCH);

/** Writes a segment, its nodes in the order given. */
export function writeHistorySegment(segment: HistorySegmentRecord): JsonObject {
  return { project: segment.project, nodes: segment.nodes.map(writeHistoryNodeRecord) };
}

/** Reads a segment, refusing one that holds a node twice. */
export const readHistorySegment: Converter<HistorySegmentRecord> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, SEGMENT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const project = required(reading, object, at, 'project', asId<'ProjectId'>);
  const read = required(reading, object, at, 'nodes', readHistoryNodes);
  if (project === undefined || read === undefined) return undefined;
  return { project, nodes: [...read.nodes.values()] };
};

/** Writes a segmented history, its segments in order and the rest sorted. */
export function writeSegmentedHistory(history: SegmentedHistoryRecord): JsonObject {
  return presentMembers({
    project: history.project,
    cursor: history.cursor,
    segments: history.segments.map(({ epoch, id }) => ({ epoch, id })),
    fingerprints: sortedBy(
      history.fingerprints,
      ([node]) => node,
      ([node, state]) => ({ node, state }),
    ),
    preferred: sortedBy(
      history.preferred,
      ([node]) => node,
      ([node, child]) => ({ node, child }),
    ),
    branchNames: sortedBy(
      history.branchNames,
      ([node]) => node,
      ([node, name]) => ({ node, name }),
    ),
    snapshots: sortedBy(history.snapshots, (snapshot) => snapshot.id, writeSnapshotRecord),
  });
}

const asReference: Converter<HistorySegmentReference> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, REFERENCE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const epoch = required(reading, object, at, 'epoch', asEpoch);
  const id = required(reading, object, at, 'id', asId<'HistorySegmentId'>);
  return epoch === undefined || id === undefined ? undefined : { epoch, id };
};

const asReferenceList = listConverter(MAXIMUM_HISTORY_NODES, asReference);

/** The segments a history names, refusing one named twice. */
const asReferences: Converter<readonly HistorySegmentReference[]> = (
  reading,
  value,
  parent,
  key,
) => {
  const references = asReferenceList(reading, value, parent, key);
  if (references === undefined) return undefined;
  if (new Set(references.map((reference) => reference.id)).size === references.length) {
    return references;
  }
  reading.refuse(
    'schema.duplicate-id',
    'Two segments have the same identifier.',
    pathOf(parent, key),
  );
  return undefined;
};

const asFingerprints: Converter<ReadonlyMap<HistoryNodeId, StateFingerprint>> = (
  reading,
  value,
  parent,
  key,
) => nodeMap(reading, value, parent, key, FINGERPRINT_MEMBERS, 'state', asStateFingerprint);

/** Reads a segmented history. Its graph is checked once its segments are read. */
export const readSegmentedHistory: Converter<SegmentedHistoryRecord> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, SEGMENTED_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const project = required(reading, object, at, 'project', asId<'ProjectId'>);
  const cursor = required(reading, object, at, 'cursor', asId<'HistoryNodeId'>);
  const segments = required(reading, object, at, 'segments', asReferences);
  const fingerprints = required(reading, object, at, 'fingerprints', asFingerprints);
  const preferred = required(reading, object, at, 'preferred', asPreferences);
  const branchNames = required(reading, object, at, 'branchNames', asBranchNames);
  const snapshots = required(reading, object, at, 'snapshots', asSnapshots);
  if (
    project === undefined ||
    cursor === undefined ||
    segments === undefined ||
    fingerprints === undefined ||
    preferred === undefined ||
    branchNames === undefined ||
    snapshots === undefined
  ) {
    return undefined;
  }
  return { project, cursor, segments, fingerprints, preferred, branchNames, snapshots };
};

/**
 * The whole history a segmented history and its segments, read in its order,
 * hold, or `undefined` with every problem refused (see the module comment).
 * `at` is where the segmented history was read; a node's place is given as its
 * segment's place in that history's list.
 */
export function historyFromSegments(
  reading: Reading,
  history: SegmentedHistoryRecord,
  segments: readonly HistorySegmentRecord[],
  at: string,
): HistoryRecord | undefined {
  const nodes = new Map<HistoryNodeId, HistoryNodeRecord>();
  const places = new Map<HistoryNodeId, string>();
  let whole = true;
  for (const [index, segment] of segments.entries()) {
    const segmentAt = pathOf(pathOf(at, 'segments'), index);
    if (segment.project !== history.project) {
      reading.refuse(
        'history.foreign-segment',
        'The segment holds nodes of another project.',
        segmentAt,
      );
      whole = false;
    }
    for (const [position, node] of segment.nodes.entries()) {
      const place = pathOf(pathOf(segmentAt, 'nodes'), position);
      if (nodes.has(node.id)) {
        reading.refuse(
          'schema.duplicate-id',
          'Another segment holds a node of the same identifier.',
          place,
        );
        whole = false;
      } else {
        nodes.set(node.id, node);
        places.set(node.id, place);
      }
    }
  }
  if (!learnFingerprints(reading, history.fingerprints, nodes, pathOf(at, 'fingerprints'))) {
    whole = false;
  }
  if (!whole) return undefined;
  const { project, cursor, preferred, branchNames, snapshots } = history;
  return checkedHistoryRecord(
    reading,
    at,
    { project, cursor, preferred, branchNames, snapshots },
    { nodes, places, at: pathOf(at, 'segments') },
  );
}

/** Gives each node the fingerprint the history learned for it, refusing what conflicts. */
function learnFingerprints(
  reading: Reading,
  fingerprints: ReadonlyMap<HistoryNodeId, StateFingerprint>,
  nodes: Map<HistoryNodeId, HistoryNodeRecord>,
  at: string,
): boolean {
  let sound = true;
  for (const [id, stateFingerprint] of fingerprints) {
    const node = nodes.get(id);
    if (node === undefined) {
      reading.refuse('history.unknown-node', 'The history holds no node of this identifier.', at);
      sound = false;
    } else if (node.stateFingerprint !== undefined && node.stateFingerprint !== stateFingerprint) {
      reading.refuse(
        'history.fingerprint-differs',
        'The node already holds a different state fingerprint.',
        at,
      );
      sound = false;
    } else {
      nodes.set(id, { ...node, stateFingerprint });
    }
  }
  return sound;
}
