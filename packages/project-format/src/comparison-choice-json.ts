/**
 * The A/B comparison a project has open, as it is kept and carried: the node or
 * snapshot each side was chosen by, and the side being listened to, written and
 * read as JSON (REQ-STOR-195, REQ-EXEC-136.12).
 *
 * Only the choice is kept. The history package finds each side again in the
 * history it is read with, so a comparison always describes the history it
 * travels with, and choosing, switching or carrying it never touches either
 * state.
 */

import type { JsonObject } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  objectOf,
  pathOf,
  required,
  type Converter,
} from './document-reading.js';
import type { HistoryNodeId, SnapshotId } from './history-record.js';
import { asId, oneOfConverter } from './scalar-reading.js';

/** The source one side of a comparison was chosen by: a node, or a named snapshot. */
export type ComparisonSourceRecord =
  | { readonly kind: 'node'; readonly node: HistoryNodeId }
  | { readonly kind: 'snapshot'; readonly snapshot: SnapshotId };

/** The choice a comparison was made by, and the side listened to. */
export interface ComparisonChoiceRecord {
  readonly a: ComparisonSourceRecord;
  readonly b: ComparisonSourceRecord;
  readonly listening: 'a' | 'b';
}

const SIDES = ['a', 'b'] as const;
const SOURCE_KINDS = ['node', 'snapshot'] as const;
const CHOICE_MEMBERS: ReadonlySet<string> = new Set(['a', 'b', 'listening']);
const NODE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'node']);
const SNAPSHOT_MEMBERS: ReadonlySet<string> = new Set(['kind', 'snapshot']);

const asSide = oneOfConverter(SIDES);
const asSourceKind = oneOfConverter(SOURCE_KINDS);

/** Writes a comparison's choice. */
export function writeComparisonChoice(choice: ComparisonChoiceRecord): JsonObject {
  return { a: writeSource(choice.a), b: writeSource(choice.b), listening: choice.listening };
}

function writeSource(source: ComparisonSourceRecord): JsonObject {
  return source.kind === 'node'
    ? { kind: source.kind, node: source.node }
    : { kind: source.kind, snapshot: source.snapshot };
}

/** Reads a comparison's choice. */
export const readComparisonChoice: Converter<ComparisonChoiceRecord> = (
  reading,
  value,
  parent,
  key,
) => {
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

const asSource: Converter<ComparisonSourceRecord> = (reading, value, parent, key) => {
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
