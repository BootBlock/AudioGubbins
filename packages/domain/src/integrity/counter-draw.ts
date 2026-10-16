/**
 * The one generator of random numbers: a counter-based draw, so a draw is a
 * function of its key, its stream and its index, never of what was drawn
 * before (REQ-ARCH-049). An export's dither draws one stream a channel
 * (ADR-0092), and the game preview one stream a decision (ADR-0104); it lives
 * in the domain, which depends on nothing, so both draw from this one.
 *
 * Each draw hashes the key, the stream and the index, split into the two
 * 32-bit halves of a 53-bit count, through `lowbias32`, one round per word.
 * Every step is 32-bit integer arithmetic, so every machine draws the same
 * numbers, and a draw anywhere in a long export costs what the first one does,
 * so the block an export is rendered in cannot change a bit of it. A changed
 * draw changes the bytes of every dithered export, which are pinned.
 */

/** 2³² ÷ φ, spreading consecutive streams across the key's bits. */
const GOLDEN = 0x9e37_79b9;
const TWO_TO_32 = 2 ** 32;

/**
 * Chris Wellons' `lowbias32` 32-bit integer hash (public domain): `input` taken
 * as an unsigned 32-bit word, hashed to an unsigned 32-bit word.
 */
export function lowbias32(input: number): number {
  let x = input >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb_352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846c_a68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Draw `index` (a whole number below 2⁵³) of `stream` under `key`, uniform in
 * `[0, 1)`, a multiple of 2⁻³².
 */
export function uniformDraw(key: number, stream: number, index: number): number {
  const high = Math.floor(index / TWO_TO_32);
  const low = index - high * TWO_TO_32;
  let hash = lowbias32(key ^ Math.imul(stream + 1, GOLDEN));
  hash = lowbias32(hash ^ high);
  hash = lowbias32(hash ^ low);
  return hash / TWO_TO_32;
}
