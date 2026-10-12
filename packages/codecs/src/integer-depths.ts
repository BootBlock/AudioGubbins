/**
 * The integer depths each family of formats holds, the one statement of them
 * that the readers, the writers and the export settings' validation share
 * (ADR-0091, ADR-0092).
 *
 * WAV, AIFF and AIFF-C hold integer PCM of every depth from 8 to 32 bits, each
 * sample left-justified in the next whole byte; FLAC's stream information
 * states every depth from 4 to 32 (RFC 9639, section 8.2), and the codec
 * module encodes each of them.
 */

/** A run of whole bit depths, both ends included. */
export interface IntegerDepths {
  readonly lowest: number;
  readonly highest: number;
}

/** Integer PCM in WAV, AIFF and AIFF-C. */
export const PCM_INTEGER_DEPTHS: IntegerDepths = { lowest: 8, highest: 32 };

/** FLAC's samples. */
export const FLAC_DEPTHS: IntegerDepths = { lowest: 4, highest: 32 };

/** Whether `bits` is a whole depth within `depths`. */
export function holdsDepth(depths: IntegerDepths, bits: number): boolean {
  return Number.isInteger(bits) && bits >= depths.lowest && bits <= depths.highest;
}

/** The whole bytes a sample of `bits` bits is stored in. */
export function containerBytes(bits: number): number {
  return Math.ceil(bits / 8);
}
