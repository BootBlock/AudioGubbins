/**
 * A WAV's `bext` chunk (EBU Tech 3285) as the broadcast description: fixed
 * fields of NUL-padded text, a 64-bit time reference, a version, a UMID and,
 * from version 2, loudness values, then the coding history to the chunk's end.
 *
 * The UMID and loudness values have no place in the map and are not read. The
 * text fields are read by the package's one rule for untrusted text; the
 * specification says ASCII, which that rule reads unchanged.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import type { BroadcastDescription } from './metadata-map.js';
import { statedFrames } from './metadata-reading.js';
import { LINE_TEXT, LONG_TEXT, decodeText } from './metadata-text.js';

/** The `bext` fields before the coding history, and where each text field lies and how wide it is. */
export const BEXT_FIXED_BYTES = 602;
export const BEXT_TEXT_FIELDS = {
  description: [0, 256],
  originator: [256, 32],
  originatorReference: [288, 32],
  originationDate: [320, 10],
  originationTime: [330, 8],
} as const;

/** Where the time reference's low and high words lie, and the version after them. */
export const BEXT_TIME_REFERENCE = 338;
export const BEXT_VERSION_OFFSET = 346;

/** Reads a `bext` chunk's body. */
export function readBroadcast(body: Uint8Array): DomainResult<BroadcastDescription> {
  if (body.length < BEXT_FIXED_BYTES) {
    return fail(
      malformed(
        `The 'bext' chunk is shorter than the ${String(BEXT_FIXED_BYTES)} bytes of its fields.`,
      ),
    );
  }
  const view = viewOf(body);
  const low = view.getUint32(BEXT_TIME_REFERENCE, true);
  const high = view.getUint32(BEXT_TIME_REFERENCE + 4, true);
  const timeReference = statedFrames(high * 2 ** 32 + low, "'bext' chunk's time reference");
  if (!timeReference.ok) return timeReference;
  const field = ([offset, width]: readonly [number, number]) =>
    decodeText(body.subarray(offset, offset + width), LINE_TEXT);
  return succeed({
    description: field(BEXT_TEXT_FIELDS.description),
    originator: field(BEXT_TEXT_FIELDS.originator),
    originatorReference: field(BEXT_TEXT_FIELDS.originatorReference),
    originationDate: field(BEXT_TEXT_FIELDS.originationDate),
    originationTime: field(BEXT_TEXT_FIELDS.originationTime),
    timeReference: timeReference.value,
    codingHistory: decodeText(body.subarray(BEXT_FIXED_BYTES), LONG_TEXT),
  });
}
