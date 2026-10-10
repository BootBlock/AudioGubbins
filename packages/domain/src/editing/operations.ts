/**
 * Edit operations: what a person did to an asset or a region, as values.
 *
 * An asset keeps its imported source unchanged and carries an ordered chain of
 * these (ADR-0051). Each operation's positions are sample boundaries in the
 * asset's timeline as the operations before it left it, so a chain is only
 * ever read in order, and undoing one is withdrawing the last. A region's own
 * processing is the subset that changes no time, each anchored to the asset's
 * content instead (`RegionOperation`).
 *
 * Every value here is persisted in the project. A value is checked against
 * the chain it joins by `operation-validation.ts`, whether a command makes it
 * or a document holds it, so nothing here assumes it was made by the
 * interface.
 */

import type { ChannelLayout } from '../audio/channel-layout.js';
import type {
  AssetId,
  EditOperationId,
  EffectChainId,
  RegionId,
  TakeStackId,
} from '../identity/branded-id.js';
import type { PlannedSpectralOperation, SpectralEdit } from '../spectral/spectral-edit.js';
import type { SampleCount, SampleRate } from '../time/sample-time.js';
import type { FadeDirection, FadeShape } from './fades.js';
import type { EditPlan, StreamProcessing } from './plan.js';

/**
 * A span between two sample boundaries, `start` before `end`.
 *
 * Boundaries rather than frames, as the timeline states every position
 * (ADR-0041): the frames covered are `start` to `end − 1`.
 */
export interface EditRange {
  readonly start: SampleCount;
  readonly end: SampleCount;
}

/**
 * The largest gain an edit may apply, as a linear factor: sixty decibels.
 *
 * A bound, so a hostile document cannot drive a stage's arithmetic to
 * infinity, and well past anything a person sets by ear.
 */
export const MAXIMUM_EDIT_GAIN = 1_000;

/**
 * A change of level over a range, on the channels the operation names.
 *
 * A gain is a linear factor, never decibels: converting decibels uses a power
 * function whose last bit differs between machines, so the person's decibels
 * are converted once, where they are typed, and the factor is what is kept.
 */
export type LevelEdit =
  | { readonly kind: 'gain'; readonly gain: number }
  | { readonly kind: 'fade'; readonly direction: FadeDirection; readonly shape: FadeShape }
  | { readonly kind: 'silence' }
  | { readonly kind: 'invert' };

/**
 * A change between channels over a range, which keeps the layout's roles: the
 * content moves, the channels stay what they were (REQ-EDIT-015).
 *
 * `channel-gains` gives each channel its own factor, which is how a balance is
 * made on a layout of any width.
 */
export type ChannelEdit =
  | { readonly kind: 'swap-channels'; readonly first: number; readonly second: number }
  | { readonly kind: 'copy-channel'; readonly from: number; readonly to: number }
  | { readonly kind: 'channel-gains'; readonly gains: readonly number[] };

/**
 * A chain of processors applied over a range (ADR-0060), named by its
 * identifier so every range and target that names one chain shares it. It
 * acts on every channel, keeps the range's length and layout, and adds
 * nothing past the range's end: a reverb's or a delay's tail is cut there.
 */
export interface RackEdit {
  readonly kind: 'rack';
  readonly chain: EffectChainId;
}

/**
 * The range replaced by the chosen take of the take stack `stack` names
 * (ADR-0072), crossing into it and back as the stack's `PunchRange` says. It
 * keeps the range's length and the layout, so it moves nothing in time; it
 * acts on every channel, and only on an asset's own chain, since what it
 * replaces is the asset's audio. A stack with no chosen take leaves the range
 * as it was.
 */
export interface PunchEdit {
  readonly kind: 'punch';
  readonly stack: TakeStackId;
}

/**
 * A change over a range that moves nothing in time: a level change on the
 * channels an operation names, a change between channels, a chain of
 * processors, a punch, or a change to an area of time and frequency
 * (`SpectralEdit`, ADR-0081) on the channels an operation names.
 */
export type RangeEdit = LevelEdit | ChannelEdit | RackEdit | PunchEdit | SpectralEdit;

/** One operation in an asset's chain. */
export type EditOperation =
  /** Removes the range, closing the gap. */
  | { readonly id: EditOperationId; readonly kind: 'delete'; readonly range: EditRange }
  /** Keeps only the range. */
  | { readonly id: EditOperationId; readonly kind: 'trim'; readonly range: EditRange }
  /**
   * Inserts a copied slice of a plan at a boundary. It names immutable
   * sources only, so it sounds the same whatever later happens to the asset
   * it came from (ADR-0053). A payload at another rate is converted only
   * where the person asked for it (REQ-ARCH-085), by version `resampler` of
   * the canonical resampler, which is present exactly then; a payload at the
   * asset's rate is inserted as it is.
   */
  | {
      readonly id: EditOperationId;
      readonly kind: 'insert';
      readonly at: SampleCount;
      readonly payload: EditPlan;
      readonly resampler?: number;
    }
  /** Plays the range backwards. */
  | { readonly id: EditOperationId; readonly kind: 'reverse'; readonly range: EditRange }
  /**
   * Changes the range in place. A level edit and a spectral edit act on
   * `channels`, or on every channel where they are absent; a channel edit
   * names its own channels and takes no scope.
   */
  | {
      readonly id: EditOperationId;
      readonly kind: 'process';
      readonly range: EditRange;
      readonly channels?: readonly number[];
      readonly edit: RangeEdit;
    }
  /**
   * Converts the whole asset's layout by an explicit matrix from the old
   * channels to the new: one row for each new channel, one column for each
   * old one.
   */
  | {
      readonly id: EditOperationId;
      readonly kind: 'convert-layout';
      readonly layout: ChannelLayout;
      readonly matrix: readonly (readonly number[])[];
    }
  /**
   * Stretches the range to `length` frames without changing its pitch, on
   * every channel, by version `version` of the engine's stretch. A position
   * inside the range moves by the ratio of the two lengths, and one after it
   * by their difference (`anchors.ts`).
   */
  | {
      readonly id: EditOperationId;
      readonly kind: 'stretch';
      readonly range: EditRange;
      readonly length: SampleCount;
      readonly version: number;
    }
  /**
   * Converts the whole asset to `sampleRate` by version `version` of the
   * canonical resampler, the only way an asset's rate changes (REQ-ARCH-085).
   * Every position moves by the ratio of the two rates.
   */
  | {
      readonly id: EditOperationId;
      readonly kind: 'convert-rate';
      readonly sampleRate: SampleRate;
      readonly version: number;
    };

