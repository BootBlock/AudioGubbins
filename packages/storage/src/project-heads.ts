/**
 * A project's commit point: the head, which names the checkpoint the project is
 * at and the position in the journal that checkpoint includes (ADR-0020,
 * REQ-STOR-101).
 *
 * A checkpoint counts only once a head names it, and a head is written only
 * after its checkpoint and every state the checkpoint keeps, so a head never
 * names what is not yet whole. The head changes with every checkpoint, so it is
 * a pair (`generational-pair.ts`): recovery takes the valid head with the
 * higher generation and falls back to the other where that one's checkpoint
 * cannot be read.
 */

import {
  objectOf,
  pathOf,
  required,
  type Converter,
  type JsonObject,
} from '@audiogubbins/project-format';

import { RecordKind } from './checked-records.js';
import type { Generational, PairFiles } from './generational-pair.js';
import { asPosition, writePosition, type JournalPosition } from './journal-position.js';
import { asCheckpointId, asCountingNumber } from './record-values.js';
import type { CheckpointId, ProjectPaths } from './storage-layout.js';

/** A project's head. */
export interface ProjectHead extends Generational {
  readonly checkpoint: CheckpointId;

  /** The last journal record the checkpoint includes. */
  readonly journal: JournalPosition;
}

const HEAD_MEMBERS: ReadonlySet<string> = new Set(['generation', 'checkpoint', 'journal']);

/** Writes a head. */
export function writeHead(head: ProjectHead): JsonObject {
  return {
    generation: head.generation,
    checkpoint: head.checkpoint,
    journal: writePosition(head.journal),
  };
}

/** Reads a head. */
const readHead: Converter<ProjectHead> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, HEAD_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const generation = required(reading, object, at, 'generation', asCountingNumber);
  const checkpoint = required(reading, object, at, 'checkpoint', asCheckpointId);
  const journal = required(reading, object, at, 'journal', asPosition);
  if (generation === undefined || checkpoint === undefined || journal === undefined) {
    return undefined;
  }
  return { generation, checkpoint, journal };
};

/** The two files a project's head is kept in. */
export function headFiles(paths: ProjectPaths): PairFiles<ProjectHead> {
  return { path: (slot) => paths.head(slot), kind: RecordKind.ProjectHead, convert: readHead };
}
