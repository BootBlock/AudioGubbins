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
import type { AssetId, EditOperationId, RegionId } from '../identity/branded-id.js';
import type { SampleCount } from '../time/sample-time.js';
import type { FadeDirection, FadeShape } from './fades.js';
import type { ClipboardPayload } from './plan.js';

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
 * A change over a range that moves nothing in time: a level change on the
 * channels an operation names, or a change between channels.
 */
export type RangeEdit = LevelEdit | ChannelEdit;

/** One operation in an asset's chain. */
export type EditOperation =
  /** Removes the range, closing the gap. */
  | { readonly id: EditOperationId; readonly kind: 'delete'; readonly range: EditRange }
  /** Keeps only the range. */
  | { readonly id: EditOperationId; readonly kind: 'trim'; readonly range: EditRange }
  /**
   * Inserts a payload at a boundary. A payload at another rate is converted
   * by the canonical resampler, and only when `convertRate` says so
   * (REQ-ARCH-085).
   */
  | {
      readonly id: EditOperationId;
      readonly kind: 'insert';
      readonly at: SampleCount;
      readonly payload: ClipboardPayload;
      readonly convertRate: boolean;
    }
  /** Plays the range backwards. */
  | { readonly id: EditOperationId; readonly kind: 'reverse'; readonly range: EditRange }
  /**
   * Changes the range in place. A level edit acts on `channels`, or on every
   * channel where they are absent; a channel edit names its own channels and
   * takes no scope.
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
    };

/**
 * An operation on an asset's channels: a change between them over a range, or
 * a conversion of its whole layout.
 */
export type ChannelEditOperation =
  | Extract<EditOperation, { readonly kind: 'convert-layout' }>
  | (Extract<EditOperation, { readonly kind: 'process' }> & { readonly edit: ChannelEdit });

/** Whether an edit changes level, so it takes a channel scope. */
export function isLevelEdit(edit: RangeEdit): edit is LevelEdit {
  return (
    edit.kind === 'gain' ||
    edit.kind === 'fade' ||
    edit.kind === 'silence' ||
    edit.kind === 'invert'
  );
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
