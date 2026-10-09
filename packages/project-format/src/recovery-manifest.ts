/**
 * The manifest of a recording session (ADR-0071): what the storage worker
 * writes when a recording starts, beside the chunks it commits, so a session
 * a crash interrupted can be offered for recovery and made into the asset it
 * was for.
 *
 * It states the session, the project, the chunks' sample format (32-bit
 * float, little-endian, interleaved, in the recording's channel order), what
 * is known of the recording as it starts, where its first frame lies on the
 * transport, and what the recording is for: a new take in a stack, a new
 * stack, or a punch over a range of an asset. The chunks themselves say how
 * far it reached. A manifest is part of project storage, so one of another
 * `projectStorage` schema version is refused, never migrated, before 1.0.
 */

import {
  flatMapResult,
  type AssetId,
  type Branded,
  type DomainResult,
  type EditRange,
  type ProjectId,
  type PunchRange,
  type SampleCount,
  type TakeStackId,
} from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import type { JsonObject, JsonValue } from './canonical-json.js';
import { readCompatibleHeader } from './compatibility.js';
import {
  anyObjectOf,
  checkMembers,
  objectOf,
  pathOf,
  required,
  startReading,
  type Converter,
  type Reading,
} from './document-reading.js';
import { readEditRange } from './edit-reading.js';
import { asBasis } from './edit-value-reading.js';
import { readRecordingStart, writeRecordingStart } from './recorded-provenance-json.js';
import type { RecordingStart } from './recorded-provenance.js';
import { asId, oneOfConverter } from './scalar-reading.js';
import { readPunchRange } from './take-stack-reading.js';
import { writePunchRange } from './take-stack-writing.js';
import { asSampleCount } from './value-reading.js';

/** Identifies one recording session: one run of capture, from its start to its end. */
export type RecordingSessionId = Branded<'RecordingSessionId'>;

/** The format name a recording session's manifest carries. */
const RECOVERY_MANIFEST_FORMAT = 'audiogubbins.recovery-chunk-manifest';

/** The sample format every chunk is written in: 32-bit float, little-endian, interleaved. */
export const CHUNK_SAMPLE_FORMAT = 'f32le';

/**
 * What a recording is for, which recovering it carries out as stopping it
 * would: a new take in the stack named, the first take of a new stack, or the
 * first take of a punch over `range` of `asset`, stated at `basis`, the number
 * of the asset's edits the range is placed on.
 */
export type RecordingPurpose =
  | { readonly kind: 'take'; readonly stack: TakeStackId }
  | { readonly kind: 'stack' }
  | {
      readonly kind: 'punch';
      readonly asset: AssetId;
      readonly basis: number;
      readonly range: EditRange;
      readonly punch: PunchRange;
    };

/** A recording session's manifest (see the module comment). */
export interface RecoveryChunkManifest {
  readonly session: RecordingSessionId;
  readonly project: ProjectId;
  readonly sampleFormat: typeof CHUNK_SAMPLE_FORMAT;
  readonly start: RecordingStart;

  /** Where the first recorded frame lies on the transport, at the recording's rate. */
  readonly transportFrame: SampleCount;
  readonly purpose: RecordingPurpose;
}

const MANIFEST_MEMBERS: ReadonlySet<string> = new Set([
  'format',
  'schemaVersion',
  'session',
  'project',
  'sampleFormat',
  'start',
  'transportFrame',
  'purpose',
]);
const TAKE_PURPOSE_MEMBERS: ReadonlySet<string> = new Set(['kind', 'stack']);
const STACK_PURPOSE_MEMBERS: ReadonlySet<string> = new Set(['kind']);
const PUNCH_PURPOSE_MEMBERS: ReadonlySet<string> = new Set([
  'kind',
  'asset',
  'basis',
  'range',
  'punch',
]);

const asPurposeKind = oneOfConverter(['take', 'stack', 'punch'] as const);
const asSampleFormat = oneOfConverter([CHUNK_SAMPLE_FORMAT] as const);

/** Writes what a recording is for. */
function writePurpose(purpose: RecordingPurpose): JsonObject {
  switch (purpose.kind) {
    case 'take':
      return { kind: purpose.kind, stack: purpose.stack };
    case 'stack':
      return { kind: purpose.kind };
    case 'punch':
      return {
        kind: purpose.kind,
        asset: purpose.asset,
        basis: purpose.basis,
        range: { start: purpose.range.start, end: purpose.range.end },
        punch: writePunchRange(purpose.punch),
      };
  }
}

/** Writes a recording session's manifest, with the schema this build writes. */
export function writeRecoveryManifest(manifest: RecoveryChunkManifest): JsonObject {
  return {
    format: RECOVERY_MANIFEST_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.projectStorage,
    session: manifest.session,
    project: manifest.project,
    sampleFormat: manifest.sampleFormat,
    start: writeRecordingStart(manifest.start),
    transportFrame: manifest.transportFrame,
    purpose: writePurpose(manifest.purpose),
  };
}

/** Reads a punch's purpose: the asset, the range at its basis, and the punch. */
function punchPurpose(
  reading: Reading,
  object: JsonObject,
  at: string,
): RecordingPurpose | undefined {
  const asset = required(reading, object, at, 'asset', asId<'AssetId'>);
  const basis = required(reading, object, at, 'basis', asBasis);
  const range = required(reading, object, at, 'range', readEditRange);
  const punch = required(reading, object, at, 'punch', readPunchRange);
  return asset === undefined || basis === undefined || range === undefined || punch === undefined
    ? undefined
    : { kind: 'punch', asset, basis, range, punch };
}

const readPurpose: Converter<RecordingPurpose> = (reading, value, parent, key) => {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const kind = required(reading, object, at, 'kind', asPurposeKind);
  switch (kind) {
    case 'take': {
      checkMembers(reading, object, at, TAKE_PURPOSE_MEMBERS);
      const stack = required(reading, object, at, 'stack', asId<'TakeStackId'>);
      return stack === undefined ? undefined : { kind, stack };
    }
    case 'stack':
      checkMembers(reading, object, at, STACK_PURPOSE_MEMBERS);
      return { kind };
    case 'punch':
      checkMembers(reading, object, at, PUNCH_PURPOSE_MEMBERS);
      return punchPurpose(reading, object, at);
    case undefined:
      return undefined;
  }
};

/**
 * The manifest `value` holds, refusing one of another format or of another
 * `projectStorage` schema version before anything else is read.
 */
export function readRecoveryManifest(value: JsonValue): DomainResult<RecoveryChunkManifest> {
  return flatMapResult(
    readCompatibleHeader(value, RECOVERY_MANIFEST_FORMAT, 'projectStorage'),
    () => {
      const reading = startReading();
      const object = objectOf(reading, value, '', '', MANIFEST_MEMBERS);
      if (object === undefined) return reading.outcome<RecoveryChunkManifest>(undefined);
      const session = required(reading, object, '', 'session', asId<'RecordingSessionId'>);
      const project = required(reading, object, '', 'project', asId<'ProjectId'>);
      const sampleFormat = required(reading, object, '', 'sampleFormat', asSampleFormat);
      const start = required(reading, object, '', 'start', readRecordingStart);
      const transportFrame = required(reading, object, '', 'transportFrame', asSampleCount);
      const purpose = required(reading, object, '', 'purpose', readPurpose);
      return reading.outcome(
        session === undefined ||
          project === undefined ||
          sampleFormat === undefined ||
          start === undefined ||
          transportFrame === undefined ||
          purpose === undefined
          ? undefined
          : { session, project, sampleFormat, start, transportFrame, purpose },
      );
    },
  );
}
