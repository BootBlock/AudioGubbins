/**
 * ITU-T G.711: A-law and µ-law, each sample one companded byte.
 *
 * A byte expands to a 16-bit linear sample by the standard's segment and step:
 * A-law's 13-bit and µ-law's 14-bit magnitudes, shifted to the top of sixteen
 * bits as every common implementation and the ITU's own G.191 tools give them,
 * so full scale is ±32 256 for A-law and ±32 124 for µ-law. The read rule then
 * divides by 2^15 (`decodeCompanded` in the block codings). Both expansions are
 * tables of 256 built once; compression searches the segment ends, rounding
 * each magnitude down to its step as the ITU's encoder in G.191 does.
 */

/** The bits of a G.711 byte: its sign, its three-bit segment and its four-bit step. */
const SIGN_BIT = 0x80;
const SEGMENT_SHIFT = 4;
const SEGMENT_MASK = 0x70;
const STEP_MASK = 0x0f;

/** A-law inverts every even bit of the byte it sends, so a line idles on alternating bits. */
const ALAW_EVEN_BITS = 0x55;

/** µ-law sends its byte inverted, and biases each magnitude by 33 before the segment search. */
const ULAW_INVERSION = 0xff;
const ULAW_BIAS = 0x84;

/** The largest µ-law magnitude, in fourteen-bit steps, below which the segments reach. */
const ULAW_CLIP = 8_159;

/** The last 13-bit magnitude, halved, of each A-law segment. */
const ALAW_SEGMENT_ENDS: readonly number[] = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];

/** The last biased 14-bit magnitude of each µ-law segment. */
const ULAW_SEGMENT_ENDS: readonly number[] = [0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff];

/** The 16-bit linear value of an A-law byte. */
function expandAlaw(byte: number): number {
  const value = byte ^ ALAW_EVEN_BITS;
  const segment = (value & SEGMENT_MASK) >> SEGMENT_SHIFT;
  let magnitude = (value & STEP_MASK) << 4;
  // Segment 0 has no implied leading one; each later one adds it and doubles the step.
  magnitude += segment === 0 ? 8 : 0x108;
  if (segment > 1) magnitude <<= segment - 1;
  return (value & SIGN_BIT) === 0 ? -magnitude : magnitude;
}

/** The 16-bit linear value of a µ-law byte. */
function expandUlaw(byte: number): number {
  const value = byte ^ ULAW_INVERSION;
  const segment = (value & SEGMENT_MASK) >> SEGMENT_SHIFT;
  const biased = (((value & STEP_MASK) << 3) + ULAW_BIAS) << segment;
  return (value & SIGN_BIT) === 0 ? biased - ULAW_BIAS : ULAW_BIAS - biased;
}

/** The 16-bit linear value of each A-law byte. */
export const ALAW_EXPANSION: Readonly<Int16Array> = Int16Array.from({ length: 256 }, (_, byte) =>
  expandAlaw(byte),
);

/** The 16-bit linear value of each µ-law byte. */
export const ULAW_EXPANSION: Readonly<Int16Array> = Int16Array.from({ length: 256 }, (_, byte) =>
  expandUlaw(byte),
);

/** The first segment whose end is at or above `magnitude`, or the count past the last. */
function segmentOf(magnitude: number, ends: readonly number[]): number {
  const found = ends.findIndex((end) => magnitude <= end);
  return found === -1 ? ends.length : found;
}

/**
 * The A-law byte of a 16-bit linear sample. A negative sample's magnitude is
 * its ones' complement, as the ITU's own encoder (G.191) takes it.
 */
export function compressAlaw(linear: number): number {
  const positive = linear >= 0;
  const magnitude = (positive ? linear : ~linear) >> 3;
  const mask = positive ? 0xd5 : ALAW_EVEN_BITS;
  const segment = segmentOf(magnitude, ALAW_SEGMENT_ENDS);
  if (segment >= ALAW_SEGMENT_ENDS.length) return 0x7f ^ mask;
  const step = (magnitude >> (segment < 2 ? 1 : segment)) & STEP_MASK;
  return ((segment << SEGMENT_SHIFT) | step) ^ mask;
}

/**
 * The µ-law byte of a 16-bit linear sample. A negative sample's magnitude is
 * its ones' complement, as the ITU's own encoder (G.191) takes it, so the
 * negative half mirrors the positive one step for step.
 */
export function compressUlaw(linear: number): number {
  const positive = linear >= 0;
  const magnitude = Math.min((positive ? linear : ~linear) >> 2, ULAW_CLIP) + (ULAW_BIAS >> 2);
  const mask = positive ? ULAW_INVERSION : 0x7f;
  const segment = segmentOf(magnitude, ULAW_SEGMENT_ENDS);
  if (segment >= ULAW_SEGMENT_ENDS.length) return 0x7f ^ mask;
  const step = (magnitude >> (segment + 1)) & STEP_MASK;
  return ((segment << SEGMENT_SHIFT) | step) ^ mask;
}
