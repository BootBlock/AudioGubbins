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
 * Where the roles cannot say what a channel is, a layout says it another way:
 * an ambisonic set by its convention (`ambisonic-layout.ts`), and a custom map
 * by a label on each channel. Channel order is never inferred from array
 * position alone where a workflow needs to know which channel is which
 * (ADR-0033).
 */

import { failure, FailureKind, type DomainResult, fail, succeed } from '../result.js';

/**
 * What a channel carries.
 *
 * The positional roles are the speaker positions of the WAVEFORMATEXTENSIBLE
 * channel mask, the widest set a common interchange format names, in the
 * conventional surround vocabulary Godot's bus layouts also use. `Discrete`
 * covers a channel with no spatial meaning, such as a stem or a multitrack
 * capture. `Ambisonic` is one component of an ambisonic set, whose convention
 * the layout states.
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
  RearCentre: 'rear-centre',
  FrontLeftOfCentre: 'front-left-of-centre',
  FrontRightOfCentre: 'front-right-of-centre',
  TopCentre: 'top-centre',
  TopFrontLeft: 'top-front-left',
  TopFrontCentre: 'top-front-centre',
  TopFrontRight: 'top-front-right',
  TopRearLeft: 'top-rear-left',
  TopRearCentre: 'top-rear-centre',
  TopRearRight: 'top-rear-right',
  Discrete: 'discrete',
  Ambisonic: 'ambisonic',
} as const;

/** What a channel carries. */
export type ChannelRole = (typeof ChannelRole)[keyof typeof ChannelRole];

/** How the components of an ambisonic set are ordered in the buffer. */
export const AmbisonicOrdering = {
  /** Ambisonic Channel Number, as AmbiX and most current tools use. */
  Acn: 'acn',

  /** The Furse-Malham order, defined to the third order. */
  FuMa: 'fuma',
} as const;

/** How the components of an ambisonic set are ordered in the buffer. */
export type AmbisonicOrdering = (typeof AmbisonicOrdering)[keyof typeof AmbisonicOrdering];

/** How the components of an ambisonic set are scaled. */
export const AmbisonicNormalisation = {
  /** Schmidt semi-normalised, as AmbiX uses. */
  Sn3d: 'sn3d',

  /** Fully normalised. */
  N3d: 'n3d',

  /** The Furse-Malham weights, with W at minus three decibels. */
  FuMa: 'fuma',
} as const;

/** How the components of an ambisonic set are scaled. */
export type AmbisonicNormalisation =
  (typeof AmbisonicNormalisation)[keyof typeof AmbisonicNormalisation];

/** The convention of an ambisonic set: its order, ordering and scaling. */
export interface AmbisonicConvention {
  /** The spherical-harmonic order, so the set has `(order + 1)²` components. */
  readonly order: number;
  readonly ordering: AmbisonicOrdering;
  readonly normalisation: AmbisonicNormalisation;
}

/**
 * An ordered channel layout.
 *
 * `roles[i]` describes channel `i`. A layout always has at least one channel.
 * `labels[i]`, where labels are given, is what the user calls channel `i` in a
 * custom map. `ambisonic` is present exactly when every role is
 * {@link ChannelRole.Ambisonic}.
 */
export interface ChannelLayout {
  readonly roles: readonly [ChannelRole, ...ChannelRole[]];
  readonly labels?: readonly [string, ...string[]];
  readonly ambisonic?: AmbisonicConvention;
}

/**
 * The largest channel count AudioGubbins accepts.
 *
 * Well beyond 22.2, and exactly a fifteenth-order ambisonic set, while still
 * catching a corrupt header that claims tens of thousands of channels before it
 * is used to allocate a buffer.
 */
export const MAXIMUM_CHANNEL_COUNT = 256;

/**
 * The longest label a channel may carry, in UTF-16 code units.
 *
 * A guard against corrupt data rather than a rule about names: a label longer
 * than this is not something a person typed for a channel.
 */
const MAXIMUM_LABEL_LENGTH = 128;

/** Any character a label may not hold: the C0 and C1 controls. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/** How many channels the layout describes. */
export function channelCount(layout: ChannelLayout): number {
  return layout.roles.length;
}

/** What the user calls channel `index`, where the layout carries labels. */
export function channelLabelOf(layout: ChannelLayout, index: number): string | undefined {
  return layout.labels?.[index];
}

/** A layout of no channels, which no audio has. */
const EMPTY_LAYOUT = fail(
  failure(
    'channel.layout-empty',
    FailureKind.Rejected,
    'A channel layout must describe at least one channel.',
  ),
);

/** Why a non-empty list of roles cannot be a layout, or `undefined` when it can. */
function problemWithRoles(roles: readonly ChannelRole[]): DomainResult<never> | undefined {
  if (roles.length > MAXIMUM_CHANNEL_COUNT) {
    return fail(
      failure(
        'channel.layout-too-many-channels',
        FailureKind.Rejected,
        `A channel layout may describe at most ${String(MAXIMUM_CHANNEL_COUNT)} channels.`,
        { details: { requested: roles.length } },
      ),
    );
  }
  return problemWithPositions(roles);
}

