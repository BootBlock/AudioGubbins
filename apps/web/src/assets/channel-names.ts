/**
 * What each channel of a layout is called in the editor: its label where the
 * layout carries one, its role where it has one, and its ambisonic component
 * or its number otherwise. Every channel has a name of its own, however many
 * the layout has, so no lane is ever "the right one" by position alone (the
 * packet's rule against implicit stereo).
 */

import {
  ChannelRole,
  ambisonicComponentOf,
  channelCount,
  channelLabelOf,
  type ChannelLayout,
} from '@audiogubbins/domain';

const ROLE_NAMES: Readonly<Record<ChannelRole, string | undefined>> = {
  [ChannelRole.Mono]: 'Mono',
  [ChannelRole.Left]: 'Left',
  [ChannelRole.Right]: 'Right',
  [ChannelRole.Centre]: 'Centre',
  [ChannelRole.LowFrequency]: 'Low-frequency effects',
  [ChannelRole.SurroundLeft]: 'Surround left',
  [ChannelRole.SurroundRight]: 'Surround right',
  [ChannelRole.RearLeft]: 'Rear left',
  [ChannelRole.RearRight]: 'Rear right',
  [ChannelRole.RearCentre]: 'Rear centre',
  [ChannelRole.FrontLeftOfCentre]: 'Front left of centre',
  [ChannelRole.FrontRightOfCentre]: 'Front right of centre',
  [ChannelRole.TopCentre]: 'Top centre',
  [ChannelRole.TopFrontLeft]: 'Top front left',
  [ChannelRole.TopFrontCentre]: 'Top front centre',
  [ChannelRole.TopFrontRight]: 'Top front right',
  [ChannelRole.TopRearLeft]: 'Top rear left',
  [ChannelRole.TopRearCentre]: 'Top rear centre',
  [ChannelRole.TopRearRight]: 'Top rear right',
  // Named by their number or their component below.
  [ChannelRole.Discrete]: undefined,
  [ChannelRole.Ambisonic]: undefined,
};

/** The first-order components by their customary letters, by channel number. */
const FIRST_ORDER_LETTERS: readonly string[] = ['W', 'Y', 'Z', 'X'];

function ambisonicName(layout: ChannelLayout, index: number): string | undefined {
  const component = ambisonicComponentOf(layout, index);
  if (component === undefined) return undefined;
  const letter = component.degree <= 1 ? FIRST_ORDER_LETTERS[component.acn] : undefined;
  return letter === undefined
    ? `Component ${String(component.acn)}`
    : `${letter} (component ${String(component.acn)})`;
}

/** What each channel of `layout` is called, in the layout's order. */
export function channelNames(layout: ChannelLayout): readonly string[] {
  return Array.from({ length: channelCount(layout) }, (_, index) => {
    const role = layout.roles[index];
    return (
      channelLabelOf(layout, index) ??
      (role === undefined ? undefined : ROLE_NAMES[role]) ??
      ambisonicName(layout, index) ??
      `Channel ${String(index + 1)}`
    );
  });
}
