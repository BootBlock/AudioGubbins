/**
 * Whether a plan, or a payload made from one, is whole: every segment reads a
 * range its source has, every stage fits the channels it is given, every
 * stream it reads comes after its own, and each stream ends with the channels
 * its layout states.
 *
 * A payload arrives in an insertion that a journal, a bundle or another tab
 * may have written, so it is checked here, once, by the same rule wherever it
 * is read (REQ-EXEC-136.12), before anything renders it.
 */

import { MAXIMUM_CHANNEL_COUNT, channelCount } from '../audio/channel-layout.js';
import type { AssetId } from '../identity/branded-id.js';
import type { Asset } from '../project/asset.js';
import { FailureKind, fail, failure, succeed, type DomainResult } from '../result.js';
import { MAXIMUM_EDIT_GAIN } from './operations.js';
import { validateChainShape } from '../processing/chain-validation.js';
import {
  convertedFrameCount,
  segmentsLayout,
  segmentsLength,
  streamLength,
  type EditPlan,
  type GainCurve,
  type PlanSegment,
  type PlanStage,
  type PlanStream,
} from './plan.js';

/** What a plan needs to know of an asset it reads: its rate, layout and length. */
export type MediaShape = Pick<Asset, 'sampleRate' | 'channelLayout' | 'length'>;

/** A refusal of a malformed plan, naming where it is. */
function malformed(summary: string, at: string): DomainResult<never> {
  return fail(
    failure('editing.plan-malformed', FailureKind.Rejected, summary, { details: { at } }),
  );
}

/**
 * The most a stretch may change a length by, either way: eightfold, past
 * which a stretch no longer keeps the character of what it stretches.
 */
export const MAXIMUM_STRETCH_RATIO = 8;

