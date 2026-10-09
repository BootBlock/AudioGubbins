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
 */

import {
  ChannelRole,
  StandardLayouts,
  channelLayout,
  type ChannelLayout,
} from '@audiogubbins/domain';

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
} as const;

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
    default:
      return undefined;
  }
}
