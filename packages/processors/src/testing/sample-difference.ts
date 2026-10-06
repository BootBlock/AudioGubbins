/**
 * How far one render's samples are from another's, for a test that holds a
 * processor's output to what it must be.
 */

/**
 * The largest difference between two renders' samples, channel by channel,
 * or infinity where they differ in channels or a channel in length, so a
 * render that lost or gained samples is never within a tolerance.
 */
export function largestDifference(
  left: readonly Float32Array[],
  right: readonly Float32Array[],
): number {
  if (left.length !== right.length) return Infinity;
  let most = 0;
  for (const [channel, samples] of left.entries()) {
    const other = right[channel];
    if (other?.length !== samples.length) return Infinity;
    for (const [frame, sample] of samples.entries()) {
      most = Math.max(most, Math.abs(sample - (other[frame] ?? Number.NaN)));
    }
  }
  return Number.isNaN(most) ? Infinity : most;
}
