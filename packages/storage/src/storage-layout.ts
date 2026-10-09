/**
 * Where the storage keeps each thing in the tree, and how the numbered names it
 * writes are read back (ADR-0020, REQ-STOR-025, REQ-STOR-101).
 *
 * - `storage.json`: the storage root.
 * - `projects/<project>/project-0.json` and `project-1.json`: the project's
 *   header, a pair rewritten by turns (`generational-pair.ts`).
 * - `projects/<project>/heads/<epoch>-<generation>.json`: a commit point,
 *   written once by the writer of its lease epoch (`project-heads.ts`).
 * - `projects/<project>/checkpoints/<epoch>-<id>.json`: a checkpoint, named by
 *   the lease epoch it was written under.
 * - `projects/<project>/segments/<epoch>-<id>.json`: a segment of the
 *   project's history, named by the lease epoch it was written under
 *   (`segment-ledger.ts`).
 * - `projects/<project>/states/<fingerprint>.json`: a state.
 * - `projects/<project>/journal/e<epoch>/<sequence>.json`: a journal record.
 * - `projects/<project>/journal/quarantine/e<epoch>-<sequence>.json`: a record
 *   set aside rather than deleted.
 * - `projects/<project>/leases/<epoch>.json`: the write lease's epoch and
 *   seals.
 * - `projects/<project>/unfinished`: present while a project is being made,
 *   until its header is written.
 * - `projects/<project>/recordings/<session>/manifest-0.json` and
 *   `manifest-1.json`: a recording session's manifest, a pair written when the
 *   session starts and rewritten once when its capture ends
 *   (`recording-manifests.ts`).
 * - `projects/<project>/recordings/<session>/chunks/<frame>`: a second at most
 *   of the session's audio, named by the frame of the recording it starts at
 *   (`recording-chunks.ts`).
 * - `projects/<project>/recordings/<session>/gaps/<frame>-<frames>`: an empty
 *   file saying the frames from `frame` on were lost and written as silence.
 * - `backups/<project>/<generation>/`: a backup generation
 *   (`backup-generations.ts`).
 * - `cache/<category>/<scope>/<name>`: a disposable cache (`cache-store.ts`).
 * - `media/`: the media object store every project shares, which the
 *   composition root makes over this directory.
 * - `packs/<id>/<version>/`: an installed model pack, or one being installed
 *   (`model-pack-store.ts`).
 * - `library/<entry>/entry-0.json` and `entry-1.json`: an entry of the
 *   person's library of saved chains and presets, a pair rewritten by turns
 *   (`library-entry-files.ts`).
 *
 * Epochs and sequence numbers are written as twelve decimal digits, so a
 * directory listed in name order is listed in number order.
 */

import type { Branded, ProjectId } from '@audiogubbins/domain';
import type { HistorySegmentReference, RecordingSessionId } from '@audiogubbins/project-format';

/** The storage root's file. */
export const STORAGE_ROOT_FILE = 'storage.json';

/** The directory every project is kept under. */
export const PROJECTS_DIRECTORY = 'projects';

/** The directory every project's backup generations are kept under. */
export const BACKUPS_DIRECTORY = 'backups';

/** The directory every cache is kept under. */
export const CACHE_DIRECTORY = 'cache';

/** The directory the shared media object store is kept under. */
export const MEDIA_DIRECTORY = 'media';

/** The directory every model pack is kept under. */
export const PACKS_DIRECTORY = 'packs';

/** The directory the person's library of saved chains and presets is kept under. */
export const LIBRARY_DIRECTORY = 'library';

/** One of the two files of a pair that is rewritten by turns. */
export type PairSlot = 0 | 1;

/** Identifies a checkpoint of a project. */
export type CheckpointId = Branded<'CheckpointId'>;

const DIGITS = 12;
const EPOCH_DIRECTORY = /^e([0-9]{12})$/u;
const RECORD_FILE = /^([0-9]{12})\.json$/u;
const LEASE_FILE = /^([0-9]{12})\.json$/u;
const HEAD_FILE = /^([0-9]{12})-([0-9]{12})\.json$/u;
/** A checkpoint's or a segment's file: the epoch it was written under, then its id. */
const EPOCH_NAMED_FILE = /^([0-9]{12})-(.+)\.json$/u;
const GENERATION_DIRECTORY = /^([0-9]{12})$/u;
const CHUNK_FILE = /^([0-9]{12})$/u;
const GAP_FILE = /^([0-9]{12})-([0-9]{12})$/u;
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

/** The lease epoch and generation a head's name holds, or `undefined` for another name. */
export function headOfName(
  name: string,
): { readonly epoch: number; readonly generation: number } | undefined {
  const match = HEAD_FILE.exec(name);
  const epoch = match?.[1];
  const generation = match?.[2];
  return epoch === undefined || generation === undefined
    ? undefined
    : { epoch: Number(epoch), generation: Number(generation) };
}

