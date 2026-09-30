/**
 * The ways a position is written: in samples, in milliseconds, as a clock, and
 * as timecode.
 *
 * A position's truth is a boundary; each format is computed from it with
 * integer division at an explicit rate, so the same boundary is always written
 * the same way and a written time never feeds back into a position. A clock
 * rounds down, so it never shows a time the audio has not reached. Musical time
 * is a later mapping over these (REQ-PROD-160), which is why the format is a
 * tagged union a new kind can join.
 */

import type { SampleRate } from '@audiogubbins/domain';

import { frameAt, type FrameRate } from './frame-rate.js';
import { timecodeOf, timecodeText } from './timecode.js';

/** How a position is written. */
export type TimeFormat =
  | { readonly kind: 'samples' }
  | { readonly kind: 'milliseconds' }
  | { readonly kind: 'clock' }
  | { readonly kind: 'timecode'; readonly frames: FrameRate };

/** The kinds of format, for a control that offers them. */
export const TimeFormatKind = {
  Samples: 'samples',
  Milliseconds: 'milliseconds',
  Clock: 'clock',
  Timecode: 'timecode',
} as const;

export type TimeFormatKind = (typeof TimeFormatKind)[keyof typeof TimeFormatKind];

/**
 * How finely a clock or a millisecond count is written: to the millisecond, or
 * to the microsecond where a ruler's ticks are closer than a millisecond.
 */
export const TimePrecision = {
  Milliseconds: 'milliseconds',
  Microseconds: 'microseconds',
} as const;

export type TimePrecision = (typeof TimePrecision)[keyof typeof TimePrecision];

const GROUPED = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** Whole microseconds from boundary zero to `position`, rounded down. */
function microsecondsAt(position: number, rate: SampleRate): bigint {
  const scaled = BigInt(Math.abs(position)) * 1_000_000n;
  return scaled / BigInt(rate);
}

function fraction(microseconds: bigint, precision: TimePrecision): string {
  const within = Number(microseconds % 1_000_000n);
  return precision === TimePrecision.Microseconds
    ? String(within).padStart(6, '0')
    : String(Math.floor(within / 1000)).padStart(3, '0');
}

function clockText(microseconds: bigint, precision: TimePrecision): string {
  const totalSeconds = Number(microseconds / 1_000_000n);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const rest = fraction(microseconds, precision);
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${seconds}.${rest}`
    : `${String(minutes)}:${seconds}.${rest}`;
}

function millisecondsText(microseconds: bigint, precision: TimePrecision): string {
  const whole = GROUPED.format(Number(microseconds / 1000n));
  if (precision === TimePrecision.Milliseconds) return `${whole} ms`;
  return `${whole}.${String(Number(microseconds % 1000n)).padStart(3, '0')} ms`;
}

/**
 * A time of `microseconds` from boundary zero, written as a clock or in
 * milliseconds: what a ruler labels a tick at a round time with.
 */
export function formatMicroseconds(
  microseconds: bigint,
  kind: typeof TimeFormatKind.Clock | typeof TimeFormatKind.Milliseconds,
  precision: TimePrecision,
): string {
  return kind === TimeFormatKind.Clock
    ? clockText(microseconds, precision)
    : millisecondsText(microseconds, precision);
}

/**
 * `position` written in `format` at `rate`. A position before boundary zero,
 * which only a picture offset gives, is written with the typographic minus.
 */
export function formatPosition(
  position: number,
  rate: SampleRate,
  format: TimeFormat,
  precision: TimePrecision = TimePrecision.Milliseconds,
): string {
  const sign = position < 0 ? '−' : '';
  switch (format.kind) {
    case TimeFormatKind.Samples:
      return `${sign}${GROUPED.format(Math.abs(position))}`;
    case TimeFormatKind.Milliseconds:
      return `${sign}${millisecondsText(microsecondsAt(position, rate), precision)}`;
    case TimeFormatKind.Clock:
      return `${sign}${clockText(microsecondsAt(position, rate), precision)}`;
    case TimeFormatKind.Timecode:
      return timecodeText(timecodeOf(frameAt(position, rate, format.frames), format.frames));
  }
}
