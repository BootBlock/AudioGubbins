/**
 * The one rule that turns a sample into an integer of a given depth (ADR-0092).
 *
 * It is the inverse of the read rule (ADR-0052): an integer `k` of `bits` bits
 * reads as `k / 2^(bits-1)`, and that value quantises back to `k`, so a round
 * trip through any integer depth is exact. The dither and its noise shaping
 * feed back the error of this rule, and the writers apply it, so the two must
 * never differ: both call this function.
 */

/**
 * The integer of `bits` bits (4 to 32) nearest `value × 2^(bits-1)`, a tie
 * going to the even integer, clamped to the depth's range. Not-a-number
 * quantises to zero. Every step is exact or correctly rounded IEEE-754
 * arithmetic, so every machine gives the same integer.
 */
export function quantiseSample(value: number, bits: number): number {
  if (Number.isNaN(value)) return 0;
  const scale = 2 ** (bits - 1);
  const scaled = value * scale;
  let nearest = Math.round(scaled);
  // Math.round sends every tie upwards; a tie whose upward neighbour is odd goes down instead.
  if (nearest - scaled === 0.5 && nearest % 2 !== 0) nearest -= 1;
  if (nearest > scale - 1) return scale - 1;
  if (nearest < -scale) return -scale;
  return nearest;
}
