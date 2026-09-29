/**
 * A place in a project's journal: an epoch of the write lease and a sequence
 * number within it (REQ-STOR-098, REQ-STOR-101).
 *
 * A head records the position of the last record its checkpoint includes, so
 * recovery replays what follows it. Sequence numbers start at 1 in each epoch,
 * and a position whose sequence is 0 is the start of its epoch, before any
 * record. Positions order by epoch, then by sequence.
 */

import {
  objectOf,
  pathOf,
  required,
  type Converter,
  type JsonObject,
} from '@audiogubbins/project-format';

import { asWholeNumber } from './record-values.js';

/** A place in a journal. */
export interface JournalPosition {
  readonly epoch: number;
  readonly sequence: number;
}

/**
 * Where the journal of a project that no writer has opened starts: epoch 0,
 * which no writer takes, since opening to write raises the epoch.
 */
export const JOURNAL_START: JournalPosition = { epoch: 0, sequence: 0 };

/** Orders two positions: negative, zero or positive. */
export function comparePositions(left: JournalPosition, right: JournalPosition): number {
  return left.epoch - right.epoch || left.sequence - right.sequence;
}

const POSITION_MEMBERS: ReadonlySet<string> = new Set(['epoch', 'sequence']);

/** Writes a position. */
export function writePosition(position: JournalPosition): JsonObject {
  return { epoch: position.epoch, sequence: position.sequence };
}

/** Reads a position. */
export const asPosition: Converter<JournalPosition> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, POSITION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const epoch = required(reading, object, at, 'epoch', asWholeNumber);
  const sequence = required(reading, object, at, 'sequence', asWholeNumber);
  return epoch === undefined || sequence === undefined ? undefined : { epoch, sequence };
};
