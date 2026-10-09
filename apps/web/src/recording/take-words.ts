/**
 * What is said of takes and recordings as they are made, kept and recovered, in
 * one place, so each is worded alike in the status bar, the Recording panel,
 * the recovery offer and what is announced.
 */

import { RecordingEnding } from '@audiogubbins/project-format';
import type { StopReason, StorageTimeLeft } from '@audiogubbins/recording';
import { TakeState } from '@audiogubbins/domain';

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const TENTHS = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A length of recording, as a person reads it: `4.2 s`, `3 min 05 s`, `1 h 02 min`. */
export function recordedText(seconds: number): string {
  if (seconds < 60) return `${TENTHS.format(seconds)} s`;
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const rest = whole % 60;
  return hours > 0
    ? `${WHOLE.format(hours)} h ${String(minutes).padStart(2, '0')} min`
    : `${WHOLE.format(minutes)} min ${String(rest).padStart(2, '0')} s`;
}

/** What the time the storage leaves to record means, or nothing where it is plenty or unknown. */
export function timeLeftWarning(timeLeft: StorageTimeLeft | undefined): string | undefined {
  switch (timeLeft?.kind) {
    case 'low':
      return `Storage is running low: about ${recordedText(timeLeft.seconds)} of recording is left.`;
    case 'exhausted':
      return 'There is no room left to record: the storage this browser gives AudioGubbins is full.';
    case 'enough':
    case 'unknown':
    case undefined:
      return undefined;
  }
}

/** The ending a recording that stopped for `reason` is kept with (`ADR-0071`). */
export function endingOf(reason: StopReason): RecordingEnding {
  switch (reason.kind) {
    case 'person':
      return RecordingEnding.Stopped;
    case 'timed':
      return RecordingEnding.Timed;
    case 'device-lost':
      return RecordingEnding.DeviceLost;
    case 'permission-revoked':
      return RecordingEnding.PermissionRevoked;
    case 'background-suspended':
      return RecordingEnding.Suspended;
    case 'quota':
      return RecordingEnding.StorageFull;
    case 'failure':
      return RecordingEnding.Failed;
  }
}

/** Why a recording ended, finishing "It ended because …", for one that ended unexpectedly. */
const ENDINGS: Readonly<Record<RecordingEnding, string>> = {
  [RecordingEnding.Stopped]: 'it was stopped',
  [RecordingEnding.Timed]: 'its set length was reached',
  [RecordingEnding.DeviceLost]: 'the input was disconnected',
  [RecordingEnding.PermissionRevoked]: 'the microphone permission was taken back',
  [RecordingEnding.StorageFull]: 'the storage was full',
  [RecordingEnding.Suspended]: 'the browser may have paused capture in the background',
  [RecordingEnding.Failed]: 'capture failed',
  [RecordingEnding.Interrupted]: 'the page closed, reloaded or crashed while it was recording',
};

/** Why a recording ended, as a clause: "the input was disconnected". */
export function endingText(ending: RecordingEnding): string {
  return ENDINGS[ending];
}

/** What a take's state is called, standing alone. */
export const TAKE_STATE_NAMES: Readonly<Record<TakeState, string>> = {
  [TakeState.Kept]: 'Kept',
  [TakeState.Rejected]: 'Rejected',
  [TakeState.Removed]: 'Removed',
};

/** A take's placement in frames at `rate`, signed, as a person reads it. */
export function compensationText(frames: number, rate: number): string {
  if (frames === 0) return 'not moved';
  const milliseconds = TENTHS.format((Math.abs(frames) * 1_000) / rate);
  const direction = frames > 0 ? 'earlier' : 'later';
  return `${milliseconds} ms ${direction} (${WHOLE.format(Math.abs(frames))} frames)`;
}
