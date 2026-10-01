/**
 * Writing and reading a project's whole history as JSON: its nodes, cursor,
 * redo preferences, branch names and snapshots (REQ-STOR-021, REQ-STOR-193,
 * REQ-STOR-194, REQ-EXEC-136.12).
 *
 * Every node is read as `history-node-json.ts` reads one, and then the graph is
 * checked whole, as `history-graph-checks.ts` describes. A history that fails
 * any check is refused rather than repaired, so navigation never meets a node
 * it cannot reach.
 *
 * Maps and lists are written sorted by identifier, so the same history always
 * gives the same text.
 */

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  listOf,
  objectOf,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { presentMembers, sortedBy } from './document-writing.js';
import { checkReferences, checkTree, type Places } from './history-graph-checks.js';
import { readHistoryNodeRecord, writeHistoryNodeRecord } from './history-node-json.js';
import type {
  HistoryLabel,
  HistoryNodeId,
  HistoryNodeRecord,
  HistoryRecord,
  NamedSnapshot,
} from './history-record.js';
import { asId } from './scalar-reading.js';
import { readHistoryLabel, readSnapshotRecord, writeSnapshotRecord } from './snapshot-json.js';
import { MAXIMUM_ENTITIES } from './value-reading.js';

/**
 * The most nodes a stored history holds: ten million changes, past anything a
 * person makes, and a bound that keeps a hostile document from making the
 * reader allocate without limit.
 */
export const MAXIMUM_HISTORY_NODES = 10_000_000;

const HISTORY_MEMBERS: ReadonlySet<string> = new Set([
  'project',
  'cursor',
  'nodes',
  'preferred',
  'branchNames',
  'snapshots',
]);
const PREFERENCE_MEMBERS: ReadonlySet<string> = new Set(['node', 'child']);
const BRANCH_NAME_MEMBERS: ReadonlySet<string> = new Set(['node', 'name']);

