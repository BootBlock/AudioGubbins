/**
 * The checks of a stored history's graph as a whole (REQ-STOR-193,
 * REQ-EXEC-136.12): exactly one root, every parent present, no cycle, and every
 * reference to a node, from the cursor, a preference, a branch name or a
 * snapshot, to a node the history holds. Each refuses every problem it finds at
 * the place the node was read from.
 */

import { pathOf, type Reading } from './document-reading.js';
import type {
  HistoryLabel,
  HistoryNodeId,
  HistoryNodeRecord,
  NamedSnapshot,
} from './history-record.js';

/** Where each node was read, for a refusal that names the node's place. */
export type Places = ReadonlyMap<HistoryNodeId, string>;

/** The parent of a node, where it has one. */
function parentOf(node: HistoryNodeRecord): HistoryNodeId | undefined {
  return node.kind === 'change' ? node.parent : undefined;
}

/**
 * Whether the nodes form one tree: exactly one root, every parent present, and
 * every node reaching the root. Refuses each problem found.
 */
export function checkTree(
  reading: Reading,
  nodes: ReadonlyMap<HistoryNodeId, HistoryNodeRecord>,
  places: Places,
  at: string,
): boolean {
  const roots: HistoryNodeId[] = [];
  let sound = true;
  for (const node of nodes.values()) {
    const parent = parentOf(node);
    if (parent === undefined) {
      roots.push(node.id);
    } else if (!nodes.has(parent)) {
      reading.refuse(
        'history.missing-parent',
        'The node names a parent the history does not hold.',
        pathOf(places.get(node.id) ?? at, 'parent'),
      );
      sound = false;
    }
  }
  if (roots.length !== 1) {
    reading.refuse('history.not-one-root', 'A history has exactly one node without a parent.', at, {
      roots: roots.length,
    });
    return false;
  }
  return sound && checkAcyclic(reading, nodes, places, at);
}

/**
 * Whether every node reaches the root by its parents, refusing the first node
 * of each cycle met. Each node is walked over once: a walk stops at a node an
 * earlier walk settled.
 */
function checkAcyclic(
  reading: Reading,
  nodes: ReadonlyMap<HistoryNodeId, HistoryNodeRecord>,
  places: Places,
  at: string,
): boolean {
  const settled = new Map<HistoryNodeId, 'rooted' | 'cyclic'>();
  let sound = true;
  for (const start of nodes.values()) {
    const walked = new Set<HistoryNodeId>();
    let current: HistoryNodeRecord | undefined = start;
    let outcome: 'rooted' | 'cyclic' = 'rooted';
    while (current !== undefined) {
      const known = settled.get(current.id);
      if (known !== undefined) {
        outcome = known;
        break;
      }
      if (walked.has(current.id)) {
        outcome = 'cyclic';
        reading.refuse(
          'history.cycle',
          'The node is its own ancestor, so it never reaches the root.',
          places.get(current.id) ?? at,
        );
        break;
      }
      walked.add(current.id);
      const parent = parentOf(current);
      current = parent === undefined ? undefined : nodes.get(parent);
    }
    for (const id of walked) settled.set(id, outcome);
    if (outcome === 'cyclic') sound = false;
  }
  return sound;
}

export interface References {
  readonly cursor: HistoryNodeId;
  readonly preferred: ReadonlyMap<HistoryNodeId, HistoryNodeId>;
  readonly branchNames: ReadonlyMap<HistoryNodeId, HistoryLabel>;
  readonly snapshots: readonly NamedSnapshot[];
}

/** Whether every reference to a node names one the history holds, refusing each that does not. */
export function checkReferences(
  reading: Reading,
  at: string,
  references: References,
  nodes: ReadonlyMap<HistoryNodeId, HistoryNodeRecord>,
): boolean {
  let sound = true;
  const expectNode = (id: HistoryNodeId, place: string): void => {
    if (nodes.has(id)) return;
    reading.refuse('history.unknown-node', 'The history holds no node of this identifier.', place);
    sound = false;
  };

  expectNode(references.cursor, pathOf(at, 'cursor'));
  for (const [node, child] of references.preferred) {
    const childNode = nodes.get(child);
    if (!nodes.has(node) || childNode === undefined || parentOf(childNode) !== node) {
      reading.refuse(
        'history.preferred-not-a-child',
        'A preference names a node and a child that is not one of its children.',
        pathOf(at, 'preferred'),
      );
      sound = false;
    }
  }
  for (const node of references.branchNames.keys()) expectNode(node, pathOf(at, 'branchNames'));
  for (const [index, snapshot] of references.snapshots.entries()) {
    const place = pathOf(pathOf(at, 'snapshots'), index);
    const node = nodes.get(snapshot.node);
    expectNode(snapshot.node, pathOf(place, 'node'));
    if (
      node?.stateFingerprint !== undefined &&
      node.stateFingerprint !== snapshot.stateFingerprint
    ) {
      reading.refuse(
        'history.snapshot-fingerprint-mismatch',
        "The snapshot's state fingerprint differs from its node's.",
        pathOf(place, 'stateFingerprint'),
      );
      sound = false;
    }
  }
  return sound;
}
