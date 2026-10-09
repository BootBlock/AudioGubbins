/**
 * A channel layout, described for a diagnostic.
 *
 * A message that says two layouts differ has to say how, or the person reading
 * it cannot tell which node to change or what to put between them.
 */

import { channelCount, type ChannelLayout } from '@audiogubbins/domain';
import { counted } from '@audiogubbins/text';

/** The layout in words, such as `2 channels (left, right)`. */
export function describeLayout(layout: ChannelLayout): string {
  const convention = layout.ambisonic;
  if (convention !== undefined) {
    return `an order-${String(convention.order)} ambisonic set (${convention.ordering}, ${convention.normalisation})`;
  }
  const count = channelCount(layout);
  const names = (layout.labels ?? layout.roles).join(', ');
  return `${counted(count, 'channel', 'channels')} (${names})`;
}
