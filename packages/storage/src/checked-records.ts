/**
 * The record every storage file but a state is written as: an envelope that
 * says what the file is, which schema wrote it, and the digest of what it holds
 * (ADR-0020, REQ-STOR-101, REQ-EXEC-136.12).
 *
 * The tree has no atomic write, so a crash may leave any file torn. A record is
 * the compact canonical JSON of
 * `{ "body", "checksum", "kind", "schemaVersion" }`, where the checksum is the
 * SHA-256 of the body's own canonical text. Reading checks, in order, that the
 * file is JSON of exactly that shape, that it is of the kind expected, that its
 * schema version is this build's by project-format's one rule
 * (`projectStorage`), that the checksum matches, and that the body reads
 * through its converter. A file failing any check reads as invalid with the
 * reason, never as data, so a torn or foreign file is reported rather than
 * trusted.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  canonicalJson,
  canonicalJsonWithin,
  compatibilityOf,
  decodeUtf8,
  encodeUtf8,
  hexOf,
  isJsonObject,
  memberOf,
  parseJson,
  startReading,
  DIGEST_HEX,
  type Converter,
  type Digest,
  type JsonLimits,
  type JsonValue,
  type StorageTree,
} from '@audiogubbins/project-format';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { recordTooLarge } from './storage-failures.js';

/** What a record is, written in its envelope. */
export const RecordKind = {
  StorageRoot: 'storage-root',
  ProjectHeader: 'project-header',
  ProjectHead: 'project-head',
  Checkpoint: 'checkpoint',
  HistorySegment: 'history-segment',
  JournalRecord: 'journal-record',
  Lease: 'lease',
  CacheSeal: 'cache-seal',
  BackupGeneration: 'backup-generation',
  PackManifest: 'pack-manifest',
  PackSeal: 'pack-seal',
} as const;

/** What a record is, written in its envelope. */
export type RecordKind = (typeof RecordKind)[keyof typeof RecordKind];

/**
 * Why a file is not a valid record.
 *
 * - `damaged`: not UTF-8, not JSON, or not an envelope: torn, as a rule.
 * - `foreign`: a record of another kind than the one expected.
 * - `incompatible`: written with another `projectStorage` schema version.
 * - `checksum-mismatch`: the body is not the one the checksum was taken of.
 * - `malformed`: the body is not what a record of its kind holds.
 */
export type RecordFault =
  | { readonly kind: 'damaged'; readonly cause: DomainFailure }
  | { readonly kind: 'foreign'; readonly found: string }
  | { readonly kind: 'incompatible'; readonly found: number; readonly current: number }
  | { readonly kind: 'checksum-mismatch' }
  | { readonly kind: 'malformed'; readonly failures: readonly DomainFailure[] };

/** What reading a record found. */
export type CheckedReading<TValue> =
  | { readonly kind: 'valid'; readonly value: TValue }
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly fault: RecordFault };

/**
 * The bounds a record's text is read within: the project document's, since a
 * journal record can carry a change whose arguments are as long as a document
 * may be, and a checkpoint a whole history.
 */
const RECORD_LIMITS: JsonLimits = { maximumLength: 2 ** 28, maximumDepth: 32 };

/** A checksum's text, standing in for one when an envelope is measured. */
const ANY_CHECKSUM = '0'.repeat(64);

const ENVELOPE_MEMBERS: ReadonlySet<string> = new Set([
  'body',
  'checksum',
  'kind',
  'schemaVersion',
]);

const ABSENT: CheckedReading<never> = { kind: 'absent' };

/** An envelope read, before its checksum and body are checked. */
interface Envelope {
  readonly kind: string;
  readonly schemaVersion: number;
  readonly checksum: string;
  readonly body: JsonValue;
}

/** Writes and reads checked records through one tree with one digest. */
export class CheckedRecords {
  readonly tree: StorageTree;
  readonly digest: Digest;

  constructor(tree: StorageTree, digest: Digest) {
    this.tree = tree;
    this.digest = digest;
  }

