/**
 * The lengths a workflow's options state in milliseconds, as frames of a
 * member's audio, and the times and levels its sentences say.
 */

import type { SampleRate } from '@audiogubbins/domain';

/** `milliseconds` as whole frames at `rate`, the nearest. */
export function framesOf(milliseconds: number, rate: SampleRate): number {
  return Math.round((milliseconds * rate) / 1000);
}

/** `frames` at `rate` as a person reads a time: seconds to the millisecond. */
export function timeText(frames: number, rate: SampleRate): string {
  return `${(frames / rate).toFixed(3)} s`;
}

/** A level as a person reads it, its minus sign typeset. */
export function levelText(value: number, unit: string): string {
  const magnitude = String(Math.abs(value));
  return `${value < 0 ? '−' : ''}${magnitude} ${unit}`;
}
