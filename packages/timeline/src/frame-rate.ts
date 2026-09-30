/**
 * Picture frame rates, and the exact arithmetic between frames and sample
 * boundaries.
 *
 * A frame rate is a ratio of integers, so 29.97 is 30000/1001 and never a float
 * that drifts a frame an hour. Frame `n` starts at the first boundary whose
 * time is at or after `n` frame periods, and boundary `b` falls in the frame
 * that started last at or before it; the two are computed with exact integer
 * division, in `bigint` where a product could pass 2^53, so a frame's boundary
 * is the same at the fourth hour as at the first (ADR-0046).
 *
 * Drop-frame applies only to the NTSC rates 30000/1001 and 60000/1001: it skips
 * frame labels, never frames, so the timecode shown keeps pace with the clock
 * on the wall.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

/** Frames per second as `numerator / denominator`, and whether its timecode drops frame labels. */
export interface FrameRate {
  readonly numerator: number;
  readonly denominator: number;
  readonly dropFrame: boolean;
}

function rate(numerator: number, denominator: number, dropFrame = false): FrameRate {
  return { numerator, denominator, dropFrame };
}

/** The frame rates a person picks from, by the name they know. */
export const StandardFrameRates = {
  film: rate(24, 1),
  filmPulledDown: rate(24_000, 1001),
  pal: rate(25, 1),
  ntscDropFrame: rate(30_000, 1001, true),
  ntscNonDrop: rate(30_000, 1001),
  thirty: rate(30, 1),
  palDouble: rate(50, 1),
  ntscDoubleDropFrame: rate(60_000, 1001, true),
  ntscDoubleNonDrop: rate(60_000, 1001),
  sixty: rate(60, 1),
} as const satisfies Record<string, FrameRate>;

/** The largest numerator a frame rate may have: 240 frames a second at a denominator of 1001. */
const MAXIMUM_NUMERATOR = 240_240;

/** Builds a validated frame rate. */
export function frameRate(
  numerator: number,
  denominator: number,
  dropFrame: boolean,
): DomainResult<FrameRate> {
  const whole =
    Number.isInteger(numerator) &&
    Number.isInteger(denominator) &&
    numerator > 0 &&
    denominator > 0 &&
    numerator <= MAXIMUM_NUMERATOR &&
    denominator <= 1001;
  if (!whole || numerator / denominator < 1 || numerator / denominator > 240) {
    return fail(
      failure(
        'timeline.frame-rate-out-of-range',
        FailureKind.Rejected,
        'A frame rate is a ratio of whole numbers between 1 and 240 frames a second.',
        { details: { numerator: String(numerator), denominator: String(denominator) } },
      ),
    );
  }
  if (dropFrame && !(denominator === 1001 && (numerator === 30_000 || numerator === 60_000))) {
    return fail(
      failure(
        'timeline.drop-frame-not-ntsc',
        FailureKind.Rejected,
        'Drop-frame timecode applies only to 29.97 and 59.94 frames a second.',
        { details: { numerator, denominator } },
      ),
    );
  }
  return succeed(rate(numerator, denominator, dropFrame));
}

/** Whole frames each timecode second counts: 30 for 29.97, 24 for 23.976. */
export function nominalFramesPerSecond(frames: FrameRate): number {
  return Math.round(frames.numerator / frames.denominator);
}

/** The frames per second as a number, for display. */
export function framesPerSecond(frames: FrameRate): number {
  return frames.numerator / frames.denominator;
}

/** Whether two frame rates are the same. */
export function frameRatesEqual(left: FrameRate, right: FrameRate): boolean {
  return (
    left.numerator * right.denominator === right.numerator * left.denominator &&
    left.dropFrame === right.dropFrame
  );
}

/** `a` divided by `b`, rounded towards negative infinity. */
function floorDivide(a: bigint, b: bigint): bigint {
  const quotient = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? quotient - 1n : quotient;
}

/**
 * The frame boundary `position` falls in, counted from the frame that starts at
 * boundary zero; negative before it.
 */
export function frameAt(position: number, sampleRate: SampleRate, frames: FrameRate): number {
  return Number(
    floorDivide(
      BigInt(position) * BigInt(frames.numerator),
      BigInt(sampleRate) * BigInt(frames.denominator),
    ),
  );
}

/** The first boundary of frame `frame`: the first whose time is at or after the frame's. */
export function frameStart(frame: number, sampleRate: SampleRate, frames: FrameRate): number {
  const numerator = BigInt(frame) * BigInt(sampleRate) * BigInt(frames.denominator);
  return Number(-floorDivide(-numerator, BigInt(frames.numerator)));
}