  /**
   * Writes a record of `kind` holding `body` at `path`, replacing any there.
   * Refuses, as `storage.record-too-large`, what the reader could not read
   * back, and writes nothing then: a checkpoint written past the reader's
   * bounds would stand in for the ones it replaced and never open.
   */
  async write(
    path: string,
    kind: RecordKind,
    body: JsonValue,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    // The envelope holds the body one level down, and its own members take a
    // length that does not depend on the body, so the body's bounds are the
    // record's less the envelope's.
    const within = canonicalJsonWithin(body, {
      maximumLength: RECORD_LIMITS.maximumLength - envelopeText('', ANY_CHECKSUM, kind).length,
      maximumDepth: RECORD_LIMITS.maximumDepth - 1,
    });
    if (!within.ok) return fail(recordTooLarge(kind, within.failures[0]));
    const checksum = hexOf(await this.digest(encodeUtf8(within.value)));
    await this.tree.writeFile(path, encodeUtf8(envelopeText(within.value, checksum, kind)), signal);
    return succeed(undefined);
  }

  /** Reads the record at `path`, expecting `kind`, and its body through `convert`. */
  async read<TValue>(
    path: string,
    kind: RecordKind,
    convert: Converter<TValue>,
    signal?: AbortSignal,
  ): Promise<CheckedReading<TValue>> {
    const bytes = await this.tree.readFile(path, signal);
    if (bytes === undefined) return ABSENT;

    const envelope = envelopeOf(bytes);
    if (!('body' in envelope)) return { kind: 'invalid', fault: envelope };
    if (envelope.kind !== kind)
      return { kind: 'invalid', fault: { kind: 'foreign', found: envelope.kind } };

    const verdict = compatibilityOf(envelope.schemaVersion, 'projectStorage');
    if (verdict.kind === 'incompatible') {
      return {
        kind: 'invalid',
        fault: { kind: 'incompatible', found: verdict.found, current: verdict.current },
      };
    }

    const bodyText = canonicalJson(envelope.body);
    if (hexOf(await this.digest(encodeUtf8(bodyText))) !== envelope.checksum) {
      return { kind: 'invalid', fault: { kind: 'checksum-mismatch' } };
    }

    const reading = startReading();
    const value = convert(reading, envelope.body, '', 'body');
    const outcome = reading.outcome(value);
    return outcome.ok
      ? { kind: 'valid', value: outcome.value }
      : { kind: 'invalid', fault: { kind: 'malformed', failures: outcome.failures } };
  }
}

/** The envelope the bytes hold, or why they hold none. */
function envelopeOf(bytes: Uint8Array): Envelope | RecordFault {
  const text = decodeUtf8(bytes);
  if (!text.ok) return { kind: 'damaged', cause: text.failures[0] };
  const parsed = parseJson(text.value, RECORD_LIMITS);
  if (!parsed.ok) return { kind: 'damaged', cause: parsed.failures[0] };

  const value = parsed.value;
  if (!isJsonObject(value) || Object.keys(value).some((key) => !ENVELOPE_MEMBERS.has(key))) {
    return notAnEnvelope();
  }
  const kind = memberOf(value, 'kind');
  const schemaVersion = memberOf(value, 'schemaVersion');
  const checksum = memberOf(value, 'checksum');
  const body = memberOf(value, 'body');
  if (
    typeof kind !== 'string' ||
    typeof schemaVersion !== 'number' ||
    !Number.isSafeInteger(schemaVersion) ||
    typeof checksum !== 'string' ||
    !DIGEST_HEX.test(checksum) ||
    body === undefined
  ) {
    return notAnEnvelope();
  }
  return { kind, schemaVersion, checksum, body };
}

/**
 * The envelope's canonical text, written from the body's rather than by
 * serialising the body a second time: the members are in canonical order and
 * the scalars are written as canonical JSON writes them.
 */
function envelopeText(bodyText: string, checksum: string, kind: RecordKind): string {
  return `{"body":${bodyText},"checksum":"${checksum}","kind":${canonicalJson(kind)},"schemaVersion":${String(SCHEMA_VERSIONS.projectStorage)}}`;
}

function notAnEnvelope(): RecordFault {
  return {
    kind: 'damaged',
    cause: failure(
      'storage.not-a-record',
      FailureKind.IntegrityViolation,
      'The file is JSON, but not a storage record.',
    ),
  };
}
