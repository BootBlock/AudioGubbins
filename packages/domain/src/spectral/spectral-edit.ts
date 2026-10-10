/**
 * A spectral edit: a change to an area of time and frequency, as a value
 * (ADR-0081).
 *
 * It is a range edit, carried by a `process` operation as a gain is, so it
 * changes no time and is anchored, folded, undone and persisted as every
 * range edit is (ADR-0051). Its mask is stated relative to the start of the
 * operation's range. The plan realises it as a stream whose output is its
 * input plus the overlap-added change of each frame the mask reaches, so
 * every sample no changed frame reaches is its input, bit for bit; frames are
 * `resolution` samples long, centred from the range's start at the hop the
 * quality's spectral overlap gives.
 */

import type { ChannelLayout } from '../audio/channel-layout.js';
import type { EffectChainId } from '../identity/branded-id.js';
import type { EffectChain } from '../processing/effect-chain.js';
import { FEWEST_SPECTRAL_OVERLAP } from '../processing/quality-mode.js';
import { derivedSampleCount, type SampleCount } from '../time/sample-time.js';
import { maskProblem } from './mask-validation.js';
import { maskSupport, translatedMask, type SpectralMask } from './spectral-mask.js';

/**
 * What a spectral edit does under its mask, weighted by the mask.
 *
 * - `attenuate`: multiplies by `gain`, a linear factor from 0, which removes,
 *   to just below 1. A factor rather than decibels, as a level edit's gain
 *   is: the person's decibels are converted once, where they are typed.
 * - `isolate`: multiplies everything outside the mask, within its time span,
 *   by `gain`, so what the mask holds is left alone.
 * - `heal`: replaces each bin's magnitude with one interpolated across time
 *   from up to four frames each side that border the mask, keeping the phase;
 *   a frame that reaches outside the stream borders nothing, since what it
 *   holds there is not the sound.
 * - `process`: takes the output of the chain `chain` names, run over the
 *   range, in place of the input (ADR-0060), which is how a restoration or a
 *   model processor is applied to an area.
 */
export type SpectralEditOperation =
  | { readonly kind: 'attenuate'; readonly gain: number }
  | { readonly kind: 'isolate'; readonly gain: number }
  | { readonly kind: 'heal' }
  | { readonly kind: 'process'; readonly chain: EffectChainId };

/** The kinds of spectral operation. */
export type SpectralOperationKind = SpectralEditOperation['kind'];

/** A change to an area of time and frequency, over the range of the operation that carries it. */
export interface SpectralEdit {
  readonly kind: 'spectral';
  /** Relative to the start of the operation's range. */
  readonly mask: SpectralMask;
  /** The frames' length, a power of two from 256 to 16,384. */
  readonly resolution: number;
  readonly operation: SpectralEditOperation;
}

/** The most frames each border of a heal is measured over. */
export const HEAL_BORDER_FRAMES = 4;

/** The shortest frame a spectral edit may analyse with. */
export const SMALLEST_SPECTRAL_RESOLUTION = 256;

/** The longest frame a spectral edit may analyse with. */
export const LARGEST_SPECTRAL_RESOLUTION = 16_384;

/** The frame a spectral edit analyses with unless the person chooses another. */
export const DEFAULT_SPECTRAL_RESOLUTION = 2_048;

/** Whether `value` is a resolution this build analyses with. */
export function isSpectralResolution(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= SMALLEST_SPECTRAL_RESOLUTION &&
    value <= LARGEST_SPECTRAL_RESOLUTION &&
    (value & (value - 1)) === 0
  );
}

/**
 * The operation as the plan carries it: a `process` operation with its chain
 * read from the project, as a rack edit's is (`StreamProcessing`).
 */
export type PlannedSpectralOperation =
  | Exclude<SpectralEditOperation, { readonly kind: 'process' }>
  | { readonly kind: 'process'; readonly chain: EffectChain; readonly input: ChannelLayout };

/** A spectral edit as the plan realises it over a stream (`plan.ts`). */
export interface PlannedSpectralEdit {
  readonly mask: SpectralMask;
  readonly resolution: number;
  readonly operation: PlannedSpectralOperation;
  /** The channels it acts on, every channel where absent. */
  readonly channels?: readonly number[];
}

/** Whether a factor is one an `attenuate` or an `isolate` may apply. */
export function isSpectralReduction(gain: number): boolean {
  return Number.isFinite(gain) && gain >= 0 && gain < 1;
}

/**
 * Why a spectral edit may not stand over a range of `length` frames, naming
 * one of `chains` where it names a chain, or `undefined` where it may.
 */
export function spectralEditProblem(
  edit: SpectralEdit,
  length: number,
  chains: ReadonlyMap<EffectChainId, EffectChain>,
): string | undefined {
  if (!isSpectralResolution(edit.resolution)) {
    return 'A spectral edit’s resolution must be a power of two from 256 to 16,384 samples.';
  }
  const mask = maskProblem(edit.mask, length);
  if (mask !== undefined) return mask;
  const { operation } = edit;
  switch (operation.kind) {
    case 'attenuate':
    case 'isolate':
      return isSpectralReduction(operation.gain)
        ? undefined
        : 'A spectral reduction must be a factor from nothing to just below one.';
    case 'heal':
      return undefined;
    case 'process':
      return chains.has(operation.chain)
        ? undefined
        : 'The spectral edit names a chain the project does not have.';
  }
}

/** Where a spectral edit of a selection lies: its range, and its mask relative to it. */
export interface SpectralPlacement {
  readonly start: SampleCount;
  readonly end: SampleCount;
  readonly mask: SpectralMask;
}

/**
 * How far before and after its mask's support a spectral edit `kind` at
 * `resolution` reads: half a frame, so no changed frame reaches past it, and
 * for a heal its borders too, as many frames as it measures at the widest hop
 * a quality may take, so every border frame lies wholly within the range.
 */
function placementReach(kind: SpectralOperationKind, resolution: number): number {
  const half = resolution / 2;
  if (kind !== 'heal') return half;
  return half + (HEAL_BORDER_FRAMES * resolution) / FEWEST_SPECTRAL_OVERLAP;
}

/**
 * The range a spectral edit `kind` of `mask`, a selection's on a timeline of
 * `length`, processes at `resolution`, and the mask relative to it: the
 * mask's support widened by its reach each side (`placementReach`), within
 * the timeline (ADR-0081). `undefined` where the mask reaches no audio.
 */
export function spectralPlacement(
  mask: SpectralMask,
  resolution: number,
  kind: SpectralOperationKind,
  length: number,
): SpectralPlacement | undefined {
  const support = maskSupport(mask);
  const reach = placementReach(kind, resolution);
  const start = Math.max(0, Math.floor(support.start - reach));
  const end = Math.min(length, Math.ceil(support.end + reach));
  if (start >= end) return undefined;
  return {
    start: derivedSampleCount(start),
    end: derivedSampleCount(end),
    mask: translatedMask(mask, -start),
  };
}
