/**
 * Whether a file of a codec in a container can state a channel layout, and the
 * order its channels are written in where it can (ADR-0093).
 *
 * WAV states every layout: the speaker mask where it can, `iXML` for the rest
 * (`wave-layout-writing.ts`). AIFF and AIFF-C state what a `CHAN` chunk can
 * (`channel-layouts.ts`). The coded formats state a layout only by their
 * channel count, each count naming one arrangement of speakers:
 *
 * - FLAC (RFC 9639, section 9.1.3), Vorbis (Vorbis I, section 4.3.9) and Opus's
 *   mapping families 0 and 1 (RFC 7845, section 5.1.1.2) share one table for
 *   one to eight channels. The surround pair of five and six channels is FLAC's
 *   "back/surround" pair and Vorbis's "rear" pair, the one surround pair of a
 *   5.0 or 5.1 layout, so it is stated whether the layout names it the side
 *   pair, as the domain's 5.1 does, or the rear pair.
 * - AAC states its channel configurations 1 to 7 (ISO/IEC 14496-3, table 1.19),
 *   the last eight channels with the front-centre pair and a surround pair.
 * - MP3 states mono and stereo alone.
 *
 * A layout of named channels, an ambisonic set, discrete channels or any other
 * arrangement of speakers is stated by none of them, and the refusal says so,
 * so an export is refused before it renders rather than written as a file that
 * says less than its audio is. The coded formats take their channels in the
 * speaker mask's bit order, which every encoder AudioGubbins drives takes and
 * every decoder of the codec module gives back.
 */

