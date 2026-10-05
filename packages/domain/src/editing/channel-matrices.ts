/**
 * The channel matrices an edit mixes with: a swap, a copy, per-channel gains,
 * a selection of channels, and the conversion between two layouts.
 *
 * A matrix has one row for each output channel and one column for each input
 * channel. The conversion between layouts is stated by role, so it is the same
 * whichever command asks for it (REQ-EDIT-015): a role both layouts have is
 * carried across whole; a front centre, a surround or a rear channel the
 * destination lacks is folded into its left and right at minus three decibels,
 * as ITU-R BS.775 downmixes; the low-frequency channel is not folded, since a
 * full-range channel must not carry it; a mono source goes to the centre where
 * there is one and to the left and right otherwise; and a mono destination
 * takes the average of the left and right the source folds to. Layouts whose
 * channels have no position (discrete or ambisonic) have no stated conversion
 * except to themselves; their channels are remapped explicitly.
 */

import {
  ChannelRole,
  channelIndexOf,
  layoutsMatch,
  type ChannelLayout,
} from '../audio/channel-layout.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';

/** A channel matrix: one row for each output channel, one column for each input. */
export type ChannelMatrix = readonly (readonly number[])[];

/**
 * Minus three decibels, as a constant rather than a computed root so every
 * machine folds with the same factor.
 */
const MINUS_THREE_DECIBELS = 0.7071067811865476;

/** Where a role the destination lacks is folded: into the left, the right, or both. */
const FOLDS: ReadonlyMap<ChannelRole, readonly ChannelRole[]> = new Map([
  [ChannelRole.Centre, [ChannelRole.Left, ChannelRole.Right]],
  [ChannelRole.FrontLeftOfCentre, [ChannelRole.Left]],
  [ChannelRole.FrontRightOfCentre, [ChannelRole.Right]],
  [ChannelRole.SurroundLeft, [ChannelRole.Left]],
  [ChannelRole.SurroundRight, [ChannelRole.Right]],
  [ChannelRole.RearLeft, [ChannelRole.Left]],
  [ChannelRole.RearRight, [ChannelRole.Right]],
  [ChannelRole.RearCentre, [ChannelRole.Left, ChannelRole.Right]],
  [ChannelRole.TopCentre, [ChannelRole.Left, ChannelRole.Right]],
  [ChannelRole.TopFrontLeft, [ChannelRole.Left]],
  [ChannelRole.TopFrontCentre, [ChannelRole.Left, ChannelRole.Right]],
  [ChannelRole.TopFrontRight, [ChannelRole.Right]],
  [ChannelRole.TopRearLeft, [ChannelRole.Left]],
  [ChannelRole.TopRearCentre, [ChannelRole.Left, ChannelRole.Right]],
  [ChannelRole.TopRearRight, [ChannelRole.Right]],
]);

/** Roles that place a channel in space, which a conversion can reason about. */
const UNPLACED: ReadonlySet<ChannelRole> = new Set([ChannelRole.Discrete, ChannelRole.Ambisonic]);

/** A matrix of zeros, `outputs` by `inputs`. */
function zeros(outputs: number, inputs: number): number[][] {
  return Array.from({ length: outputs }, () => new Array<number>(inputs).fill(0));
}

/** The matrix that leaves `count` channels as they are. */
function identityMatrix(count: number): ChannelMatrix {
  const rows = zeros(count, count);
  rows.forEach((row, index) => (row[index] = 1));
  return rows;
}

/** Exchanges two channels of `count`. */
export function swapMatrix(count: number, first: number, second: number): ChannelMatrix {
  const rows = zeros(count, count);
  rows.forEach((row, index) => {
    const source = index === first ? second : index === second ? first : index;
    row[source] = 1;
  });
  return rows;
}

/** Puts channel `from`'s content on channel `to` as well, of `count`. */
export function copyMatrix(count: number, from: number, to: number): ChannelMatrix {
  const rows = zeros(count, count);
  rows.forEach((row, index) => (row[index === to ? from : index] = 1));
  return rows;
}

/** Multiplies each channel by its own gain. */
export function gainsMatrix(gains: readonly number[]): ChannelMatrix {
  const rows = zeros(gains.length, gains.length);
  rows.forEach((row, index) => (row[index] = gains[index] ?? 1));
  return rows;
}

/** Keeps only `channels` of `count`, in that order. */
export function selectionMatrix(count: number, channels: readonly number[]): ChannelMatrix {
  const rows = zeros(channels.length, count);
  rows.forEach((row, index) => (row[channels[index] ?? 0] = 1));
  return rows;
}

/** The layout a role-by-role conversion folds a source into before a mono destination averages it. */
function foldInto(from: ChannelLayout, to: ChannelLayout): number[][] {
  const rows = zeros(to.roles.length, from.roles.length);
  from.roles.forEach((role, input) => {
    const same = channelIndexOf(to, role);
    if (same !== undefined) {
      (rows[same] ?? [])[input] = 1;
      return;
    }
    for (const target of FOLDS.get(role) ?? []) {
      const output = channelIndexOf(to, target);
      if (output !== undefined) (rows[output] ?? [])[input] = MINUS_THREE_DECIBELS;
    }
  });
  return rows;
}

/** A mono source spread to a destination: its centre, or its left and right. */
function spreadMono(to: ChannelLayout): number[][] {
  const rows = zeros(to.roles.length, 1);
  const centre = channelIndexOf(to, ChannelRole.Centre);
  const targets =
    centre !== undefined
      ? [centre]
      : [channelIndexOf(to, ChannelRole.Left), channelIndexOf(to, ChannelRole.Right)];
  for (const output of targets) if (output !== undefined) (rows[output] ?? [])[0] = 1;
  return rows;
}

/** No stated conversion between two layouts, with the reason. */
function unstated(reason: string): DomainResult<ChannelMatrix> {
  return fail(failure('editing.no-layout-conversion', FailureKind.Rejected, reason));
}

/** The matrix that converts audio in `from` to `to`, by the rule above. */
export function conversionMatrix(
  from: ChannelLayout,
  to: ChannelLayout,
): DomainResult<ChannelMatrix> {
  if (layoutsMatch(from, to)) return succeed(identityMatrix(from.roles.length));
  if ([...from.roles, ...to.roles].some((role) => UNPLACED.has(role))) {
    return unstated(
      'Channels with no position, discrete or ambisonic, have no stated conversion; remap them channel by channel instead.',
    );
  }
  if (from.roles.length === 1 && to.roles.length === 1) return succeed([[1]]);
  if (from.roles.length === 1) return succeed(spreadMono(to));
  if (to.roles.length === 1) {
    const stereo = foldInto(from, { roles: [ChannelRole.Left, ChannelRole.Right] });
    const [left = [], right = []] = stereo;
    return succeed([left.map((value, index) => (value + (right[index] ?? 0)) / 2)]);
  }
  const rows = foldInto(from, to);
  const heard = rows.some((row) => row.some((value) => value !== 0));
  return heard
    ? succeed(rows)
    : unstated('The two layouts share no channel that one could be folded into.');
}
