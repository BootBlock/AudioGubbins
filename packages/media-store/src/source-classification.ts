/**
 * What became of an external source since it was recorded: the one home of the
 * rule (REQ-STOR-104), which the change policy then acts on (REQ-STOR-053,
 * `source-resolution.ts`).
 *
 * The file looked for at the recorded place, through the kept handle or the
 * relative path, is the observation; a file found anywhere else, picked by the
 * user or turned up by a search, is a candidate. Both are identities made by
 * `observeFile`, so they compare signal for signal with the recorded one:
 *
 * - Same content: the lengths are equal and, where both identities carry a
 *   full content identity, those are equal, which is proof; where either lacks
 *   one, the fast fingerprints are equal, which is a sampling and reported as
 *   such. Where both carry one, a difference in it is decisive whatever the
 *   fingerprints say.
 * - `unchanged`: the observation has the same content.
 * - `relinked-identical`: it has not, or is absent, and the candidate has the
 *   same content.
 * - `missing`: it is absent, with the reason as data, and no candidate has the
 *   same content.
 * - `modified`: it differs in content but not in kind: the same container, by
 *   its signature, and the same media type. An edit of the file keeps both.
 * - `replaced`: it differs in kind, so another file stands in its place.
 *
 * The modification time never decides: an unchanged file may be touched and a
 * changed one may keep its time. It is reported with the other signals.
 */

import type { ExternalSourceIdentity } from '@audiogubbins/project-format';

/** Why nothing could be read at the recorded place. */
export type AbsenceReason = 'not-found' | 'permission-refused' | 'unreadable';

/** What stands at the recorded place of an external source. */
export type SourceObservation =
  | { readonly kind: 'present'; readonly file: ExternalSourceIdentity }
  | { readonly kind: 'absent'; readonly reason: AbsenceReason };

/** How one signal of two identities compares; `unknown` where either lacks it. */
export type SignalMatch = 'same' | 'different' | 'unknown';

/** How every signal of an identity compares with the recorded one's. */
export interface SignalEvidence {
  readonly byteLength: SignalMatch;
  readonly fastFingerprint: SignalMatch;
  readonly contentId: SignalMatch;
  readonly containerKind: SignalMatch;
  readonly mediaType: SignalMatch;
  readonly lastModified: SignalMatch;
  readonly handleKey: SignalMatch;
  readonly relativePath: SignalMatch;
}

/**
 * How sure a match of content is: `content-identity` where the full content
 * identities are equal, `sampled` where only the length and the fast
 * fingerprint are.
 */
export type MatchConfidence = 'content-identity' | 'sampled';

/** What became of an external source. */
export type SourceClassification =
  | {
      readonly kind: 'unchanged';
      readonly confidence: MatchConfidence;
      readonly evidence: SignalEvidence;
    }
  | { readonly kind: 'modified'; readonly evidence: SignalEvidence }
  | { readonly kind: 'replaced'; readonly evidence: SignalEvidence }
  | {
      readonly kind: 'relinked-identical';
      readonly confidence: MatchConfidence;
      readonly candidate: ExternalSourceIdentity;
      readonly evidence: SignalEvidence;
    }
  | { readonly kind: 'missing'; readonly reason: AbsenceReason };

/**
 * The containers whose magic is followed by a length, which an edit changes,
 * and then a form word at bytes 8 to 12 that says what the container holds:
 * `RIFF`, `RIFX`, `RF64` and `FORM`.
 */
const SIZED_CONTAINERS: ReadonlySet<string> = new Set([
  '52494646',
  '52494658',
  '52463634',
  '464f524d',
]);

/** `ftyp` at bytes 4 to 8, after a box length: the ISO base media format. */
const ISO_BOX = '66747970';

/** `ID3`, followed by a version byte a tag editor may change. */
const ID3_TAG = '494433';

/**
 * An MPEG audio or ADTS frame header: eleven set sync bits, then bits that
 * vary with the bit rate from frame to frame.
 */
const FRAME_SYNC = /^ff[ef]/u;

/** Classifies an external source (see the module comment). */
export function classifySource(
  recorded: ExternalSourceIdentity,
  observation: SourceObservation,
  candidate?: ExternalSourceIdentity,
): SourceClassification {
  if (observation.kind === 'present') {
    const evidence = evidenceOf(recorded, observation.file);
    const confidence = contentMatch(evidence);
    if (confidence !== undefined) return { kind: 'unchanged', confidence, evidence };
  }
  if (candidate !== undefined) {
    const evidence = evidenceOf(recorded, candidate);
    const confidence = contentMatch(evidence);
    if (confidence !== undefined) {
      return { kind: 'relinked-identical', confidence, candidate, evidence };
    }
  }
  if (observation.kind === 'absent') return { kind: 'missing', reason: observation.reason };

  const evidence = evidenceOf(recorded, observation.file);
  return evidence.containerKind === 'same' && evidence.mediaType === 'same'
    ? { kind: 'modified', evidence }
    : { kind: 'replaced', evidence };
}

function evidenceOf(
  recorded: ExternalSourceIdentity,
  found: ExternalSourceIdentity,
): SignalEvidence {
  return {
    byteLength: matchOf(recorded.byteLength, found.byteLength),
    fastFingerprint: matchOf(recorded.fastFingerprint, found.fastFingerprint),
    contentId: matchOf(recorded.contentId, found.contentId),
    containerKind: matchOf(containerKindOf(recorded.signature), containerKindOf(found.signature)),
    mediaType: matchOf(recorded.mediaType, found.mediaType),
    lastModified: matchOf(recorded.lastModified, found.lastModified),
    handleKey: matchOf(recorded.handleKey, found.handleKey),
    relativePath: matchOf(recorded.relativePath, found.relativePath),
  };
}

function contentMatch(evidence: SignalEvidence): MatchConfidence | undefined {
  if (evidence.byteLength !== 'same') return undefined;
  if (evidence.contentId !== 'unknown') {
    return evidence.contentId === 'same' ? 'content-identity' : undefined;
  }
  return evidence.fastFingerprint === 'same' ? 'sampled' : undefined;
}

function matchOf<TSignal extends string | number>(
  recorded: TSignal | undefined,
  found: TSignal | undefined,
): SignalMatch {
  if (recorded === undefined || found === undefined) return 'unknown';
  return recorded === found ? 'same' : 'different';
}

/**
 * The kind of container a signature shows, without the bytes an edit of the
 * same file changes: a sized container's length, a tag's version and a frame
 * header's rate. Any other signature is known by its first four bytes.
 */
function containerKindOf(signature: string): string {
  const magic = signature.slice(0, 8);
  if (SIZED_CONTAINERS.has(magic)) return `${magic}:${signature.slice(16, 24)}`;
  if (signature.slice(8, 16) === ISO_BOX) return ISO_BOX;
  if (signature.startsWith(ID3_TAG)) return ID3_TAG;
  if (FRAME_SYNC.test(signature)) return 'frame-sync';
  return magic;
}
