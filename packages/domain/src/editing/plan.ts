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
 * Two kinds of processing exist only in plans made for hearing a game's
 * preview (ADR-0104), never in a project's own plans: a stream played faster
 * or slower by a ratio (`varispeed`), and the automation of a chain's
 * parameters along its stream. A third thing belongs to such a plan alone: a
 * stream's frames it no longer describes (`forgottenBefore`), so a preview that
 * plays for a long time drops what has been heard. A project keeps none of
 * them, and refuses any in a plan it stores.
 *
 * A stage is stated in the frames of its segment's content, never in the
 * output's, so cutting, moving or reversing a segment never rewrites a stage:
 * a fade stays on the audio it was put on.
 */

import { channelCount, type ChannelLayout } from '../audio/channel-layout.js';
import type { AssetId, ParameterId, ProcessorId } from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import type { PlannedSpectralEdit } from '../spectral/spectral-edit.js';
import { ZERO_SAMPLES, type SampleCount, type SampleRate } from '../time/sample-time.js';
import { FadeShape } from './fades.js';

/**
 * What a segment reads: an asset's unchanged source, a later stream of the
 * plan, generated silence of `channels` channels at its stream's rate, or a
 * mix of later streams.
 *
 * Silence is a source of its own, rather than a range of some asset with its
 * gain at zero, so inserted silence reads no file, is as long as it is asked
 * to be whatever the asset holds, and is digital zero whatever stages it
 * meets. It is the same at every frame, so a segment's `start` on it moves
 * nothing it makes.
 *
 * A mix is the sample-wise sum, in the order `streams` states, of the same
 * frames of two or more later streams, each at the reading stream's rate and
 * all of one layout (`sumInto` in `stage-arithmetic.ts`). It is how a punch
 * crosses from the earlier audio into its take (ADR-0072): each boundary
 * reads the two faded, summed.
 */
export type PlanSource =
  | { readonly kind: 'media'; readonly asset: AssetId }
  | { readonly kind: 'stream'; readonly stream: number }
  | { readonly kind: 'silence'; readonly channels: number }
  | { readonly kind: 'mix'; readonly streams: readonly number[] };

/** The later streams `source` reads: one, those it mixes, or none. */
export function sourceStreams(source: PlanSource): readonly number[] {
  switch (source.kind) {
    case 'stream':
      return [source.stream];
    case 'mix':
      return source.streams;
    case 'media':
    case 'silence':
      return [];
  }
}

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

/** A parameter's value at a frame of its stream. */
export interface AutomationPoint {
  readonly frame: number;
  readonly value: number;
}

/**
 * One numeric parameter of one processor of a stream's chain, moved along the
 * stream: at least one point, at whole frames from 0, each after the one
 * before. Its value at a frame is {@link automationValueAt}'s.
 */
export interface ParameterAutomation {
  readonly processor: ProcessorId;
  readonly parameter: ParameterId;
  readonly points: readonly AutomationPoint[];
}

/**
 * The fixed denominator of a varispeed ratio: a ratio is a whole number of
 * 4,096ths, 0.42 cents apart at unison, so the canonical resampler that plays
 * it has at most 4,096 phases, whatever the ratio.
 */
export const VARISPEED_DENOMINATOR = 4_096;

/**
 * The least and the most numerator of a varispeed ratio: two octaves down and
 * two up (±2,400 cents), as far as a game engine's pitch scale is asked to go.
 */
export const VARISPEED_NUMERATORS = { least: 1_024, most: 16_384 } as const;

/**
 * What a stream's segments pass through as a whole.
 *
 * - `chain`: the chain, rendered from the stream's first frame with its
 *   latency compensated, keeping the stream's length; what it would add past
 *   the end is cut. It keeps the layout of the segments, or makes `layout`,
 *   the stream's, where the chain changes it.
 * - `stretch`: the segments made `length` frames long without a change of
 *   pitch.
 * - `spectral`: the segments plus the masked change a spectral edit makes of
 *   each frame (ADR-0081), keeping their length and layout; a frame's place
 *   is counted from the stream's first frame, so any part of the stream is
 *   the same whichever is read first.
 * - `varispeed`: the stream's one segment, which reads one later stream of
 *   its rate and layout, played at `numerator / denominator` of its speed, so
 *   its pitch and its speed change together, as a game engine's pitch scale
 *   does (ADR-0104). The canonical resampler plays it with `denominator`
 *   output frames for each `numerator` input frames, the ratio reduced, so no
 *   rate is declared for it; it makes {@link convertedFrameCount} of the
 *   segment's frames by those steps.
 *
 * A chain's `automation` moves its processors' numeric parameters along the
 * stream, each lane linear between its points and held before the first and
 * after the last, given to its processor at the processor's design interval
 * (`DESIGN_INTERVAL` of `@audiogubbins/processors`) from the stream's first
 * frame, so a motion renders the same offline as it plays.
 */
