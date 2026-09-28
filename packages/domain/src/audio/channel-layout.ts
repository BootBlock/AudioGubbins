/**
 * The channel model.
 *
 * REQ-ARCH-157 requires the core channel model to be N-channel and
 * layout-aware, with stereo treated as a local adaptation rather than a
 * built-in assumption. REQ-EXEC-216 names "audio is stereo" as a hidden
 * assumption an agent must not make. Nothing in this module special-cases two
 * channels.
 *
 * A layout is an ordered list of roles. The order is the channel order in the
 * buffer, so a layout both names the channels and fixes their interleaving.
 */

import { failure, FailureKind, type DomainResult, fail, succeed } from '../result.js';

/**
 * What a channel carries.
 *
 * Roles follow the conventional surround vocabulary, because interchange
 * formats and Godot's own bus layouts use it. `Discrete` covers a channel with
 * no spatial meaning, such as a stem or a multitrack capture.
 */
export const ChannelRole = {
  Mono: 'mono',
  Left: 'left',
  Right: 'right',
  Centre: 'centre',
  LowFrequency: 'low-frequency',
  SurroundLeft: 'surround-left',
  SurroundRight: 'surround-right',
  RearLeft: 'rear-left',
  RearRight: 'rear-right',
  TopFrontLeft: 'top-front-left',
  TopFrontRight: 'top-front-right',
  TopRearLeft: 'top-rear-left',
  TopRearRight: 'top-rear-right',
  Discrete: 'discrete',
} as const;

/** What a channel carries. */
export type ChannelRole = (typeof ChannelRole)[keyof typeof ChannelRole];

/**
 * An ordered channel layout.
 *
 * `roles[i]` describes channel `i`. A layout always has at least one channel.
 */
export interface ChannelLayout {
  readonly roles: readonly [ChannelRole, ...ChannelRole[]];
}

/**
 * The largest channel count AudioGubbins accepts.
 *
 * Well beyond 22.2 and any first-order-ambisonic arrangement, while still
 * catching a corrupt header that claims tens of thousands of channels before it
 * is used to allocate a buffer.
 */
export const MAXIMUM_CHANNEL_COUNT = 256;

/** How many channels the layout describes. */
export function channelCount(layout: ChannelLayout): number {
  return layout.roles.length;
}

/** Builds a validated layout from an ordered list of roles. */
export function channelLayout(roles: readonly ChannelRole[]): DomainResult<ChannelLayout> {
  const [first, ...rest] = roles;

  if (first === undefined) {
    return fail(
      failure(
        'channel.layout-empty',
        FailureKind.Rejected,
        'A channel layout must describe at least one channel.',
      ),
    );
  }
  if (roles.length > MAXIMUM_CHANNEL_COUNT) {
    return fail(
      failure(
        'channel.layout-too-many-channels',
        FailureKind.Rejected,
        `A channel layout may describe at most ${String(MAXIMUM_CHANNEL_COUNT)} channels.`,
        {
          details: { requested: roles.length },
        },
      ),
    );
  }

  // A positional role appearing twice would make the layout ambiguous: two
  // channels both claiming to be the centre cannot both be routed to it.
  // Discrete channels are exempt, because that is what discrete means.
  const seen = new Set<ChannelRole>();
  for (const role of roles) {
    if (role === ChannelRole.Discrete) continue;
    if (seen.has(role)) {
      return fail(
        failure(
          'channel.layout-duplicate-role',
          FailureKind.Rejected,
          'A positional channel role may appear only once in a layout.',
          {
            details: { role },
          },
        ),
      );
    }
    seen.add(role);
  }

  if (roles.length > 1 && seen.has(ChannelRole.Mono)) {
    return fail(
      failure(
        'channel.layout-mono-with-others',
        FailureKind.Rejected,
        'The mono role describes a single-channel layout and cannot be combined with other channels.',
      ),
    );
  }

  return succeed({ roles: [first, ...rest] });
}

/**
 * Builds a layout of `count` discrete channels.
 *
 * The honest layout for material whose channel meaning is unknown, such as a
 * multitrack capture. Guessing that four channels are quadraphonic would be the
 * kind of hidden assumption REQ-EXEC-216 prohibits.
 */
export function discreteLayout(count: number): DomainResult<ChannelLayout> {
  if (!Number.isInteger(count) || count < 1) {
    return fail(
      failure(
        'channel.discrete-count-invalid',
        FailureKind.Rejected,
        'A discrete layout needs a positive whole number of channels.',
        {
          details: { count: String(count) },
        },
      ),
    );
  }
  return channelLayout(Array.from({ length: count }, () => ChannelRole.Discrete));
}

/**
 * Named layouts AudioGubbins recognises.
 *
 * These are conveniences for code that genuinely knows which arrangement it
 * holds. They are not a closed set: any valid `ChannelLayout` is a first-class
 * layout, whether or not it appears here.
 */
export const StandardLayouts = {
  mono: { roles: [ChannelRole.Mono] },
  stereo: { roles: [ChannelRole.Left, ChannelRole.Right] },
  quadraphonic: {
    roles: [ChannelRole.Left, ChannelRole.Right, ChannelRole.RearLeft, ChannelRole.RearRight],
  },
  surround5_1: {
    roles: [
      ChannelRole.Left,
      ChannelRole.Right,
      ChannelRole.Centre,
      ChannelRole.LowFrequency,
      ChannelRole.SurroundLeft,
      ChannelRole.SurroundRight,
    ],
  },
  surround7_1: {
    roles: [
      ChannelRole.Left,
      ChannelRole.Right,
      ChannelRole.Centre,
      ChannelRole.LowFrequency,
      ChannelRole.SurroundLeft,
      ChannelRole.SurroundRight,
      ChannelRole.RearLeft,
      ChannelRole.RearRight,
    ],
  },
} as const satisfies Record<string, ChannelLayout>;

/** Whether two layouts describe the same channels in the same order. */
export function layoutsMatch(left: ChannelLayout, right: ChannelLayout): boolean {
  return (
    left.roles.length === right.roles.length &&
    left.roles.every((role, index) => role === right.roles[index])
  );
}

/** The index of a role in a layout, or `undefined` if it is not present. */
export function channelIndexOf(layout: ChannelLayout, role: ChannelRole): number | undefined {
  const index = layout.roles.indexOf(role);
  return index === -1 ? undefined : index;
}