/** The lease epoch a checkpoint's name holds, or `undefined` for another name. */
export function epochOfCheckpoint(name: string): number | undefined {
  return numberIn(EPOCH_NAMED_FILE.exec(name));
}

/** The lease epoch a segment's name holds, or `undefined` for another name. */
export function epochOfSegment(name: string): number | undefined {
  return numberIn(EPOCH_NAMED_FILE.exec(name));
}

/** The name of a segment's file. */
export function segmentName(segment: HistorySegmentReference): string {
  return `${digits(segment.epoch)}-${segment.id}.json`;
}

/** The number a backup generation's directory holds, or `undefined` for another name. */
export function numberOfGeneration(name: string): number | undefined {
  return numberIn(GENERATION_DIRECTORY.exec(name));
}

/** The first frame a recording's chunk starts at, or `undefined` for a name that is no chunk's. */
export function frameOfChunk(name: string): number | undefined {
  return numberIn(CHUNK_FILE.exec(name));
}

/** The frames a gap marker's name says were lost, or `undefined` for another name. */
export function gapOfName(
  name: string,
): { readonly frame: number; readonly frames: number } | undefined {
  const match = GAP_FILE.exec(name);
  const frame = match?.[1];
  const frames = match?.[2];
  return frame === undefined || frames === undefined
    ? undefined
    : { frame: Number(frame), frames: Number(frames) };
}

/** The paths of one project's files. */
export class ProjectPaths {
  readonly directory: string;
  readonly heads: string;
  readonly checkpoints: string;
  readonly segments: string;
  readonly states: string;
  readonly journal: string;
  readonly quarantine: string;
  readonly leases: string;

  /** Present while the project is being made, until its header is written. */
  readonly unfinished: string;

  /** Every recording session the project has that is not yet an asset. */
  readonly recordings: string;

  constructor(project: ProjectId) {
    this.directory = `${PROJECTS_DIRECTORY}/${project}`;
    this.heads = `${this.directory}/heads`;
    this.checkpoints = `${this.directory}/checkpoints`;
    this.segments = `${this.directory}/segments`;
    this.states = `${this.directory}/states`;
    this.journal = `${this.directory}/journal`;
    this.quarantine = `${this.journal}/${QUARANTINE_DIRECTORY}`;
    this.leases = `${this.directory}/leases`;
    this.unfinished = `${this.directory}/unfinished`;
    this.recordings = `${this.directory}/recordings`;
  }

  header(slot: PairSlot): string {
    return `${this.directory}/project-${String(slot)}.json`;
  }

  head(epoch: number, generation: number): string {
    return `${this.heads}/${digits(epoch)}-${digits(generation)}.json`;
  }

  checkpoint(epoch: number, id: CheckpointId): string {
    return `${this.checkpoints}/${digits(epoch)}-${id}.json`;
  }

  segment(segment: HistorySegmentReference): string {
    return `${this.segments}/${segmentName(segment)}`;
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

/** The paths of one recording session's files. */
export class RecordingPaths {
  readonly directory: string;
  readonly chunks: string;
  readonly gaps: string;

  constructor(paths: ProjectPaths, session: RecordingSessionId) {
    this.directory = `${paths.recordings}/${session}`;
    this.chunks = `${this.directory}/chunks`;
    this.gaps = `${this.directory}/gaps`;
  }

  manifest(slot: PairSlot): string {
    return `${this.directory}/manifest-${String(slot)}.json`;
  }

  /** The chunk that starts at frame `frame` of the recording. */
  chunk(frame: number): string {
    return `${this.chunks}/${digits(frame)}`;
  }

  /** The marker of `frames` frames lost from frame `frame` of the recording on. */
  gap(frame: number, frames: number): string {
    return `${this.gaps}/${digits(frame)}-${digits(frames)}`;
  }
}

/** The paths of one project's backup generations. */
export class BackupPaths {
  readonly directory: string;

  constructor(project: ProjectId) {
    this.directory = `${BACKUPS_DIRECTORY}/${project}`;
  }

  generation(generation: number): string {
    return `${this.directory}/${digits(generation)}`;
  }

  /** The record that makes a generation whole and says what it is, written last. */
  record(generation: number): string {
    return `${this.generation(generation)}/generation.json`;
  }

  /** The copy of the checkpoint a generation holds. */
  checkpoint(generation: number): string {
    return `${this.generation(generation)}/checkpoint.json`;
  }

  /** The segments of the history a generation's checkpoint holds. */
  segments(generation: number): string {
    return `${this.generation(generation)}/segments`;
  }

  /** A segment of the history a generation's checkpoint holds. */
  segment(generation: number, segment: HistorySegmentReference): string {
    return `${this.segments(generation)}/${segmentName(segment)}`;
  }

  /** The states a generation keeps. */
  states(generation: number): string {
    return `${this.generation(generation)}/states`;
  }

  /** Present while the generation is protected from pruning. */
  protection(generation: number): string {
    return `${this.generation(generation)}/protected`;
  }
}
