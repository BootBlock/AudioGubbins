/**
 * The channel layouts a header can state, as the domain's roles.
 *
 * WAV's `dwChannelMask` and CoreAudio's channel bitmap share one speaker bit
 * order, and CoreAudio's channel labels 1 to 18 name the same speakers in the
 * same order, so one table maps all three. Each speaker maps to the domain role
 * of the same position; a channel the header places nowhere the domain names is
 * `discrete`. Where the domain refuses the roles a header gives, as two
 * channels claiming one speaker, the header states no layout this reader can
 * use, and the descriptor says so by stating none rather than repairing it.
 *
 * CoreAudio also names ambisonic sets by layout tag: higher-order ACN sets in
 * SN3D or N3D of any channel count, and the first-order B-format, which is
 * Furse-Malham's. A `CHAN` chunk written for a layout uses those tags for an
 * ambisonic set, and otherwise a description of each channel, which states any
 * order of speakers and discrete channels; it has no place for a channel's
 * name, so a labelled layout is one only WAV can state (ADR-0093).
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  ChannelRole,
  StandardLayouts,
  ambisonicLayout,
  channelLayout,
  fail,
  layoutsMatch,
  succeed,
  type AmbisonicConvention,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import { unwritableLayout } from './codec-failures.js';
import { layoutRead } from './format-descriptor.js';

/** The domain role of each speaker bit, in the WAVEFORMATEXTENSIBLE order. */
const SPEAKER_ROLES: readonly ChannelRole[] = [
  ChannelRole.Left, // SPEAKER_FRONT_LEFT
  ChannelRole.Right, // SPEAKER_FRONT_RIGHT
  ChannelRole.Centre, // SPEAKER_FRONT_CENTER
  ChannelRole.LowFrequency, // SPEAKER_LOW_FREQUENCY
  ChannelRole.RearLeft, // SPEAKER_BACK_LEFT
  ChannelRole.RearRight, // SPEAKER_BACK_RIGHT
  ChannelRole.FrontLeftOfCentre, // SPEAKER_FRONT_LEFT_OF_CENTER
  ChannelRole.FrontRightOfCentre, // SPEAKER_FRONT_RIGHT_OF_CENTER
  ChannelRole.RearCentre, // SPEAKER_BACK_CENTER
  ChannelRole.SurroundLeft, // SPEAKER_SIDE_LEFT
  ChannelRole.SurroundRight, // SPEAKER_SIDE_RIGHT
  ChannelRole.TopCentre, // SPEAKER_TOP_CENTER
  ChannelRole.TopFrontLeft, // SPEAKER_TOP_FRONT_LEFT
  ChannelRole.TopFrontCentre, // SPEAKER_TOP_FRONT_CENTER
  ChannelRole.TopFrontRight, // SPEAKER_TOP_FRONT_RIGHT
  ChannelRole.TopRearLeft, // SPEAKER_TOP_BACK_LEFT
  ChannelRole.TopRearCentre, // SPEAKER_TOP_BACK_CENTER
  ChannelRole.TopRearRight, // SPEAKER_TOP_BACK_RIGHT
];

/** The front-centre speaker alone, which on one channel is mono. */
const CENTRE_ONLY = 0b100;

/** CoreAudio's layout tags this reader names. */
const LayoutTag = {
  UseChannelDescriptions: 0,
  UseChannelBitmap: 1 << 16,
  Mono: (100 << 16) | 1,
  Stereo: (101 << 16) | 2,
  AmbisonicBFormat: (107 << 16) | 4,
} as const;

/** CoreAudio's ACN layout families, each ORed with its channel count. */
const HOA_FAMILIES: ReadonlyMap<number, AmbisonicNormalisation> = new Map([
  [190 << 16, AmbisonicNormalisation.Sn3d],
  [191 << 16, AmbisonicNormalisation.N3d],
]);

/** A tag's family, its top sixteen bits, and its channel count, the bottom sixteen. */
const TAG_FAMILY = 0xffff0000;
const TAG_COUNT = 0xffff;

/** kAudioChannelLabel_Discrete_0: a discrete channel's label is this ORed with its index. */
const DISCRETE_LABEL = 1 << 16;

/** The first-order Furse-Malham set CoreAudio's B-format tag names. */
const FIRST_ORDER_FUMA: AmbisonicConvention = {
  order: 1,
  ordering: AmbisonicOrdering.FuMa,
  normalisation: AmbisonicNormalisation.FuMa,
};

/** The layout of these roles, or `undefined` where the domain refuses them. */
function layoutOf(roles: readonly ChannelRole[]): ChannelLayout | undefined {
  const layout = channelLayout(roles);
  return layout.ok ? layout.value : undefined;
}

/**
 * The layout a speaker mask states for `channelCount` channels: each channel
 * takes the next speaker the mask sets, and channels past the mask's speakers
 * are discrete. A mask of no speakers states no layout.
 */
export function speakerMaskLayout(mask: number, channelCount: number): ChannelLayout | undefined {
  if (mask === 0) return undefined;
  if (channelCount === 1 && mask === CENTRE_ONLY) return StandardLayouts.mono;
  const roles: ChannelRole[] = [];
  for (let bit = 0; bit < 32 && roles.length < channelCount; bit += 1) {
    if (((mask >>> bit) & 1) === 1) roles.push(SPEAKER_ROLES[bit] ?? ChannelRole.Discrete);
  }
  while (roles.length < channelCount) roles.push(ChannelRole.Discrete);
  return layoutOf(roles);
}

