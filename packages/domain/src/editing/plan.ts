/**
 * The edit plan: an edited sound as the segments of source it reads and the
 * stages each passes through (ADR-0051).
 *
 * One pure fold makes a plan from an asset's chain (`plan-building.ts`), and
 * the plan is the only description of what an edit sounds like: the engine
 * renders it, the peak worker summarises it and the clipboard copies a slice
 * of it. A plan is a list of streams. The first is the sound; any other is
 * material a segment of an earlier stream reads converted to that stream's
 * rate, which is how audio pasted from an asset of another rate is kept
 * without being resampled until it is heard (REQ-ARCH-085).
 *
 * A stream may also state processing (ADR-0060): a chain of processors run
 * over the whole stream from its own start, or a stretch to a stated length.
 * A segment that reads such a stream reads what the processing made, so a
 * range processed by a rack, a target's rack and a stretched range are each a
 * stream that an earlier stream reads, and the plan stays the only
 * description of an edited sound.
 *
 * A stage is stated in the frames of its segment's content, never in the
 * output's, so cutting, moving or reversing a segment never rewrites a stage:
 * a fade stays on the audio it was put on.
 */

import type { ChannelLayout } from '../audio/channel-layout.js';
import type { AssetId } from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import type { SampleCount, SampleRate } from '../time/sample-time.js';
import { FadeShape } from './fades.js';

/** What a segment reads: an asset's unchanged source, or a later stream of the plan. */
export type PlanSource =
  | { readonly kind: 'media'; readonly asset: AssetId }
  | { readonly kind: 'stream'; readonly stream: number };

/**
 * A fade's gain over its content: zero to one when `rising`, one to zero
 * when not, in `shape`.
 *
 * `origin` is the content frame where the fade began and `step` whether the
 * fade's frames run forwards (1) or backwards (−1) through the content, which
 * is how a fade made on reversed audio stays on that audio.
 */
export interface FadeCurve {
  readonly kind: 'fade';
  readonly origin: number;
  readonly step: 1 | -1;
  readonly length: number;
  readonly shape: FadeShape;
  readonly rising: boolean;
}

/** A stage's gain: one factor, or a fade. */
export type GainCurve = { readonly kind: 'constant'; readonly gain: number } | FadeCurve;

/**
 * One transformation a segment's content passes through.
 *
 * A gain multiplies `channels`, or every channel where absent, over the
 * content frames `[from, to)`. A matrix mixes every channel into a new set,
 * one row for each output channel; with no range it applies to the whole
 * segment, and it may then change how many channels there are.
 */
export type PlanStage =
  | {
      readonly kind: 'gain';
      readonly from: number;
      readonly to: number;
      readonly channels?: readonly number[];
      readonly gain: GainCurve;
    }
  | {
      readonly kind: 'matrix';
      readonly range?: { readonly from: number; readonly to: number };
      readonly matrix: readonly (readonly number[])[];
    };

/**
 * A span of a source, read forwards or backwards, through its stages.
 *
 * `start` and `length` are in the source's frames: an asset's at its own
 * rate, or a stream's once converted to this segment's stream's rate.
 */
export interface PlanSegment {
  readonly source: PlanSource;
  readonly start: SampleCount;
  readonly length: SampleCount;
  readonly reversed: boolean;
  readonly stages: readonly PlanStage[];
}

/**
 * What a stream's segments pass through as a whole.
 *
 * - `chain`: the chain, rendered from the stream's first frame with its
 *   latency compensated, keeping the stream's length; what it would add past
 *   the end is cut. It keeps the layout of the segments, or makes `layout`,
 *   the stream's, where the chain changes it.
 * - `stretch`: the segments made `length` frames long without a change of
 *   pitch.
 */
export type StreamProcessing =
  | { readonly kind: 'chain'; readonly chain: EffectChain; readonly input: ChannelLayout }
  | { readonly kind: 'stretch'; readonly length: SampleCount };

/**
 * A run of segments at one rate, and what processes them. Each segment ends
 * in the layout the stream's processing reads, `layout` where it has none.
 */
export interface PlanStream {
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly segments: readonly PlanSegment[];
  readonly processing?: StreamProcessing;
}

/** An edited sound: its first stream, and the streams its segments read converted. */
export interface EditPlan {
  readonly streams: readonly [PlanStream, ...PlanStream[]];
}

/** Whether any segment of the plan reads the asset's source. */
export function planReadsAsset(plan: EditPlan, asset: AssetId): boolean {
  return plan.streams.some((stream) =>
    stream.segments.some(
      (segment) => segment.source.kind === 'media' && segment.source.asset === asset,
    ),
  );
}

/** How many frames a stream's segments hold, before its processing. */
export function segmentsLength(stream: Pick<PlanStream, 'segments'>): number {
  let length = 0;
  for (const segment of stream.segments) length += segment.length;
  return length;
}

/** How many frames a stream makes: its segments', or the length a stretch makes them. */
export function streamLength(stream: PlanStream): number {
  return stream.processing?.kind === 'stretch' ? stream.processing.length : segmentsLength(stream);
}

/** The layout a stream's segments end in: what its chain reads, or the stream's own. */
export function segmentsLayout(stream: PlanStream): ChannelLayout {
  return stream.processing?.kind === 'chain' ? stream.processing.input : stream.layout;
}

/**
 * How many frames `length` frames at `from` become at `to`: the ceiling of
 * `length · to / from`, exactly, as the canonical resampler makes them.
 */
export function convertedFrameCount(length: number, from: number, to: number): number {
  return Number((BigInt(length) * BigInt(to) + BigInt(from) - 1n) / BigInt(from));
}

/** A fade shape at `t` in `[0, 1]`, by addition, multiplication and the square root. */
function fadeShapeAt(shape: FadeShape, t: number): number {
  switch (shape) {
    case FadeShape.Linear:
      return t;
    case FadeShape.EqualPower:
      return Math.sqrt(t);
    case FadeShape.SCurve:
      return t * t * (3 - 2 * t);
    case FadeShape.Square:
      return t * t;
  }
}

/**
 * A gain curve's factor at content frame `frame`.
 *
 * A fade's `t` runs from 0 on its first frame to 1 on its last, so a fade in
 * starts silent and ends whole, and a falling fade is its rising shape read
 * backwards, which keeps an equal-power pair equal in power.
 */
export function gainAt(curve: GainCurve, frame: number): number {
  if (curve.kind === 'constant') return curve.gain;
  // Subtracted the way round the step says rather than multiplied by it, so
  // the fade's first frame is +0 and never −0, whose sign would reach the
  // sample it multiplies.
  const k = curve.step === 1 ? frame - curve.origin : curve.origin - frame;
  const t = curve.length > 1 ? k / (curve.length - 1) : 1;
  return fadeShapeAt(curve.shape, curve.rising ? t : 1 - t);
}
