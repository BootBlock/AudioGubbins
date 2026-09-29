/**
 * Where the storage keeps each thing in the tree, and how the numbered names it
 * writes are read back (ADR-0020, REQ-STOR-025, REQ-STOR-101).
 *
 * - `storage.json`: the storage root.
 * - `projects/<project>/project-0.json` and `project-1.json`: the project's
 *   header, a pair rewritten by turns (`generational-pair.ts`).
 * - `projects/<project>/head-0.json` and `head-1.json`: the commit point, a
 *   pair too.
 * - `projects/<project>/checkpoints/<id>.json`: a checkpoint.
 * - `projects/<project>/states/<fingerprint>.json`: a state.
 * - `projects/<project>/journal/e<epoch>/<sequence>.json`: a journal record.
 * - `projects/<project>/journal/quarantine/e<epoch>-<sequence>.json`: a record
 *   set aside rather than deleted.
 * - `projects/<project>/leases/<epoch>.json`: the write lease's epoch and
 *   seals.
 *
 * Epochs and sequence numbers are written as twelve decimal digits, so a
 * directory listed in name order is listed in number order.
 */

import type { Branded, ProjectId } from '@audiogubbins/domain';
import type { StateFingerprint } from '@audiogubbins/project-format';

/** The storage root's file. */
export const STORAGE_ROOT_FILE = 'storage.json';

/** The directory every project is kept under. */
export const PROJECTS_DIRECTORY = 'projects';

/** One of the two files of a pair that is rewritten by turns. */
export type PairSlot = 0 | 1;

/** Identifies a checkpoint of a project. */
export type CheckpointId = Branded<'CheckpointId'>;

const DIGITS = 12;
const EPOCH_DIRECTORY = /^e([0-9]{12})$/u;
const RECORD_FILE = /^([0-9]{12})\.json$/u;
const LEASE_FILE = /^([0-9]{12})\.json$/u;
const QUARANTINE_DIRECTORY = 'quarantine';

/** A whole number as the fixed-width digits a numbered name is written in. */
function digits(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10 ** DIGITS) {
    throw new RangeError('A numbered storage name is a whole number of at most twelve digits.');
  }
  return String(value).padStart(DIGITS, '0');
}

/** The number a matched name holds. */
function numberIn(match: RegExpExecArray | null): number | undefined {
  const text = match?.[1];
  return text === undefined ? undefined : Number(text);
}

/** The epoch a journal directory's name holds, or `undefined` for another name. */
export function epochOfDirectory(name: string): number | undefined {
  return numberIn(EPOCH_DIRECTORY.exec(name));
}

/** The sequence number a journal record's name holds, or `undefined` for another. */
export function sequenceOfRecord(name: string): number | undefined {
  return numberIn(RECORD_FILE.exec(name));
}

/** The epoch a lease record's name holds, or `undefined` for another name. */
export function epochOfLease(name: string): number | undefined {
  return numberIn(LEASE_FILE.exec(name));
}

/** The paths of one project's files. */
export class ProjectPaths {
  readonly directory: string;
  readonly checkpoints: string;
  readonly states: string;
  readonly journal: string;
  readonly quarantine: string;
  readonly leases: string;

  constructor(project: ProjectId) {
    this.directory = `${PROJECTS_DIRECTORY}/${project}`;
    this.checkpoints = `${this.directory}/checkpoints`;
    this.states = `${this.directory}/states`;
    this.journal = `${this.directory}/journal`;
    this.quarantine = `${this.journal}/${QUARANTINE_DIRECTORY}`;
    this.leases = `${this.directory}/leases`;
  }

  header(slot: PairSlot): string {
    return `${this.directory}/project-${String(slot)}.json`;
  }

  head(slot: PairSlot): string {
    return `${this.directory}/head-${String(slot)}.json`;
  }

  checkpoint(id: CheckpointId): string {
    return `${this.checkpoints}/${id}.json`;
  }

  state(fingerprint: StateFingerprint): string {
    return `${this.states}/${fingerprint}.json`;
  }

  epoch(epoch: number): string {
    return `${this.journal}/e${digits(epoch)}`;
  }

  record(epoch: number, sequence: number): string {
    return `${this.epoch(epoch)}/${digits(sequence)}.json`;
  }

  quarantined(epoch: number, sequence: number): string {
    return `${this.quarantine}/e${digits(epoch)}-${digits(sequence)}.json`;
  }

  lease(epoch: number): string {
    return `${this.leases}/${digits(epoch)}.json`;
  }
}
