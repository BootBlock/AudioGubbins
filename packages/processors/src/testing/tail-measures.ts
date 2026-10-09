/**
 * How long a kernel with feedback takes to fall silent, which the properties'
 * check of a tail falling to exact zero is read at.
 */

/** The bits under 1 at which {@link framesToSilence} reads a tail. */
const SILENCE_BITS = 120;

/**
 * The frames an output whose slowest decay falls by `radius` a frame takes to
 * fall from 1 to `2^−120`: 20 bits under the `2^−100` below which
 * `flushSubnormal` takes a state for silence, room for a tail's gain over the
 * envelope it decays by, and 29 bits above the smallest float32, so a tail
 * whose state was never flushed is still to be heard there.
 */
export function framesToSilence(radius: number): number {
  return Math.ceil((SILENCE_BITS * Math.LN2) / -Math.log(radius));
}
