/**
 * Moving through a history: undo, redo, going to any node, and the changes to
 * reverse and replay on the way (REQ-STOR-021, REQ-STOR-193).
 *
 * Every move is planned here and applied by the storage layer, which replays
 * the invocations through the command layer and adopts the history the plan
 * gives only once they have applied. The path between two nodes runs through
 * their nearest common ancestor: the changes from the first node up to it are
 * reversed, newest first, and those from it down to the second are replayed,
 * oldest first. Moving never removes a node, so an undone branch stays for as
 * long as retention keeps it.
 */

import type { CommandInvocation } from '@audiogubbins/commands';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { HistoryNodeId, StateFingerprint } from '@audiogubbins/project-format';

import {
  parentOf,
  unknownNode,
  type ChangeNode,
  type History,
  type HistoryNode,
} from './history.js';
import { ancestry, continuationOf } from './lines.js';

/** The changes between two nodes. */
export interface HistoryPath {
  /** The changes to reverse, newest first. */
  readonly undo: readonly ChangeNode[];

  /** The changes to replay, oldest first. */
  readonly redo: readonly ChangeNode[];
}

/** A planned move, and the history once it has been made. */
export interface Navigation {
  readonly path: HistoryPath;

  /**
   * Every invocation to run, in order: each reversed change's inverse, then
   * each replayed change's forward invocations.
   */
  readonly invocations: readonly CommandInvocation[];

  /** The history at the destination, to adopt once the invocations applied. */
  readonly history: History;
}

/** A node on a path that is not the root is a change, by the tree's shape. */
function asChange(node: HistoryNode): ChangeNode {
  if (node.kind !== 'change') {
    throw new Error('A history path passed through its origin, which only the root can be.');
  }
  return node;
}

/** The changes from one node to another, through their nearest common ancestor. */
export function pathBetween(
  history: History,
  from: HistoryNodeId,
  to: HistoryNodeId,
): DomainResult<HistoryPath> {
  if (!history.nodes.has(from)) return fail(unknownNode(from));
  if (!history.nodes.has(to)) return fail(unknownNode(to));

  const fromLine = [...ancestry(history, from)];
  const depthOf = new Map(fromLine.map((node, index) => [node.id, index]));
  const redo: ChangeNode[] = [];
  let common: number | undefined;
  for (const node of ancestry(history, to)) {
    common = depthOf.get(node.id);
    if (common !== undefined) break;
    redo.push(asChange(node));
  }
  if (common === undefined) {
    throw new Error('Two nodes of one history share no ancestor.');
  }
  return succeed({ undo: fromLine.slice(0, common).map(asChange), redo: redo.reverse() });
}

/**
 * A move of the cursor to `target`. On arrival each node passed through is the
 * preferred child of its parent, so redo retraces the way the person came and a
 * branch they moved onto becomes the one redo follows.
 */
export function moveTo(history: History, target: HistoryNodeId): DomainResult<Navigation> {
  const planned = pathBetween(history, history.cursor, target);
  if (!planned.ok) return planned;
  const path = planned.value;

  let preferred = history.preferred;
  for (const node of [...path.undo, ...path.redo]) {
    if (node.parent !== undefined) preferred = preferred.set(node.parent, node.id);
  }
  return succeed({
    path,
    invocations: [
      ...path.undo.flatMap((node) => node.inverse),
      ...path.redo.flatMap((node) => node.forward),
    ],
    history: { ...history, cursor: target, preferred },
  });
}

/** The change undo would reverse, or `undefined` at the root. */
export function undoTarget(history: History): ChangeNode | undefined {
  const node = history.nodes.get(history.cursor);
  return node?.kind === 'change' && node.parent !== undefined ? node : undefined;
}

/** The change redo would replay, or `undefined` where the cursor has no child. */
export function redoTarget(history: History): ChangeNode | undefined {
  const next = continuationOf(history, history.cursor);
  const node = next === undefined ? undefined : history.nodes.get(next);
  return node === undefined ? undefined : asChange(node);
}

/** Undo: a move to the cursor's parent, or `undefined` at the root. */
export function undo(history: History): Navigation | undefined {
  const target = undoTarget(history);
  return target?.parent === undefined ? undefined : arrive(history, target.parent);
}

/** Redo: a move along the continuation, or `undefined` where there is none. */
export function redo(history: History): Navigation | undefined {
  const target = redoTarget(history);
  return target === undefined ? undefined : arrive(history, target.id);
}

/** A move to a node known to be in the history. */
function arrive(history: History, target: HistoryNodeId): Navigation {
  const moved = moveTo(history, target);
  if (!moved.ok) throw new Error('A move to a node of the history was refused.');
  return moved.value;
}

/**
 * How to reach a node's state from a state the storage layer keeps whole,
 * rather than by reversing and replaying from the cursor.
 */
export interface Restoration {
  /** The nearest node at or above the target whose state is kept. */
  readonly base: HistoryNode;
  readonly baseState: StateFingerprint;

  /** The changes to replay on the base's state, oldest first. */
  readonly redo: readonly ChangeNode[];

  /** The history at the target, to adopt once the replay applied. */
  readonly history: History;
}

/**
 * The restoration of `target` from the nearest kept state at or above it: the
 * safe way back to a state when the path from the cursor is long, or when
 * replaying it has failed (REQ-STOR-193). `isKept` says whether the storage
 * layer holds a state. Refused where no node at or above the target has one.
 */
export function restorationOf(
  history: History,
  target: HistoryNodeId,
  isKept: (state: StateFingerprint) => boolean,
): DomainResult<Restoration> {
  const moved = moveTo(history, target);
  if (!moved.ok) return moved;

  const redo: ChangeNode[] = [];
  for (const node of ancestry(history, target)) {
    if (node.stateFingerprint !== undefined && isKept(node.stateFingerprint)) {
      return succeed({
        base: node,
        baseState: node.stateFingerprint,
        redo: redo.reverse(),
        history: moved.value.history,
      });
    }
    if (parentOf(node) !== undefined) redo.push(asChange(node));
  }
  return fail(
    failure(
      'history.no-kept-state',
      FailureKind.Conflict,
      'No state at or before this point of the history is kept whole.',
      { details: { node: target } },
    ),
  );
}
