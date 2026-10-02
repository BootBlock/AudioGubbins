/**
 * The stage a range edit gives each segment it covers.
 *
 * An edit is made over a range of output; a stage is kept in its segment's
 * content frames (`plan.ts`). A gain, a silence and an inversion are the same
 * factor on every frame, so only their window is translated. A fade's frames
 * are counted from where the fade began in the output, so each segment's
 * stage records the content frame of the fade's first output frame and which
 * way the fade runs through its content, and a fade across several segments,
 * reversed or not, is one continuous ramp.
 */

import type { PlanSegment, PlanStage } from './plan.js';
import { copyMatrix, gainsMatrix, swapMatrix, type ChannelMatrix } from './channel-matrices.js';
import {
  FadeDirection,
  isLevelEdit,
  type ChannelEdit,
  type LevelEdit,
  type RangeEdit,
} from './operations.js';

/**
 * The output span an edit was made over. Its start may lie before the part of
 * the audio a region shows, which is how a fade begun outside a region keeps
 * its ramp inside it.
 */
interface MadeOver {
  readonly start: number;
  readonly end: number;
}

/** The gain a level edit puts on a segment that begins at `segmentStart` in its stream. */
function levelStage(
  edit: LevelEdit,
  range: MadeOver,
  channels: readonly number[] | undefined,
  segment: PlanSegment,
  segmentStart: number,
): PlanStage {
  const window = { from: segment.start, to: segment.start + segment.length };
  const scope = channels === undefined ? {} : { channels };
  switch (edit.kind) {
    case 'gain':
      return { kind: 'gain', ...window, ...scope, gain: { kind: 'constant', gain: edit.gain } };
    case 'silence':
      return { kind: 'gain', ...window, ...scope, gain: { kind: 'constant', gain: 0 } };
    case 'invert':
      return { kind: 'gain', ...window, ...scope, gain: { kind: 'constant', gain: -1 } };
    case 'fade': {
      const origin = segment.reversed
        ? segment.start + segment.length - 1 + segmentStart - range.start
        : segment.start + range.start - segmentStart;
      return {
        kind: 'gain',
        ...window,
        ...scope,
        gain: {
          kind: 'fade',
          origin,
          step: segment.reversed ? -1 : 1,
          length: range.end - range.start,
          shape: edit.shape,
          rising: edit.direction === FadeDirection.In,
        },
      };
    }
  }
}

/** The matrix a channel edit mixes `count` channels with. */
function channelEditMatrix(edit: ChannelEdit, count: number): ChannelMatrix {
  switch (edit.kind) {
    case 'swap-channels':
      return swapMatrix(count, edit.first, edit.second);
    case 'copy-channel':
      return copyMatrix(count, edit.from, edit.to);
    case 'channel-gains':
      return gainsMatrix(edit.gains);
  }
}

/**
 * What `edit` over `range` does to a segment inside the range that begins at
 * `segmentStart`, on a stream of `count` channels.
 */
export function rangeEditStage(
  edit: RangeEdit,
  range: MadeOver,
  channels: readonly number[] | undefined,
  count: number,
): (segment: PlanSegment, segmentStart: number) => PlanSegment {
  return (segment, segmentStart) => {
    const stage: PlanStage = isLevelEdit(edit)
      ? levelStage(edit, range, channels, segment, segmentStart)
      : {
          kind: 'matrix',
          range: { from: segment.start, to: segment.start + segment.length },
          matrix: channelEditMatrix(edit, count),
        };
    return { ...segment, stages: [...segment.stages, stage] };
  };
}
