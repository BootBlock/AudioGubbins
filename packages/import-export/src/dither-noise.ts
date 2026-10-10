/**
 * The dither's random numbers: a counter-based generator, so a draw is a
 * function of its key, its channel and its place, never of what was drawn
 * before (REQ-ARCH-049).
 *
 * Each draw hashes the key, the channel and the draw's index, split into the
 * two 32-bit halves of a 53-bit count, through `lowbias32`, Chris Wellons'
 * 32-bit integer hash (public domain), one round per word. Every step is
 * 32-bit integer arithmetic, so every machine draws the same numbers, and a
 * draw anywhere in a long export costs what the first one does, so the block
 * an export is rendered in cannot change a bit of it.
 */

const GOLDEN = 0x9e37_79b9;
const TWO_TO_32 = 2 ** 32;

function lowbias32(input: number): number {
  let x = input >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb_352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846c_a68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Draw `index` of `channel` under `key`, uniform in `[0, 1)`, a multiple of 2⁻³². */
export function uniformDraw(key: number, channel: number, index: number): number {
  const high = Math.floor(index / TWO_TO_32);
  const low = index - high * TWO_TO_32;
  let hash = lowbias32(key ^ Math.imul(channel + 1, GOLDEN));
  hash = lowbias32(hash ^ high);
  hash = lowbias32(hash ^ low);
  return hash / TWO_TO_32;
}
