/**
 * A slice of a plan: a range of its sound, on some of its channels.
 *
 * Copying takes one (ADR-0053), and the slice keeps only the streams its
 * segments still read. Keeping some channels adds a matrix that selects them,
 * and the slice's layout keeps their roles and labels; a channel taken from an
 * ambisonic set is no longer one of a set, so it is kept as a discrete
 * channel.
 */

import { ChannelRole, channelLayout, type ChannelLayout } from '../audio/channel-layout.js';
import { mapResult, succeed, type DomainResult } from '../result.js';
import { selectionMatrix } from './channel-matrices.js';
import type { EditPlan } from './plan.js';
import { sliceSegments } from './segment-list.js';
import { pruneStreams } from './stream-tables.js';

/** The layout of `channels` taken from `layout`. */
function selectedLayout(
  layout: ChannelLayout,
  channels: readonly number[],
): DomainResult<ChannelLayout> {
  const roles = channels.map((channel) => {
    const role = layout.roles[channel] ?? ChannelRole.Discrete;
    return role === ChannelRole.Ambisonic ? ChannelRole.Discrete : role;
  });
  const labels =
    layout.labels === undefined
      ? undefined
      : channels.map((channel) => layout.labels?.[channel] ?? '');
  return channelLayout(roles, labels);
}

/**
 * The plan's sound from `start` to `end`, on `channels` where given, which
 * must be ascending channels of the plan; every channel where absent.
 */
export function slicePlan(
  plan: EditPlan,
  start: number,
  end: number,
  channels?: readonly number[],
): DomainResult<EditPlan> {
  const [stream, ...others] = plan.streams;
  const segments = sliceSegments(stream.segments, start, end);
  if (channels === undefined || channels.length === stream.layout.roles.length) {
    return succeed(pruneStreams({ streams: [{ ...stream, segments }, ...others] }));
  }
  const matrix = selectionMatrix(stream.layout.roles.length, channels);
  return mapResult(selectedLayout(stream.layout, channels), (layout) =>
    pruneStreams({
      streams: [
        {
          ...stream,
          layout,
          segments: segments.map((segment) => ({
            ...segment,
            stages: [...segment.stages, { kind: 'matrix', matrix }],
          })),
        },
        ...others,
      ],
    }),
  );
}
