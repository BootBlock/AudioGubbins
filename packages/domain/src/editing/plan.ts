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
 * A stage is stated in the frames of its segment's content, never in the
 * output's, so cutting, moving or reversing a segment never rewrites a stage:
 * a fade stays on the audio it was put on.
 */

import type { ChannelLayout } from '../audio/channel-layout.js';
import type { AssetId } from '../identity/branded-id.js';
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

/** A run of segments at one rate and layout. */
export interface PlanStream {
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly segments: readonly PlanSegment[];
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

/** How many frames a stream holds. */
export function streamLength(stream: PlanStream): number {
  let length = 0;
  for (const segment of stream.segments) length += segment.length;
  return length;
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
