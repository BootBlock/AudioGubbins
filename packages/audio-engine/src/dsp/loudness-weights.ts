/**
 * The weight each channel's mean square carries in a loudness measurement,
 * by its role: the one home of the rule, which both implementations of the
 * port hand the loudness meter as weights (`loudness.rs`).
 *
 * ITU-R BS.1770-4, Table 3, weights a channel by its loudspeaker's position:
 * 1.41 (about +1.5 dB) for one below 30° of elevation between 60° and 120°
 * of azimuth either side, and 1.0 for any other, the low-frequency effects
 * channel excluded. Each role's position is its nominal one in ITU-R BS.2051
 * (EBU R 128 s1 applies the same table to programmes beyond 5.1):
 *
 * - left, right, centre and the front pair beside the centre are within 60°
 *   of the front, and the rear pair and rear centre beyond 120°: 1.0;
 * - the surround pair, at ±90° to ±110°: 1.41;
 * - every height role is 30° or more up: 1.0;
 * - the low-frequency channel is excluded: 0;
 * - mono, a discrete channel and an ambisonic component have no loudspeaker
 *   position, and take the table's "any other" weight: 1.0.
 */

import { ChannelRole, type ChannelLayout } from '@audiogubbins/domain';

/** The weight of a channel at the side, between 60° and 120° of azimuth. */
const SIDE_WEIGHT = 1.41;

/** The weight a role carries in a loudness measurement. */
function loudnessWeightOf(role: ChannelRole): number {
  switch (role) {
    case ChannelRole.LowFrequency:
      return 0;
    case ChannelRole.SurroundLeft:
    case ChannelRole.SurroundRight:
      return SIDE_WEIGHT;
    default:
      return 1;
  }
}

/** The weight of each channel of `layout`, in channel order. */
export function loudnessWeights(layout: ChannelLayout): Float64Array {
  return Float64Array.from(layout.roles, loudnessWeightOf);
}