export type StreamProcessing =
  | {
      readonly kind: 'chain';
      readonly chain: EffectChain;
      readonly input: ChannelLayout;
      readonly automation?: readonly ParameterAutomation[];
    }
  | { readonly kind: 'stretch'; readonly length: SampleCount }
  | { readonly kind: 'spectral'; readonly edit: PlannedSpectralEdit }
  | {
      readonly kind: 'varispeed';
      readonly numerator: number;
      readonly denominator: typeof VARISPEED_DENOMINATOR;
    };

/**
 * A run of segments at one rate, and what processes them. Each segment ends
 * in the layout the stream's processing reads, `layout` where it has none.
 *
 * `forgottenBefore`, which only a game preview's plan states (ADR-0104), is
 * the first frame of the stream it still describes: a plan that continues
 * another, its playback already past that frame, has dropped what came before,
 * its segments standing in for it at their lengths only, so a stream keeps its
 * place and the frames of everything after. A continuation compares the
 * stream with the one it continues only from that frame, and its chain's
 * automation only from that frame on. A stream forgotten whole holds a place
 * alone, kept where nothing reads it, so the streams after it keep theirs.
 */
export interface PlanStream {
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly segments: readonly PlanSegment[];
  readonly processing?: StreamProcessing;
  readonly forgottenBefore?: SampleCount;
}

/** Whether `stream` is forgotten whole: a place kept for the streams after it. */
export function forgottenWhole(stream: PlanStream): boolean {
  return (
    stream.forgottenBefore !== undefined &&
    stream.forgottenBefore > 0 &&
    stream.forgottenBefore === segmentsLength(stream)
  );
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

/**
 * A plan of `length` frames of silence at `sampleRate` in `layout`: what an
 * insertion of generated silence inserts (REQ-AUDIO-018), which takes the
 * rate and layout of the asset it joins.
 */
export function silencePlan(
  sampleRate: SampleRate,
  layout: ChannelLayout,
  length: SampleCount,
): EditPlan {
  return {
    streams: [
      {
        sampleRate,
        layout,
        segments: [
          {
            source: { kind: 'silence', channels: channelCount(layout) },
            start: ZERO_SAMPLES,
            length,
            reversed: false,
            stages: [],
          },
        ],
      },
    ],
  };
}

/** Whether every segment of the plan reads generated silence, so all it makes is silence. */
export function planIsSilence(plan: EditPlan): boolean {
  return plan.streams.every((stream) =>
    stream.segments.every((segment) => segment.source.kind === 'silence'),
  );
}

/** How many frames a stream's segments hold, before its processing. */
export function segmentsLength(stream: Pick<PlanStream, 'segments'>): number {
  let length = 0;
  for (const segment of stream.segments) length += segment.length;
  return length;
}

/**
 * How many frames a stream makes: its segments', the length a stretch makes
 * them, or as many as a varispeed plays them in.
 */
export function streamLength(stream: PlanStream): number {
  const { processing } = stream;
  if (processing?.kind === 'stretch') return processing.length;
  if (processing?.kind === 'varispeed') {
    return convertedFrameCount(
      segmentsLength(stream),
      processing.numerator,
      processing.denominator,
    );
  }
  return segmentsLength(stream);
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

/**
 * An automation lane's value at `frame`: its first point's before it, its last
 * point's after it, and between two, `v₀ + (v₁ − v₀)·(f − f₀)/(f₁ − f₀)`, in
 * that order of operations.
 */
export function automationValueAt(points: readonly AutomationPoint[], frame: number): number {
  // The first point after `frame`, found by halving, since a lane may hold many.
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((points[middle]?.frame ?? 0) <= frame) low = middle + 1;
    else high = middle;
  }
  const next = points[low];
  const previous = points[low - 1];
  if (previous === undefined) return next?.value ?? 0;
  if (next === undefined) return previous.value;
  return (
    previous.value +
    ((next.value - previous.value) * (frame - previous.frame)) / (next.frame - previous.frame)
  );
}