/** Whether `value` is a whole number of frames from zero. */
function isFrame(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Whether a gain factor lies within the bound an edit allows, either sign. */
export function isEditGain(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAXIMUM_EDIT_GAIN;
}

/** Whether `channels` is a non-empty, ascending set of channels of `count`. */
export function isChannelScope(channels: readonly number[], count: number): boolean {
  return (
    channels.length > 0 &&
    channels.every(
      (channel, index) =>
        Number.isInteger(channel) &&
        channel >= 0 &&
        channel < count &&
        (index === 0 || channel > (channels[index - 1] ?? -1)),
    )
  );
}

/** Whether a matrix mixes `inputs` channels with finite, bounded factors. */
export function isChannelMatrix(matrix: readonly (readonly number[])[], inputs: number): boolean {
  return (
    matrix.length > 0 &&
    matrix.length <= 256 &&
    matrix.every((row) => row.length === inputs && row.every(isEditGain))
  );
}

function curveProblem(curve: GainCurve): string | undefined {
  if (curve.kind === 'constant') {
    return isEditGain(curve.gain) ? undefined : 'A gain lies outside the bound an edit allows.';
  }
  return Number.isSafeInteger(curve.origin) &&
    Number.isSafeInteger(curve.length) &&
    curve.length > 0
    ? undefined
    : 'A fade does not span a whole number of frames.';
}

/** The channels a stage leaves, or why it does not fit the `count` it is given. */
function stageChannels(stage: PlanStage, count: number): number | string {
  if (stage.kind === 'gain') {
    if (!isFrame(stage.from) || !isFrame(stage.to) || stage.from >= stage.to) {
      return 'A gain stage covers no frames.';
    }
    if (stage.channels !== undefined && !isChannelScope(stage.channels, count)) {
      return 'A gain stage names channels its segment does not have.';
    }
    return curveProblem(stage.gain) ?? count;
  }
  if (!isChannelMatrix(stage.matrix, count)) return 'A matrix does not fit its segment’s channels.';
  if (stage.range === undefined) return stage.matrix.length;
  const ranged = stage.range;
  if (!isFrame(ranged.from) || !isFrame(ranged.to) || ranged.from >= ranged.to) {
    return 'A matrix stage covers no frames.';
  }
  return stage.matrix.length === count ? count : 'A matrix over a range changes the channel count.';
}

/** Why a segment of stream `place` does not hold, or `undefined` where it does. */
function segmentProblem(
  plan: EditPlan,
  place: number,
  segment: PlanSegment,
  assets: ReadonlyMap<AssetId, MediaShape>,
): string | undefined {
  const stream = plan.streams[place];
  if (stream === undefined) return 'A segment belongs to no stream.';
  if (!isFrame(segment.start) || !isFrame(segment.length) || segment.length === 0) {
    return 'A segment covers no frames.';
  }
  let available: number;
  let channels: number;
  if (segment.source.kind === 'media') {
    const asset = assets.get(segment.source.asset);
    if (asset === undefined) return 'A segment reads an asset the project does not have.';
    if (asset.sampleRate !== stream.sampleRate) return 'A segment reads an asset at another rate.';
    available = asset.length;
    channels = channelCount(asset.channelLayout);
  } else if (segment.source.kind === 'silence') {
    const { channels: count } = segment.source;
    if (!Number.isInteger(count) || count < 1 || count > MAXIMUM_CHANNEL_COUNT) {
      return 'A segment of silence has no channel count a layout may have.';
    }
    // Silence lasts as long as it is read, so only the arithmetic bounds it.
    available = Number.MAX_SAFE_INTEGER;
    channels = count;
  } else {
    const read = plan.streams[segment.source.stream];
    if (segment.source.stream <= place || read === undefined) {
      return 'A segment reads a stream that does not follow its own.';
    }
    available = convertedFrameCount(streamLength(read), read.sampleRate, stream.sampleRate);
    channels = channelCount(read.layout);
  }
  if (segment.start + segment.length > available)
    return 'A segment reads past the end of its source.';
  for (const stage of segment.stages) {
    const after = stageChannels(stage, channels);
    if (typeof after === 'string') return after;
    channels = after;
  }
  return channels === channelCount(segmentsLayout(stream))
    ? undefined
    : 'A segment does not end with its stream’s channels.';
}

/** Why a stream's processing does not hold, or `undefined` where it does. */
function processingProblem(stream: PlanStream, place: number): string | undefined {
  const { processing } = stream;
  if (processing === undefined) return undefined;
  // The first stream is what is heard; processing it would leave nothing to
  // hold the processed audio's place, so it is only ever done by a stream
  // the first reads.
  if (place === 0) return 'The first stream of a plan is processed only through a stream it reads.';
  if (processing.kind === 'chain') {
    return validateChainShape(processing.chain).ok ? undefined : 'A stream’s chain is malformed.';
  }
  const before = segmentsLength(stream);
  return isFrame(processing.length) &&
    processing.length > 0 &&
    processing.length <= before * MAXIMUM_STRETCH_RATIO &&
    processing.length * MAXIMUM_STRETCH_RATIO >= before
    ? undefined
    : 'A stretched stream’s length lies outside what a stretch can make.';
}

/** The plan, where every stream after the first is read and every segment holds. */
export function validatePlan(
  plan: EditPlan,
  assets: ReadonlyMap<AssetId, MediaShape>,
): DomainResult<EditPlan> {
  const read = new Set<number>([0]);
  for (const [place, stream] of plan.streams.entries()) {
    if (!read.has(place))
      return malformed('A stream is read by no segment.', `streams/${String(place)}`);
    if (stream.segments.length === 0)
      return malformed('A stream holds no audio.', `streams/${String(place)}`);
    const processing = processingProblem(stream, place);
    if (processing !== undefined) return malformed(processing, `streams/${String(place)}`);
    for (const [index, segment] of stream.segments.entries()) {
      const problem = segmentProblem(plan, place, segment, assets);
      if (problem !== undefined)
        return malformed(problem, `streams/${String(place)}/segments/${String(index)}`);
      if (segment.source.kind === 'stream') read.add(segment.source.stream);
    }
  }
  return succeed(plan);
}