/** Why the positional roles of a list conflict, or `undefined` when they do not. */
function problemWithPositions(roles: readonly ChannelRole[]): DomainResult<never> | undefined {
  // A positional role appearing twice would make the layout ambiguous: two
  // channels both claiming to be the centre cannot both be routed to it.
  // Discrete channels are exempt, because that is what discrete means.
  const seen = new Set<ChannelRole>();
  for (const role of roles) {
    if (role === ChannelRole.Ambisonic) {
      return fail(
        failure(
          'channel.layout-ambisonic-without-convention',
          FailureKind.Rejected,
          'An ambisonic channel belongs to a set whose order, ordering and normalisation are stated; build it with ambisonicLayout.',
        ),
      );
    }
    if (role === ChannelRole.Discrete) continue;
    if (seen.has(role)) {
      return fail(
        failure(
          'channel.layout-duplicate-role',
          FailureKind.Rejected,
          'A positional channel role may appear only once in a layout.',
          { details: { role } },
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
  return undefined;
}

/** Why a list of labels cannot name the channels, or `undefined` when it can. */
function problemWithLabels(
  labels: readonly string[],
  count: number,
): DomainResult<never> | undefined {
  if (labels.length !== count) {
    return fail(
      failure(
        'channel.labels-count-mismatch',
        FailureKind.Rejected,
        'A labelled layout needs exactly one label for each channel.',
        { details: { channels: count, labels: labels.length } },
      ),
    );
  }
  const seen = new Set<string>();
  for (const [index, label] of labels.entries()) {
    const wellFormed =
      label.trim() === label &&
      label !== '' &&
      label.length <= MAXIMUM_LABEL_LENGTH &&
      !CONTROL_CHARACTER.test(label);
    if (!wellFormed) {
      return fail(
        failure(
          'channel.label-invalid',
          FailureKind.Rejected,
          `A channel label must be between 1 and ${String(MAXIMUM_LABEL_LENGTH)} characters, with no space around it and no control character.`,
          { details: { channel: index } },
        ),
      );
    }
    if (seen.has(label)) {
      // Two channels of one name could not be told apart by anything that
      // routes or exports by name, which is what a label is for.
      return fail(
        failure(
          'channel.label-duplicate',
          FailureKind.Rejected,
          'Each channel of a labelled layout needs its own label.',
          { details: { channel: index } },
        ),
      );
    }
    seen.add(label);
  }
  return undefined;
}

/**
 * Builds a validated layout from an ordered list of roles, with a label for
 * each channel where the layout is a custom map.
 */
export function channelLayout(
  roles: readonly ChannelRole[],
  labels?: readonly string[],
): DomainResult<ChannelLayout> {
  const [first, ...rest] = roles;
  if (first === undefined) return EMPTY_LAYOUT;
  const problem =
    problemWithRoles(roles) ??
    (labels === undefined ? undefined : problemWithLabels(labels, roles.length));
  if (problem !== undefined) return problem;

  const [firstLabel, ...otherLabels] = labels ?? [];
  return succeed({
    roles: [first, ...rest],
    ...(firstLabel === undefined ? {} : { labels: [firstLabel, ...otherLabels] }),
  });
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
        { details: { count: String(count) } },
      ),
    );
  }
  return channelLayout(Array.from({ length: count }, () => ChannelRole.Discrete));
}

/**
 * Builds a custom map: one discrete channel for each label, in order.
 *
 * The layout for stems, a dialogue split or any arrangement whose channels a
 * person names rather than places.
 */
export function labelledLayout(labels: readonly string[]): DomainResult<ChannelLayout> {
  return channelLayout(
    labels.map(() => ChannelRole.Discrete),
    labels,
  );
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
  lcr: { roles: [ChannelRole.Left, ChannelRole.Right, ChannelRole.Centre] },
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
  surround7_1_4: {
    roles: [
      ChannelRole.Left,
      ChannelRole.Right,
      ChannelRole.Centre,
      ChannelRole.LowFrequency,
      ChannelRole.SurroundLeft,
      ChannelRole.SurroundRight,
      ChannelRole.RearLeft,
      ChannelRole.RearRight,
      ChannelRole.TopFrontLeft,
      ChannelRole.TopFrontRight,
      ChannelRole.TopRearLeft,
      ChannelRole.TopRearRight,
    ],
  },
} as const satisfies Record<string, ChannelLayout>;

/** Whether two ambisonic conventions are the same, where either is present. */
function conventionsMatch(
  left: AmbisonicConvention | undefined,
  right: AmbisonicConvention | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.order === right.order &&
    left.ordering === right.ordering &&
    left.normalisation === right.normalisation
  );
}

/**
 * Whether two layouts describe the same channels in the same order.
 *
 * Labels and the ambisonic convention count: two custom maps of the same width
 * with different names are different layouts, and so are AmbiX and FuMa sets
 * of the same order, whose channels mean different things.
 */
export function layoutsMatch(left: ChannelLayout, right: ChannelLayout): boolean {
  return (
    left.roles.length === right.roles.length &&
    left.roles.every((role, index) => role === right.roles[index]) &&
    (left.labels?.length ?? 0) === (right.labels?.length ?? 0) &&
    (left.labels ?? []).every((label, index) => label === right.labels?.[index]) &&
    conventionsMatch(left.ambisonic, right.ambisonic)
  );
}

/** The index of a role in a layout, or `undefined` if it is not present. */
export function channelIndexOf(layout: ChannelLayout, role: ChannelRole): number | undefined {
  const index = layout.roles.indexOf(role);
  return index === -1 ? undefined : index;
}
