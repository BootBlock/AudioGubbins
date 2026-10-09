/**
 * A recording session's manifest as it is kept: a pair of checked records
 * (`generational-pair.ts`), written when the session starts and rewritten once
 * when its capture ends (ADR-0071).
 *
 * The rewrite goes to the other file of the pair, so a crash that tears it
 * leaves the manifest the session started with, and the chunks it names stay
 * recoverable: a manifest rewritten in place could take a whole recording
 * with it.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import {
  objectOf,
  pathOf,
  readRecoveryManifest,
  required,
  writeRecoveryManifest,
  type Converter,
  type RecoveryChunkManifest,
} from '@audiogubbins/project-format';

import { RecordKind, type CheckedRecords, type RecordFault } from './checked-records.js';
import {
  readPair,
  writeNext,
  type Generational,
  type PairFiles,
  type PairReading,
} from './generational-pair.js';
import { asCountingNumber } from './record-values.js';
import type { RecordingPaths } from './storage-layout.js';

/** A manifest as one file of the pair holds it, with the generation that orders the two. */
export interface ManifestRecord extends Generational {
  readonly manifest: RecoveryChunkManifest;
}

const RECORD_MEMBERS: ReadonlySet<string> = new Set(['generation', 'manifest']);

/** The manifest the format reads, its failures recorded where it is kept. */
const asManifest: Converter<RecoveryChunkManifest> = (reading, value, parent, key) => {
  const read = readRecoveryManifest(value);
  if (read.ok) return read.value;
  reading.refuseAll(read.failures, pathOf(parent, key));
  return undefined;
};

const readManifestRecord: Converter<ManifestRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RECORD_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const generation = required(reading, object, at, 'generation', asCountingNumber);
  const manifest = required(reading, object, at, 'manifest', asManifest);
  return generation === undefined || manifest === undefined ? undefined : { generation, manifest };
};

function manifestFiles(paths: RecordingPaths): PairFiles<ManifestRecord> {
  return {
    path: (slot) => paths.manifest(slot),
    kind: RecordKind.RecordingManifest,
    convert: readManifestRecord,
  };
}

/**
 * A recording session's files: its manifest as last written or read, where
 * its files lie, and the records they are written through.
 */
export interface RecordingFiles {
  readonly manifest: RecoveryChunkManifest;
  readonly paths: RecordingPaths;
  readonly records: CheckedRecords;

  /** The manifest's pair as it stands, which a rewrite goes past. */
  readonly pair: PairReading<ManifestRecord>;
}

/** What reading a session's manifest found. */
export type ManifestReading =
  | {
      readonly kind: 'valid';
      readonly manifest: RecoveryChunkManifest;
      /** Both files as read, which the rewrite goes past. */
      readonly pair: PairReading<ManifestRecord>;
    }
  /** Neither file holds a manifest: a session whose start was cut short before any chunk. */
  | { readonly kind: 'absent'; readonly faults: readonly RecordFault[] };

/** The newest manifest of the session at `paths`. */
export async function readManifest(
  records: CheckedRecords,
  paths: RecordingPaths,
  signal?: AbortSignal,
): Promise<ManifestReading> {
  const pair = await readPair(records, manifestFiles(paths), signal);
  const newest = pair.valid[0];
  return newest === undefined
    ? { kind: 'absent', faults: pair.faults.map(({ fault }) => fault) }
    : { kind: 'valid', manifest: newest.value.manifest, pair };
}

/**
 * Writes `manifest` as the session's newest, past `current` where the session
 * has one, and confirms it by reading it back.
 */
export async function writeManifest(
  records: CheckedRecords,
  paths: RecordingPaths,
  manifest: RecoveryChunkManifest,
  current: PairReading<ManifestRecord> = { valid: [], faults: [] },
  signal?: AbortSignal,
): Promise<DomainResult<PairReading<ManifestRecord>>> {
  const written = await writeNext(
    records,
    manifestFiles(paths),
    current,
    (generation) => ({ generation, manifest: writeRecoveryManifest(manifest) }),
    signal,
  );
  return mapResult(written, (slotted) => ({ valid: [slotted], faults: [] }));
}
