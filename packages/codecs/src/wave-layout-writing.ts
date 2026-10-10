/**
 * How a WAV export states its channel layout (ADR-0093).
 *
 * A speaker mask names speakers, and a file's channels follow its speakers in
 * the mask's bit order, so the export writes its speakers in that order and its
 * other channels after them, in the order they came: 7.1, which the domain
 * holds with the side pair before the rear pair, is written with the rear pair
 * first, as every reader of the mask expects. The layout the file states is
 * that order, which reading it gives back. Where no mask can say all of the
 * layout (an ambisonic set, named channels, one or two discrete channels, or a
 * centre alone), the file also states it whole in `iXML` (`ixml-layout.ts`). A
 * header that states no layout serves where the format's default is the layout,
 * as for mono, stereo and three or more discrete channels.
 */

import {
  ChannelRole,
  channelLayout,
  layoutsMatch,
  mapResult,
  succeed,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';

import { speakerBitOf, speakerMaskLayout, speakerMaskOf } from './channel-layouts.js';
import { layoutRead } from './format-descriptor.js';
import { ixmlLayoutChunk } from './ixml-layout.js';
import type { WrittenChunk } from './written-chunk.js';

/** How a WAV file states a layout. */
export interface WaveLayoutPlan {
  /** For each channel of the file, the index of the channel it is in the given layout. */
  readonly order: readonly number[];

  /** The layout the file states, in its own channel order, which reading it gives back. */
  readonly written: ChannelLayout;

  /** Whether a header that states no layout is read back as `written`. */
  readonly unstatedReads: boolean;

  /** The speaker mask the extensible form states. */
  readonly channelMask: number;

  /** The `iXML` chunk stating the layout whole, where the mask cannot. */
  readonly ixml: WrittenChunk | undefined;
}

/** The channel indices of a layout, its speakers in the mask's bit order and the rest after. */
function maskOrder(layout: ChannelLayout): readonly number[] {
  const indices = layout.roles.map((role, index) => ({ index, bit: speakerBitOf(role) }));
  return [
    ...indices
      .filter((entry) => entry.bit !== undefined)
      .sort((left, right) => (left.bit ?? 0) - (right.bit ?? 0)),
    ...indices.filter((entry) => entry.bit === undefined),
  ].map((entry) => entry.index);
}

/** A layout's channels in another order, with their names. */
function reordered(layout: ChannelLayout, order: readonly number[]): DomainResult<ChannelLayout> {
  const roles = order.map((index) => layout.roles[index] ?? ChannelRole.Discrete);
  const { labels } = layout;
  return channelLayout(
    roles,
    labels === undefined ? undefined : order.map((index) => labels[index] ?? ''),
  );
}

/** Whether a header stating `stated`, or nothing, is read back as `layout`. */
function readsAs(stated: ChannelLayout | undefined, layout: ChannelLayout): boolean {
  const read = layoutRead(stated, layout.roles.length);
  return read.ok && layoutsMatch(read.value, layout);
}

/** How a WAV file states `layout`. */
export function waveLayoutPlan(layout: ChannelLayout): DomainResult<WaveLayoutPlan> {
  const count = layout.roles.length;
  if (layout.ambisonic !== undefined) {
    // An ambisonic set's channels are its components in its own order, which no mask places.
    return succeed({
      order: layout.roles.map((_, index) => index),
      written: layout,
      unstatedReads: false,
      channelMask: 0,
      ixml: ixmlLayoutChunk(layout),
    });
  }
  const order = maskOrder(layout);
  return mapResult(reordered(layout, order), (written) => {
    const speakers = speakerMaskOf(written) ?? 0;
    const maskRead = speakerMaskLayout(speakers, count);
    // A mask whose speakers are not the channels' roles, as the centre alone reads as mono, places none.
    const placed = maskRead?.roles.every((role, index) => written.roles[index] === role) ?? false;
    return {
      order,
      written,
      unstatedReads: readsAs(undefined, written),
      channelMask: placed ? speakers : 0,
      ixml: readsAs(maskRead, written) ? undefined : ixmlLayoutChunk(written),
    };
  });
}