/** The speaker bit of a positional role, mono taken as the front centre, or `undefined`. */
export function speakerBitOf(role: ChannelRole): number | undefined {
  if (role === ChannelRole.Mono) return 2;
  const bit = SPEAKER_ROLES.indexOf(role);
  return bit === -1 ? undefined : bit;
}

/**
 * The speaker mask naming every speaker a layout's roles place, mono as the
 * front centre, or `undefined` where a role is one no speaker bit names.
 * Discrete channels place none. A mask names speakers, not their order, so
 * whether it states this layout is asked of {@link speakerMaskLayout}.
 */
export function speakerMaskOf(layout: ChannelLayout): number | undefined {
  let mask = 0;
  for (const role of layout.roles) {
    if (role === ChannelRole.Discrete) continue;
    if (role === ChannelRole.Mono) {
      mask |= CENTRE_ONLY;
      continue;
    }
    const bit = SPEAKER_ROLES.indexOf(role);
    if (bit === -1) return undefined;
    mask |= 1 << bit;
  }
  return mask;
}

/**
 * The layout CoreAudio channel labels state, one for each channel: a label from
 * 1 to 18 names a speaker, and any other names none the domain places.
 */
function channelLabelLayout(labels: readonly number[]): ChannelLayout | undefined {
  return layoutOf(labels.map((label) => SPEAKER_ROLES[label - 1] ?? ChannelRole.Discrete));
}

/** What an AIFF `CHAN` chunk holds: CoreAudio's `AudioChannelLayout`. */
export interface CoreAudioLayout {
  readonly tag: number;
  readonly bitmap: number;
  readonly labels: readonly number[];
}

/**
 * The layout a CoreAudio channel layout states for `channelCount` channels, or
 * `undefined` where its tag is one this reader cannot name or its channels are
 * not the file's.
 */
export function coreAudioLayout(
  layout: CoreAudioLayout,
  channelCount: number,
): ChannelLayout | undefined {
  switch (layout.tag) {
    case LayoutTag.UseChannelDescriptions:
      return layout.labels.length === channelCount ? channelLabelLayout(layout.labels) : undefined;
    case LayoutTag.UseChannelBitmap:
      return speakerMaskLayout(layout.bitmap, channelCount);
    case LayoutTag.Mono:
      return channelCount === 1 ? StandardLayouts.mono : undefined;
    case LayoutTag.Stereo:
      return channelCount === 2 ? StandardLayouts.stereo : undefined;
    case LayoutTag.AmbisonicBFormat:
      return channelCount === 4 ? ambisonicOf(FIRST_ORDER_FUMA) : undefined;
    default: {
      const normalisation = HOA_FAMILIES.get(layout.tag & TAG_FAMILY);
      const count = layout.tag & TAG_COUNT;
      const order = Math.sqrt(count) - 1;
      if (normalisation === undefined || count !== channelCount || !Number.isInteger(order)) {
        return undefined;
      }
      return ambisonicOf({ order, ordering: AmbisonicOrdering.Acn, normalisation });
    }
  }
}

/** The ambisonic layout of a convention, or `undefined` where the domain refuses it. */
function ambisonicOf(convention: AmbisonicConvention): ChannelLayout | undefined {
  const layout = ambisonicLayout(convention);
  return layout.ok ? layout.value : undefined;
}

/** The CoreAudio layout of an ambisonic set, or why a `CHAN` chunk cannot state it. */
function ambisonicCoreAudioLayout(
  convention: AmbisonicConvention,
  channelCount: number,
): DomainResult<CoreAudioLayout> {
  if (convention.ordering === AmbisonicOrdering.Acn) {
    const family = [...HOA_FAMILIES].find(([, scaling]) => scaling === convention.normalisation);
    if (family !== undefined) {
      return succeed({ tag: (family[0] | channelCount) >>> 0, bitmap: 0, labels: [] });
    }
  }
  if (convention.order === FIRST_ORDER_FUMA.order) {
    return succeed({ tag: LayoutTag.AmbisonicBFormat, bitmap: 0, labels: [] });
  }
  return fail(
    unwritableLayout(
      'An AIFF file cannot state a Furse-Malham ambisonic set above the first order: CoreAudio names no layout for it. WAV can hold it.',
    ),
  );
}

/**
 * The CoreAudio layout a `CHAN` chunk states `layout` by, `undefined` where the
 * layout is the one an AIFF file of its channels is read as without one, or why
 * no `CHAN` chunk can state it.
 */
export function coreAudioLayoutOf(
  layout: ChannelLayout,
): DomainResult<CoreAudioLayout | undefined> {
  const channelCount = layout.roles.length;
  if (layout.ambisonic !== undefined) {
    return ambisonicCoreAudioLayout(layout.ambisonic, channelCount);
  }
  if (layout.labels !== undefined) {
    return fail(
      unwritableLayout(
        "An AIFF file cannot state a layout of named channels: its CHAN chunk has no place for a channel's name. WAV can hold it.",
      ),
    );
  }
  const unstated = layoutRead(undefined, channelCount);
  if (unstated.ok && layoutsMatch(unstated.value, layout)) return succeed(undefined);
  const labels = layout.roles.map((role, index) => {
    const bit = speakerBitOf(role);
    return bit === undefined ? (DISCRETE_LABEL | index) >>> 0 : bit + 1;
  });
  return succeed({ tag: LayoutTag.UseChannelDescriptions, bitmap: 0, labels });
}
