/**
 * The branching history of a project as an immutable value, and the ways it
 * grows: starting, recording a change at the cursor, learning a node's state
 * fingerprint, and naming a branch.
 *
 * REQ-STOR-193 replaces the destructive redo stack with a tree. Recording a
 * change makes it a child of the node the project is at and never discards a
 * sibling, so `A → B → C`, back to `A`, then `D`, keeps `B → C` as an
 * alternative branch. A node's identifier is given by the caller, from the
 * injected identifier generator or from a stored record, and never changes. The
 * value knows nothing of storage: the storage layer keeps it, replays its
 * invocations and holds the states its fingerprints name. Serves REQ-STOR-021
 * and REQ-STOR-193.
 */

import type { CommandInvocation, HistoryEntry } from '@audiogubbins/commands';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  LONGEST_CHANGE_DESCRIPTION,
  readHistoryNodeRecord,
  startReading,
  writeHistoryNodeRecord,
  type AffectedEntities,
  type ChangeNodeRecord,
  type HistoryLabel,
  type HistoryNodeId,
  type NamedSnapshot,
  type OriginNodeRecord,
  type SnapshotId,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import { emptyPersistentMap, type PersistentMap } from './persistent-map.js';

/** A change the history holds, with the command layer's invocations. */
export type ChangeNode = ChangeNodeRecord<CommandInvocation>;

/** A node of the history: its origin, or a change. */
export type HistoryNode = OriginNodeRecord | ChangeNode;

/**
 * A project's history.
 *
 * Built and changed only by this package's functions, which keep it one tree:
 * every node but `root` has its parent in `nodes`, `children` lists each node's
 * children oldest first, and `preferred` names, for a node, the child visited
 * most recently, which redo follows. The maps are persistent, so a new history
 * shares all but a path of each with the one it came from.
 */
export interface History {
  readonly project: ProjectId;
  readonly root: HistoryNodeId;

  /** The node whose state the project is in. */
  readonly cursor: HistoryNodeId;
  readonly nodes: PersistentMap<HistoryNodeId, HistoryNode>;
  readonly children: PersistentMap<HistoryNodeId, readonly HistoryNodeId[]>;
  readonly preferred: PersistentMap<HistoryNodeId, HistoryNodeId>;

  /** The name of each named branch, on the node the branch starts at. */
  readonly branchNames: ReadonlyMap<HistoryNodeId, HistoryLabel>;
  readonly snapshots: ReadonlyMap<SnapshotId, NamedSnapshot>;
}

/** A history of one node: the origin of a new, imported or forked project. */
export function startHistory(project: ProjectId, origin: OriginNodeRecord): History {
  return {
    project,
    root: origin.id,
    cursor: origin.id,
    nodes: emptyPersistentMap<HistoryNodeId, HistoryNode>().set(origin.id, origin),
    children: emptyPersistentMap(),
    preferred: emptyPersistentMap(),
    branchNames: new Map(),
    snapshots: new Map(),
  };
}

/** The parent of a node, or `undefined` for the root. */
export function parentOf(node: HistoryNode): HistoryNodeId | undefined {
  return node.kind === 'change' ? node.parent : undefined;
}

/** The refusal of a node the history does not hold. */
export function unknownNode(node: HistoryNodeId): DomainFailure {
  return failure('history.unknown-node', FailureKind.Rejected, 'The history holds no such node.', {
    details: { node },
  });
}

/** What the caller knows of a change the command layer has just applied. */
export interface ChangeDraft {
  readonly id: HistoryNodeId;

  /** When it was applied, in milliseconds since the epoch, from the injected clock. */
  readonly at: number;
  readonly entry: HistoryEntry;
  readonly affects: AffectedEntities;
  readonly stateFingerprint?: StateFingerprint;
}

/**
 * The node for a change applied at the cursor. A description past the longest
 * the format keeps is shortened with an ellipsis: it is text for a menu, and
 * refusing the edit for it would lose the person's work.
 */
export function changeNodeOf(history: History, draft: ChangeDraft): ChangeNode {
  return {
    kind: 'change',
    id: draft.id,
    parent: history.cursor,
    at: draft.at,
    description: shortened(draft.entry.description),
    forward: draft.entry.forward,
    inverse: draft.entry.inverse,
    affects: draft.affects,
    ...(draft.stateFingerprint === undefined ? {} : { stateFingerprint: draft.stateFingerprint }),
  };
}

/** Text cut to the longest description, never between a surrogate pair. */
function shortened(text: string): string {
  if (text.length <= LONGEST_CHANGE_DESCRIPTION) return text;
  let end = LONGEST_CHANGE_DESCRIPTION - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/**
 * The history with a change recorded as a child of the cursor, which moves to
 * it. Every sibling is kept.
 *
 * Refused where the node is not a child of the cursor, where its identifier is
 * taken, or where the format could not read it back, such as an argument past
 * its bounds: a change the history held but could not store would be lost at
 * the next reload without a word.
 */
export function recordChange(history: History, node: ChangeNode): DomainResult<History> {
  if (node.parent !== history.cursor) {
    return fail(
      failure(
        'history.not-at-cursor',
        FailureKind.Conflict,
        'A change is recorded only as a child of the node the project is at.',
      ),
    );
  }
  if (history.nodes.has(node.id)) {
    return fail(
      failure('history.duplicate-node', FailureKind.Conflict, 'The history holds this node.', {
        details: { node: node.id },
      }),
    );
  }
  const reading = startReading();
  const read = reading.outcome(
    readHistoryNodeRecord(reading, writeHistoryNodeRecord(node), '', 'node'),
  );
  if (!read.ok) {
    const [first, ...rest] = read.failures;
    return fail(
      failure(
        'history.unrecordable-change',
        FailureKind.Rejected,
        'The change cannot be kept in the project history.',
        { cause: first },
      ),
      ...rest,
    );
  }

  const siblings = history.children.get(history.cursor) ?? [];
  return succeed({
    ...history,
    cursor: node.id,
    nodes: history.nodes.set(node.id, node),
    children: history.children.set(history.cursor, [...siblings, node.id]),
    preferred: history.preferred.set(history.cursor, node.id),
  });
}

/**
 * The history with the fingerprint of a node's state recorded, once the storage
 * layer has computed it. Refused where the node already has another: a state
 * has one fingerprint.
 */
export function withStateFingerprint(
  history: History,
  id: HistoryNodeId,
  stateFingerprint: StateFingerprint,
): DomainResult<History> {
  const node = history.nodes.get(id);
  if (node === undefined) return fail(unknownNode(id));
  if (node.stateFingerprint === stateFingerprint) return succeed(history);
  if (node.stateFingerprint !== undefined) {
    return fail(
      failure(
        'history.fingerprint-differs',
        FailureKind.IntegrityViolation,
        'The node already holds a different state fingerprint.',
        { details: { node: id } },
      ),
    );
  }
  return succeed({ ...history, nodes: history.nodes.set(id, { ...node, stateFingerprint }) });
}

/**
 * The history with the branch starting at `node` named, or its name removed
 * where `name` is `undefined`. Names need not be unique: a branch is known by
 * its node, and a name is a label for people.
 */
export function nameBranch(
  history: History,
  node: HistoryNodeId,
  name: HistoryLabel | undefined,
): DomainResult<History> {
  if (!history.nodes.has(node)) return fail(unknownNode(node));
  const branchNames = new Map(history.branchNames);
  if (name === undefined) branchNames.delete(node);
  else branchNames.set(node, name);
  return succeed({ ...history, branchNames });
}
