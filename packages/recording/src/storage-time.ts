/**
 * How long a recording can run before storage runs out (`REQ-REC-096`,
 * ADR-0071).
 *
 * A recording is kept as one-second chunks while it runs and written out as one
 * WAV file when it stops; the chunks are removed only once the project holds
 * the file. So finishing a recording needs about its own size again, and each
 * second recorded costs twice its data while the recording is unfinished. The
 * time left is an estimate, as the storage estimate it is read from is: a
 * browser rounds what it reports, and other sites share the quota.
 */

import type { SampleRate } from '@audiogubbins/domain';

/** The bytes one sample takes in a chunk and in the finished file, which hold 32-bit floats. */
const BYTES_PER_SAMPLE = 4;

/**
 * Below this much recording time left, the person is warned. Five minutes is
 * longer than most takes, so a warning given before Record leaves room to
 * finish one, and given during one leaves time to stop at a phrase's end rather
 * than have the recording stopped by a refused write.
 */
export const STORAGE_WARNING_SECONDS = 300;

/** The storage estimate, in bytes, as the browser reports it. */
export interface StorageEstimate {
  readonly quota: number;
  readonly usage: number;
}

/** What is known of the storage a recording will use. */
export type StorageTimeLeft =
  /** The browser gives no estimate, so nothing is known: never taken for plenty. */
  | { readonly kind: 'unknown' }
  /** At least the warning margin is left. */
  | { readonly kind: 'enough'; readonly seconds: number }
  /** Less than the warning margin is left, though some remains. */
  | { readonly kind: 'low'; readonly seconds: number }
  /** Nothing is left: a recording could not be finished. */
  | { readonly kind: 'exhausted' };

/** The bytes a second of recording takes at `rate` over `channels` channels. */
export function recordingBytesPerSecond(rate: SampleRate, channels: number): number {
  return rate * channels * BYTES_PER_SAMPLE;
}

/**
 * The seconds of recording `estimate` leaves at `rate` over `channels`
 * channels, when `recorded` bytes of an unfinished recording are kept already:
 * finishing those needs their size again, and every further second needs its
 * data twice. Whole seconds, rounded down, since a part of a second cannot be
 * finished.
 */
export function storageTimeLeft(
  estimate: StorageEstimate | undefined,
  rate: SampleRate,
  channels: number,
  recorded = 0,
): StorageTimeLeft {
  if (estimate === undefined) return { kind: 'unknown' };
  const free = estimate.quota - estimate.usage - recorded;
  const seconds = Math.floor(free / (2 * recordingBytesPerSecond(rate, channels)));
  if (seconds <= 0) return { kind: 'exhausted' };
  return seconds < STORAGE_WARNING_SECONDS ? { kind: 'low', seconds } : { kind: 'enough', seconds };
}