import {
  ChannelRole,
  fail,
  mapResult,
  succeed,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import { coreAudioLayoutOf, speakerBitOf } from './channel-layouts.js';
import { unwritableLayout } from './codec-failures.js';
import type { CodecId, ContainerId } from './codec-descriptor.js';
import { waveLayoutPlan } from './wave-layout-writing.js';

/** For each channel a file holds, in its order, the index of that channel in the layout given. */
export type WrittenChannelOrder = readonly number[];

type LayoutRule = (layout: ChannelLayout) => DomainResult<WrittenChannelOrder>;

const { Mono, Left, Right, Centre, LowFrequency } = ChannelRole;
const SIDE = [ChannelRole.SurroundLeft, ChannelRole.SurroundRight] as const;
const REAR = [ChannelRole.RearLeft, ChannelRole.RearRight] as const;
const FRONT_CENTRE_PAIR = [ChannelRole.FrontLeftOfCentre, ChannelRole.FrontRightOfCentre] as const;

/** The arrangements of speakers a coded format states, for each count of channels. */
type StatedSpeakers = ReadonlyMap<number, readonly (readonly ChannelRole[])[]>;

/** FLAC's, Vorbis's and Opus's one table. */
const VORBIS_ORDER_SPEAKERS: StatedSpeakers = new Map([
  [1, [[Mono]]],
  [2, [[Left, Right]]],
  [3, [[Left, Right, Centre]]],
  [4, [[Left, Right, ...REAR]]],
  [
    5,
    [
      [Left, Right, Centre, ...SIDE],
      [Left, Right, Centre, ...REAR],
    ],
  ],
  [
    6,
    [
      [Left, Right, Centre, LowFrequency, ...SIDE],
      [Left, Right, Centre, LowFrequency, ...REAR],
    ],
  ],
  [7, [[Left, Right, Centre, LowFrequency, ChannelRole.RearCentre, ...SIDE]]],
  [8, [[Left, Right, Centre, LowFrequency, ...REAR, ...SIDE]]],
]);

/** AAC's channel configurations 1 to 7. */
const AAC_SPEAKERS: StatedSpeakers = new Map([
  [1, [[Mono]]],
  [2, [[Left, Right]]],
  [3, [[Left, Right, Centre]]],
  [4, [[Left, Right, Centre, ChannelRole.RearCentre]]],
  [
    5,
    [
      [Left, Right, Centre, ...SIDE],
      [Left, Right, Centre, ...REAR],
    ],
  ],
  [
    6,
    [
      [Left, Right, Centre, LowFrequency, ...SIDE],
      [Left, Right, Centre, LowFrequency, ...REAR],
    ],
  ],
  [
    8,
    [
      [Left, Right, Centre, LowFrequency, ...FRONT_CENTRE_PAIR, ...SIDE],
      [Left, Right, Centre, LowFrequency, ...FRONT_CENTRE_PAIR, ...REAR],
    ],
  ],
]);

const MP3_SPEAKERS: StatedSpeakers = new Map([
  [1, [[Mono]]],
  [2, [[Left, Right]]],
]);

/** The layout's channels in the speaker mask's bit order. */
function maskOrder(layout: ChannelLayout): WrittenChannelOrder {
  return layout.roles
    .map((role, index) => ({ index, bit: speakerBitOf(role) ?? Number.POSITIVE_INFINITY }))
    .sort((left, right) => left.bit - right.bit)
    .map((entry) => entry.index);
}

/** Whether a layout's roles are exactly one of `sets`, in any order. */
function isStated(layout: ChannelLayout, sets: readonly (readonly ChannelRole[])[]): boolean {
  const roles = new Set(layout.roles);
  return sets.some(
    (set) => set.length === layout.roles.length && set.every((role) => roles.has(role)),
  );
}

/** The rule of a coded format, which states the arrangements of `speakers` and nothing else. */
function codedRule(name: string, speakers: StatedSpeakers, holds: string): LayoutRule {
  return (layout) => {
    const sets = speakers.get(layout.roles.length);
    if (
      layout.labels === undefined &&
      layout.ambisonic === undefined &&
      sets !== undefined &&
      isStated(layout, sets)
    ) {
      return succeed(maskOrder(layout));
    }
    return fail(
      unwritableLayout(
        `${name} cannot state this layout of ${String(layout.roles.length)} channels: it states ${holds}. WAV states every layout.`,
      ),
    );
  };
}

const VORBIS_ORDER_HOLDS =
  'mono, stereo, LCR, quadraphonic, 5.0, 5.1, 6.1 and 7.1 by their channel count alone';

const waveRule: LayoutRule = (layout) => mapResult(waveLayoutPlan(layout), (plan) => plan.order);

const chanRule: LayoutRule = (layout) =>
  mapResult(coreAudioLayoutOf(layout), () => layout.roles.map((_, index) => index));

/** The containers that state a layout whatever their codec. */
const CONTAINER_RULES: ReadonlyMap<ContainerId, LayoutRule> = new Map([
  ['wav', waveRule],
  ['rf64', waveRule],
  ['bw64', waveRule],
  ['aiff', chanRule],
  ['aifc', chanRule],
]);

/** A coded format: its container, the arrangements it states, and its rule over them. */
interface CodedFormat {
  readonly container: ContainerId;
  readonly speakers: StatedSpeakers;
  readonly rule: LayoutRule;
}

function coded(
  container: ContainerId,
  name: string,
  speakers: StatedSpeakers,
  holds: string,
): CodedFormat {
  return { container, speakers, rule: codedRule(name, speakers, holds) };
}

/** The coded formats, which state a layout by their codec's own mapping, each in its container. */
const CODEC_RULES: ReadonlyMap<CodecId, CodedFormat> = new Map([
  ['flac', coded('flac', 'FLAC', VORBIS_ORDER_SPEAKERS, VORBIS_ORDER_HOLDS)],
  ['vorbis', coded('ogg', 'Ogg Vorbis', VORBIS_ORDER_SPEAKERS, VORBIS_ORDER_HOLDS)],
  ['opus', coded('ogg', 'Opus', VORBIS_ORDER_SPEAKERS, VORBIS_ORDER_HOLDS)],
  [
    'aac-lc',
    coded(
      'mp4',
      'AAC',
      AAC_SPEAKERS,
      'mono, stereo, LCR, 4.0, 5.0, 5.1 and 7.1 with a front-centre pair by its channel configuration',
    ),
  ],
  ['mp3', coded('mp3', 'MP3', MP3_SPEAKERS, 'mono and stereo alone')],
]);

/**
 * The channel counts a coded format states a layout of, ascending, such as
 * AAC's configurations 1 to 7; `undefined` for a codec whose layout is stated
 * by its container instead, or that AudioGubbins does not write.
 */
export function statedChannelCounts(codec: CodecId): readonly number[] | undefined {
  const format = CODEC_RULES.get(codec);
  return format === undefined
    ? undefined
    : [...format.speakers.keys()].toSorted((left, right) => left - right);
}

/** The rule of a codec in a container, or `undefined` where AudioGubbins writes no such file. */
function ruleOf(codec: CodecId, container: ContainerId): LayoutRule | undefined {
  const coded = CODEC_RULES.get(codec);
  return (
    CONTAINER_RULES.get(container) ?? (coded?.container === container ? coded.rule : undefined)
  );
}

/**
 * The order a file of `codec` in `container` writes `layout`'s channels in,
 * or why it cannot state the layout. A WAV or AIFF writer takes the layout
 * itself and puts its channels in this order; a coded format's encoder is
 * handed them in it.
 */
export function writtenChannelOrder(
  codec: CodecId,
  container: ContainerId,
  layout: ChannelLayout,
): DomainResult<WrittenChannelOrder> {
  const rule = ruleOf(codec, container);
  return rule === undefined
    ? fail(
        unwritableLayout(
          `AudioGubbins writes no ${codec} file in ${container}, so it states no layout there.`,
        ),
      )
    : rule(layout);
}