/** Writes a history. */
export function writeHistoryRecord(history: HistoryRecord): JsonObject {
  return presentMembers({
    project: history.project,
    cursor: history.cursor,
    nodes: sortedBy(history.nodes, (node) => node.id, writeHistoryNodeRecord),
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

/** Reads a history, refusing one whose graph is not a single rooted tree. */
export const readHistoryRecord: Converter<HistoryRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, HISTORY_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);

  const project = required(reading, object, at, 'project', asId<'ProjectId'>);
  const cursor = required(reading, object, at, 'cursor', asId<'HistoryNodeId'>);
  const read = required(reading, object, at, 'nodes', readHistoryNodes);
  const preferred = required(reading, object, at, 'preferred', asPreferences);
  const branchNames = required(reading, object, at, 'branchNames', asBranchNames);
  const snapshots = required(reading, object, at, 'snapshots', asSnapshots);
  if (
    project === undefined ||
    cursor === undefined ||
    read === undefined ||
    preferred === undefined ||
    branchNames === undefined ||
    snapshots === undefined
  ) {
    return undefined;
  }

  return checkedHistoryRecord(
    reading,
    at,
    { project, cursor, preferred, branchNames, snapshots },
    read,
  );
};

/** Everything a history record holds but its nodes. */
export type HistoryLinks = Omit<HistoryRecord, 'nodes'>;

/**
 * The record of a history's nodes and links, or `undefined` where its graph is
 * not one rooted tree whose references all resolve, with every problem refused.
 * `at` is where the links were read.
 */
export function checkedHistoryRecord(
  reading: Reading,
  at: string,
  links: HistoryLinks,
  read: ReadNodes,
): HistoryRecord | undefined {
  // Both checks run whatever the first finds, so every problem is reported.
  const tree = checkTree(reading, read.nodes, read.places, read.at);
  const references = checkReferences(reading, at, links, read.nodes);
  return tree && references ? { ...links, nodes: [...read.nodes.values()] } : undefined;
}

/** Nodes read by identifier, with where each was read and where they all were. */
export interface ReadNodes {
  readonly nodes: ReadonlyMap<HistoryNodeId, HistoryNodeRecord>;
  readonly places: Places;
  readonly at: string;
}

/** Reads a list of nodes, refusing one listed twice. */
export const readHistoryNodes: Converter<ReadNodes> = (reading, value, parent, key) => {
  const list = listOf(reading, value, parent, key, MAXIMUM_HISTORY_NODES);
  if (list === undefined) return undefined;
  const at = pathOf(parent, key);
  const nodes = new Map<HistoryNodeId, HistoryNodeRecord>();
  const places = new Map<HistoryNodeId, string>();
  let whole = true;
  for (const [index, item] of list.entries()) {
    const node = readHistoryNodeRecord(reading, item, at, index);
    if (node === undefined) {
      whole = false;
    } else if (nodes.has(node.id)) {
      reading.refuse(
        'schema.duplicate-id',
        'Another entity in this list has the same identifier.',
        pathOf(at, index),
      );
      whole = false;
    } else {
      nodes.set(node.id, node);
      places.set(node.id, pathOf(at, index));
    }
  }
  return whole ? { nodes, places, at } : undefined;
};

/**
 * Reads a list of pairs, each of a node and one value, into a map by node,
 * refusing a node listed twice.
 */
export function nodeMap<TValue>(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  members: ReadonlySet<string>,
  valueKey: string,
  convert: Converter<TValue>,
): ReadonlyMap<HistoryNodeId, TValue> | undefined {
  const list = listOf(reading, value, parent, key, MAXIMUM_HISTORY_NODES);
  if (list === undefined) return undefined;
  const at = pathOf(parent, key);
  const entries = new Map<HistoryNodeId, TValue>();
  let whole = true;
  for (const [index, item] of list.entries()) {
    const object = objectOf(reading, item, at, index, members);
    const itemAt = pathOf(at, index);
    const node =
      object === undefined
        ? undefined
        : required(reading, object, itemAt, 'node', asId<'HistoryNodeId'>);
    const read =
      object === undefined ? undefined : required(reading, object, itemAt, valueKey, convert);
    if (node === undefined || read === undefined) {
      whole = false;
    } else if (entries.has(node)) {
      reading.refuse(
        'schema.duplicate-id',
        'Another entry in this list names the same node.',
        pathOf(itemAt, 'node'),
      );
      whole = false;
    } else {
      entries.set(node, read);
    }
  }
  return whole ? entries : undefined;
}

export const asPreferences: Converter<ReadonlyMap<HistoryNodeId, HistoryNodeId>> = (
  reading,
  value,
  parent,
  key,
) => nodeMap(reading, value, parent, key, PREFERENCE_MEMBERS, 'child', asId<'HistoryNodeId'>);

export const asBranchNames: Converter<ReadonlyMap<HistoryNodeId, HistoryLabel>> = (
  reading,
  value,
  parent,
  key,
) => nodeMap(reading, value, parent, key, BRANCH_NAME_MEMBERS, 'name', readHistoryLabel);

export const asSnapshots: Converter<readonly NamedSnapshot[]> = (reading, value, parent, key) => {
  const list = listOf(reading, value, parent, key, MAXIMUM_ENTITIES);
  if (list === undefined) return undefined;
  const at = pathOf(parent, key);
  const snapshots: NamedSnapshot[] = [];
  const seen = new Set<string>();
  let whole = true;
  for (const [index, item] of list.entries()) {
    const snapshot = readSnapshotRecord(reading, item, at, index);
    if (snapshot === undefined) {
      whole = false;
    } else if (seen.has(snapshot.id)) {
      reading.refuse(
        'schema.duplicate-id',
        'Another entity in this list has the same identifier.',
        pathOf(at, index),
      );
      whole = false;
    } else {
      seen.add(snapshot.id);
      snapshots.push(snapshot);
    }
  }
  return whole ? snapshots : undefined;
};
