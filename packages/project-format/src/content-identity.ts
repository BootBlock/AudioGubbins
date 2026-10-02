/**
 * The identifiers the format derives from content: a {@link ContentId} for
 * media bytes, a {@link StateFingerprint} for a project state, and the digest
 * text both are written in.
 *
 * REQ-STOR-099 identifies media by cryptographic content identity rather than
 * by name, and ADR-0020 names a stored state by the digest of its text. Each
 * identifier carries its construction's version as a prefix, so a change of
 * construction is a new prefix and never a silent change of meaning.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type Branded,
  type DomainResult,
} from '@audiogubbins/domain';

/**
 * The identity of a run of bytes: `c1-` and 64 lower-case hexadecimal digits.
 * How the digits are computed is `content-hashing.ts`'s.
 */
export type ContentId = Branded<'ContentId'>;

/**
 * The identity of a project state: `s1-` and 64 lower-case hexadecimal digits,
 * the SHA-256 of its compact canonical document.
 */
export type StateFingerprint = Branded<'StateFingerprint'>;

/** A SHA-256 digest written as 64 lower-case hexadecimal digits. */
export const DIGEST_HEX = /^[0-9a-f]{64}$/u;

const CONTENT_ID = /^c1-[0-9a-f]{64}$/u;
const STATE_FINGERPRINT = /^s1-[0-9a-f]{64}$/u;

/** The two hexadecimal digits of every byte, looked up rather than formatted. */
const HEX_PAIRS: readonly string[] = Array.from({ length: 256 }, (_, byte) =>
  byte.toString(16).padStart(2, '0'),
);

/** Bytes as lower-case hexadecimal, two digits a byte. */
export function hexOf(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += HEX_PAIRS[byte] ?? '';
  return text;
}

/** Whether `text` is shaped like a {@link ContentId}. */
export function isContentId(text: string): boolean {
  return CONTENT_ID.test(text);
}

/** Reads a {@link ContentId} from text, refusing anything of another shape. */
export function contentIdFrom(text: string): DomainResult<ContentId> {
  if (!isContentId(text)) {
    return fail(
      failure(
        'content-id.malformed',
        FailureKind.Rejected,
        'A content identifier is "c1-" followed by 64 lower-case hexadecimal digits.',
        { details: { length: text.length } },
      ),
    );
  }
  return succeed(unsafeBrandId<'ContentId'>(text));
}

/** Whether `text` is shaped like a {@link StateFingerprint}. */
export function isStateFingerprint(text: string): boolean {
  return STATE_FINGERPRINT.test(text);
}

/** Reads a {@link StateFingerprint} from text, refusing anything of another shape. */
export function stateFingerprintFrom(text: string): DomainResult<StateFingerprint> {
  if (!isStateFingerprint(text)) {
    return fail(
      failure(
        'state-fingerprint.malformed',
        FailureKind.Rejected,
        'A state fingerprint is "s1-" followed by 64 lower-case hexadecimal digits.',
        { details: { length: text.length } },
      ),
    );
  }
  return succeed(unsafeBrandId<'StateFingerprint'>(text));
}
