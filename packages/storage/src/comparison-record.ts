/**
 * The A/B comparison a project has open, as it is kept: the node or snapshot
 * each side was chosen by, and the side being listened to (REQ-STOR-195).
 *
 * Only the choice is kept. Each side is found again in the history when the
 * project is read, so a comparison always describes the history it is kept
 * with, and choosing, switching or reloading never touches either state.
 */

import { flatMapResult, mapResult, type DomainResult } from '@audiogubbins/domain';
import {
  comparisonSide,
  startComparison,
  switchSide,
  type Comparison,
  type ComparisonSide,
  type ComparisonSource,
  type History,
  type SideName,
} from '@audiogubbins/history';
import {
  anyObjectOf,
  asId,
  checkMembers,
  objectOf,
  oneOfConverter,
  pathOf,
  required,
  type Converter,
  type JsonObject,
} from '@audiogubbins/project-format';

/** The choice a comparison was made by. */
export interface ComparisonChoice {
  readonly a: ComparisonSource;
  readonly b: ComparisonSource;
  readonly listening: SideName;
}

/** The source a side was chosen by. */
function sourceOf(side: ComparisonSide): ComparisonSource {
  return side.snapshot === undefined
    ? { kind: 'node', node: side.node }
    : { kind: 'snapshot', snapshot: side.snapshot };
}

/** The choice a comparison holds. */
export function choiceOf(comparison: Comparison): ComparisonChoice {
  return { a: sourceOf(comparison.a), b: sourceOf(comparison.b), listening: comparison.listening };
}

/** The comparison a choice makes in a history, or why it makes none there. */
export function comparisonFrom(
  history: History,
  choice: ComparisonChoice,
): DomainResult<Comparison> {
  return flatMapResult(comparisonSide(history, choice.a), (a) =>
    flatMapResult(comparisonSide(history, choice.b), (b) =>
      mapResult(startComparison(a, b), (started) => switchSide(started, choice.listening)),
    ),
  );
}

const SIDES = ['a', 'b'] as const;
const SOURCE_KINDS = ['node', 'snapshot'] as const;
const CHOICE_MEMBERS: ReadonlySet<string> = new Set(['a', 'b', 'listening']);
const NODE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'node']);
const SNAPSHOT_MEMBERS: ReadonlySet<string> = new Set(['kind', 'snapshot']);

const asSide = oneOfConverter(SIDES);
const asSourceKind = oneOfConverter(SOURCE_KINDS);

/** Writes a choice. */
export function writeChoice(choice: ComparisonChoice): JsonObject {
  return { a: writeSource(choice.a), b: writeSource(choice.b), listening: choice.listening };
}

function writeSource(source: ComparisonSource): JsonObject {
  return source.kind === 'node'
    ? { kind: source.kind, node: source.node }
    : { kind: source.kind, snapshot: source.snapshot };
}

/** Reads a choice. */
export const readChoice: Converter<ComparisonChoice> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, CHOICE_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const a = required(reading, object, at, 'a', asSource);
  const b = required(reading, object, at, 'b', asSource);
  const listening = required(reading, object, at, 'listening', asSide);
  return a === undefined || b === undefined || listening === undefined
    ? undefined
    : { a, b, listening };
};

const asSource: Converter<ComparisonSource> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asSourceKind);
  if (kind === undefined) return undefined;
  if (kind === 'node') {
    checkMembers(reading, object, at, NODE_MEMBERS);
    const node = required(reading, object, at, 'node', asId<'HistoryNodeId'>);
    return node === undefined ? undefined : { kind, node };
  }
  checkMembers(reading, object, at, SNAPSHOT_MEMBERS);
  const snapshot = required(reading, object, at, 'snapshot', asId<'SnapshotId'>);
  return snapshot === undefined ? undefined : { kind, snapshot };
};
