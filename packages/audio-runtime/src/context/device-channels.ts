/**
 * Which device channel each channel of the graph's output plays on.
 *
 * REQ-ARCH-157 prohibits a silent downmix and an accidental truncation, and a
 * context left as it starts does both: its destination takes two channels as
 * speakers, so it mixes a six-channel output as Web Audio's 5.1 whatever its
 * roles, and drops every channel past the second of anything else. So the
 * destination is set to take exactly the output's channels, explicitly and
 * discretely, and the channels are put in the device's order by what each
 * carries rather than where it sits in the output (ADR-0033).
 *
 * A device's discrete channels come in the WAVEFORMATEXTENSIBLE order of the
 * speakers it has, which is the order the platforms and Web Audio's own
 * standard layouts use: a positional output is sorted into that order, a
 * discrete one plays channel by channel, and a mono one on the one channel. An
 * output whose roles do not say where a channel goes, or that has more channels
 * than the device takes, is refused rather than guessed at: it needs a matrix
 * or channel-map node to the device's layout, which the graph states.
 */

import {
  ChannelRole,
  FailureKind,
  channelCount,
  fail,
  failure,
  succeed,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import type { AudioDestinationPort } from './audio-context-port.js';

/** How the output's channels reach the device. */
export interface DeviceChannels {
  /** The channels the destination sends the device. */
  readonly count: number;
  /** For each device channel, in the device's order, the output channel it carries. */
  readonly outputChannelOf: readonly number[];
}

/** The speaker positions in WAVEFORMATEXTENSIBLE channel-mask order, the device's order. */
const DEVICE_ORDER: ReadonlyMap<ChannelRole, number> = new Map(
  [
    ChannelRole.Left,
    ChannelRole.Right,
    ChannelRole.Centre,
    ChannelRole.LowFrequency,
    ChannelRole.RearLeft,
    ChannelRole.RearRight,
    ChannelRole.FrontLeftOfCentre,
    ChannelRole.FrontRightOfCentre,
    ChannelRole.RearCentre,
    ChannelRole.SurroundLeft,
    ChannelRole.SurroundRight,
    ChannelRole.TopCentre,
    ChannelRole.TopFrontLeft,
    ChannelRole.TopFrontCentre,
    ChannelRole.TopFrontRight,
    ChannelRole.TopRearLeft,
    ChannelRole.TopRearCentre,
    ChannelRole.TopRearRight,
  ].map((role, position) => [role, position]),
);

/** Why a layout's channels have no place on a device. */
function unplaced(summary: string): DomainResult<never> {
  return fail(failure('playback.output-layout-unplaced', FailureKind.Rejected, summary));
}

/** The output's channels in the device's order, or why they have none. */
function deviceOrderOf(layout: ChannelLayout): DomainResult<readonly number[]> {
  if (layout.ambisonic !== undefined) {
    return unplaced(
      'The graph’s output is an ambisonic set, which is not speaker feeds; it plays only ' +
        'through a decoder to the device’s speakers.',
    );
  }
  const { roles } = layout;
  if (roles.every((role) => role === ChannelRole.Discrete) || roles[0] === ChannelRole.Mono) {
    // Channel by channel: a discrete channel's place is its index, and a mono
    // layout has one channel alone.
    return succeed(roles.map((_, index) => index));
  }
  const placed: { readonly index: number; readonly position: number }[] = [];
  for (const [index, role] of roles.entries()) {
    const position = DEVICE_ORDER.get(role);
    if (position === undefined) {
      return unplaced(
        'The graph’s output mixes speaker positions with channels that have none, so which ' +
          'device channel each plays on cannot be known; a channel-map node to the device’s ' +
          'layout says it.',
      );
    }
    placed.push({ index, position });
  }
  return succeed(
    placed.sort((one, other) => one.position - other.position).map(({ index }) => index),
  );
}

/**
 * The device channel of each output channel, for an output of `layout` on a
 * device that takes at most `maxChannelCount` channels, or why it cannot play.
 */
export function deviceChannelsFor(
  layout: ChannelLayout,
  maxChannelCount: number,
): DomainResult<DeviceChannels> {
  const count = channelCount(layout);
  if (count > maxChannelCount) {
    return fail(
      failure(
        'playback.device-channels-exceeded',
        FailureKind.Rejected,
        `The graph’s output has ${String(count)} channels, but the output device takes at most ` +
          `${String(maxChannelCount)}. It needs a matrix or channel-map node that maps its ` +
          'channels to the device’s layout.',
        { details: { outputChannels: count, deviceChannels: maxChannelCount } },
      ),
    );
  }
  const order = deviceOrderOf(layout);
  return order.ok ? succeed({ count, outputChannelOf: order.value }) : order;
}

/**
 * Sets the destination to send the device exactly `channels.count` channels,
 * each as it arrives, so the context neither mixes nor drops one.
 */
export function sendToDevice(destination: AudioDestinationPort, channels: DeviceChannels): void {
  destination.channelCount = channels.count;
  destination.channelCountMode = 'explicit';
  destination.channelInterpretation = 'discrete';
}
