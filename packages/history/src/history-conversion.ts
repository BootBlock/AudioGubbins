/**
 * Converting between a history and its stored record (REQ-STOR-021,
 * REQ-STOR-193).
 *
 * The record is what `@audiogubbins/project-format` writes and reads, and its
 * reader has already refused any record that is not one rooted tree whose
 * references all resolve. What is left here is what the format cannot check
 * from below the command layer: each stored command identifier is branded with
 * the command layer's own check, and a record naming anything else is refused.
 */

import { commandId, isCommandId, type CommandInvocation } from '@audiogubbins/commands';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  compareCodeUnits,
  type HistoryNodeId,
  type HistoryNodeRecord,
  type HistoryRecord,
  type InvocationRecord,
} from '@audiogubbins/project-format';

import { parentOf, type History, type HistoryNode } from './history.js';
import { persistentMapOf } from './persistent-map.js';

/** The record a history is stored as. */
export function historyRecordOf(history: History): HistoryRecord {
  return {
    project: history.project,
    nodes: [...history.nodes.values()],
    cursor: history.cursor,
    preferred: new Map(history.preferred.entries()),
    branchNames: history.branchNames,
    snapshots: [...history.snapshots.values()],
  };
}

function invocationOf(record: InvocationRecord): CommandInvocation | undefined {
  if (!isCommandId(record.commandId)) return undefined;
  return {
    commandId: commandId(record.commandId),
    ...(record.arguments === undefined ? {} : { arguments: record.arguments }),
  };
}

function invocationsOf(
  records: readonly [InvocationRecord, ...InvocationRecord[]],
): readonly [CommandInvocation, ...CommandInvocation[]] | undefined {
  const [first, ...rest] = records;
  const head = invocationOf(first);
  const tail: CommandInvocation[] = [];
  for (const record of rest) {
    const invocation = invocationOf(record);
    if (invocation === undefined) return undefined;
    tail.push(invocation);
  }
  return head === undefined ? undefined : [head, ...tail];
}

/**
 * The node a stored node record holds, such as a journal's record of one
 * change. Refused where an invocation names no command identifier.
 */
export function nodeFromRecord(record: HistoryNodeRecord): DomainResult<HistoryNode> {
  if (record.kind === 'origin') return succeed(record);
  const forward = invocationsOf(record.forward);
  const inverse = invocationsOf(record.inverse);
  if (forward === undefined || inverse === undefined) {
    return fail(
      failure(
        'history.malformed-command-id',
        FailureKind.IntegrityViolation,
        'A stored change names a command by something that is not a command identifier.',
        { details: { node: record.id } },
      ),
    );
  }
  return succeed({ ...record, forward, inverse });
}

/**
 * The history a record read by `readHistoryRecord` holds, each node's children
 * oldest first.
 */
export function historyFromRecord(record: HistoryRecord): DomainResult<History> {
  const nodes: [HistoryNodeId, HistoryNode][] = [];
  for (const stored of record.nodes) {
    const node = nodeFromRecord(stored);
    if (!node.ok) return node;
    nodes.push([node.value.id, node.value]);
  }

  const roots = nodes.filter(([, node]) => parentOf(node) === undefined);
  const [root, ...others] = roots;
  if (root === undefined || others.length > 0) {
    throw new Error('A history record is converted only once its reader has checked it.');
  }

  const ordered = nodes
    .map(([, node]) => node)
    .sort((left, right) => left.at - right.at || compareCodeUnits(left.id, right.id));
  const children = new Map<HistoryNodeId, HistoryNodeId[]>();
  for (const node of ordered) {
    const parent = parentOf(node);
    if (parent === undefined) continue;
    const held = children.get(parent);
    if (held === undefined) children.set(parent, [node.id]);
    else held.push(node.id);
  }

  return succeed({
    project: record.project,
    root: root[0],
    cursor: record.cursor,
    nodes: persistentMapOf(nodes),
    children: persistentMapOf(children),
    preferred: persistentMapOf(record.preferred),
    branchNames: record.branchNames,
    snapshots: new Map(record.snapshots.map((snapshot) => [snapshot.id, snapshot])),
  });
}