/**
 * The versions of the engine's algorithms this build makes edits with, which
 * the engine owns (REQ-AUDIO-145, ADR-0061): its stretch's, and its canonical
 * resampler's. A stretch, a conversion of rate and an insertion converted to
 * the asset's rate are made by, and persist, the version of theirs; one made
 * by a version this build does not have is refused where its plan is built,
 * rather than heard as another algorithm makes it.
 */
export interface EngineVersions {
  readonly stretch: number;
  readonly resampler: number;
}

/**
 * An operation on an asset's channels: a change between them over a range, or
 * a conversion of its whole layout.
 */
export type ChannelEditOperation =
  | Extract<EditOperation, { readonly kind: 'convert-layout' }>
  | (Extract<EditOperation, { readonly kind: 'process' }> & { readonly edit: ChannelEdit });

/** Whether an edit changes level. */
export function isLevelEdit(edit: RangeEdit): edit is LevelEdit {
  return (
    edit.kind === 'gain' ||
    edit.kind === 'fade' ||
    edit.kind === 'silence' ||
    edit.kind === 'invert'
  );
}

/**
 * The chain an edit names: a rack edit's, or a spectral edit's that takes a
 * chain's output (ADR-0060, ADR-0081). The one account of which edits name a
 * chain, so a chain enters and leaves the project with whichever edit names
 * it.
 */
export function editChain(edit: RangeEdit): EffectChainId | undefined {
  if (edit.kind === 'rack') return edit.chain;
  if (edit.kind === 'spectral' && edit.operation.kind === 'process') return edit.operation.chain;
  return undefined;
}

/**
 * The chain a stream's processing runs, and where it runs it: a `chain`
 * stream's over the stream's segments as a whole, or a spectral `process`
 * edit's inside the frames it changes (ADR-0081). The one account of which
 * streams run a chain, as {@link editChain} is of which edits name one, so
 * whatever needs a chain's models or follows its parameters finds every chain
 * a plan runs, and tells by `kind` where it runs.
 */
export type StreamChain =
  | Extract<StreamProcessing, { readonly kind: 'chain' }>
  | Extract<PlannedSpectralOperation, { readonly kind: 'process' }>;

/** The chain `processing` runs, where it runs one (see {@link StreamChain}). */
export function streamChain(processing: StreamProcessing | undefined): StreamChain | undefined {
  if (processing?.kind === 'chain') return processing;
  if (processing?.kind === 'spectral' && processing.edit.operation.kind === 'process') {
    return processing.edit.operation;
  }
  return undefined;
}

/** `edit` naming `chain` in place of the chain it names; an edit that names none, unchanged. */
export function withEditChain(edit: RangeEdit, chain: EffectChainId): RangeEdit {
  if (edit.kind === 'rack') return { ...edit, chain };
  if (edit.kind === 'spectral' && edit.operation.kind === 'process') {
    return { ...edit, operation: { ...edit.operation, chain } };
  }
  return edit;
}

/** Whether an edit acts on the channels its operation names: a level edit or a spectral one. */
export function takesChannelScope(edit: RangeEdit): edit is LevelEdit | SpectralEdit {
  return isLevelEdit(edit) || edit.kind === 'spectral';
}

/**
 * One operation of a region's own processing (ADR-0051).
 *
 * Its range is stated at `basis`, the number of the asset's operations that
 * existed when it was placed. The processing is folded into the region's plan
 * there, among the asset's operations, so it stays on the content it was put
 * on whatever is later cut, pasted or reversed around it; the range carried
 * through the operations after says where that content lies now.
 */
export interface RegionOperation {
  readonly id: EditOperationId;
  readonly basis: number;
  readonly range: EditRange;
  readonly channels?: readonly number[];
  readonly edit: RangeEdit;
}

/**
 * What an edit command acts on: a range of an asset's own timeline, or of one
 * of its regions, with the channels the selection set resolves (ADR-0042,
 * ADR-0051). The range is on the asset's edited timeline as its chain stands,
 * where every operation is placed; `channels` is absent where every channel is
 * the target.
 *
 * In a region an edit that changes time or the layout is made on the asset,
 * and processing on the region, whose operations are anchored at `basis`, the
 * length of the asset's chain the range is stated at.
 */
export type EditTarget =
  | {
      readonly kind: 'asset';
      readonly asset: AssetId;
      readonly range: EditRange;
      readonly channels?: readonly number[];
    }
  | {
      readonly kind: 'region';
      readonly asset: AssetId;
      readonly region: RegionId;
      readonly basis: number;
      readonly range: EditRange;
      readonly channels?: readonly number[];
    };
