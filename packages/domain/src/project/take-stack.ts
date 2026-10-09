/**
 * Take stacks: the recordings of one piece of material, grouped so that no
 * recording ever overwrites another (ADR-0072, REQ-REC-089).
 *
 * A take is a whole recorded asset, named by its identifier; the stack holds
 * the takes in the order they were made and which of them is chosen. Choosing,
 * rejecting and removing a take change only these values, so every take stays
 * recoverable: a removed take is still in its stack, marked, and its asset
 * cannot leave the project while the stack names it (`take-users.ts`).
 *
 * A punch stack also holds its `PunchRange`: where a punch edit over a range
 * of another asset reads the chosen take and how it crosses into it
 * (`punch-fold.ts`). The punch edit names the stack, as a rack edit names a
 * chain, so choosing another take changes what the punch plays without a new
 * edit.
 */

import type { AssetId, TakeId, TakeStackId } from '../identity/branded-id.js';
import { FadeShape } from '../editing/fades.js';
import { derivedSampleCount, type SampleCount, type SampleRate } from '../time/sample-time.js';

/** Where a take stands in its stack. */
export const TakeState = {
  /** In the active stack, and may be chosen. */
  Kept: 'kept',

  /** In the active stack, marked as not wanted, and kept (REQ-REC-089). */
  Rejected: 'rejected',

  /** Out of the active stack, and still recoverable from it. */
  Removed: 'removed',
} as const;

/** Where a take stands in its stack. */
export type TakeState = (typeof TakeState)[keyof typeof TakeState];

/**
 * One recording in a stack.
 *
 * `compensation` is the latency the take is placed by, a signed whole number
 * of frames at the take's own rate (ADR-0070): it says where the take is
 * read from, and its samples are never changed by it.
 */
export interface Take {
  readonly id: TakeId;

  /** The recorded asset, of origin `recorded`, whose source this take is. */
  readonly asset: AssetId;

  readonly name: string;
  readonly note: string;
  readonly state: TakeState;
  readonly compensation: number;
}

/** How a punch crosses from the earlier audio into its take and back. */
export interface PunchCrossfade {
  /** In frames of the audio punched into, at each boundary, inside the range. */
  readonly length: SampleCount;
  readonly shape: FadeShape;
}

/**
 * What a punch stack says of the range its punch edit replaces (ADR-0072).
 *
 * `length` is the range's, in frames of the audio punched into; `preRoll` and
 * `postRoll` are in the take's frames, since the recording ran through both
 * and the take holds them. A take at another rate than the audio it replaces
 * is converted by version `resampler` of the canonical resampler, the version
 * the punch was made with.
 */
export interface PunchRange {
  readonly length: SampleCount;
  readonly preRoll: SampleCount;
  readonly postRoll: SampleCount;
  readonly crossfade: PunchCrossfade;
  readonly resampler: number;
}

/**
 * A stack of takes: its takes in the order they were made, the chosen one,
 * where one is chosen, and its `punch` where it is a punch's.
 */
export interface TakeStack {
  readonly id: TakeStackId;
  readonly name: string;
  readonly takes: readonly Take[];
  readonly chosen?: TakeId;
  readonly punch?: PunchRange;
}

/** The longest a punch's crossfade is by default: ten milliseconds. */
const DEFAULT_CROSSFADE_SECONDS = 0.01;

/**
 * The crossfade a punch over `length` frames at `rate` takes unless the person
 * says otherwise: ten milliseconds, equal power, shortened to half the range
 * where the range is shorter than two of them.
 */
export function defaultPunchCrossfade(rate: SampleRate, length: number): PunchCrossfade {
  const tenMilliseconds = Math.round(rate * DEFAULT_CROSSFADE_SECONDS);
  return {
    length: derivedSampleCount(Math.min(tenMilliseconds, Math.floor(length / 2))),
    shape: FadeShape.EqualPower,
  };
}

/** The take of `stack` with identifier `id`, where it has one. */
export function takeOf(stack: TakeStack, id: TakeId): Take | undefined {
  return stack.takes.find((take) => take.id === id);
}

/** The chosen take of `stack`, or `undefined` where none is. */
export function chosenTake(stack: TakeStack): Take | undefined {
  return stack.chosen === undefined ? undefined : takeOf(stack, stack.chosen);
}
