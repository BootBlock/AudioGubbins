/**
 * How a recorded asset was recorded (ADR-0071, REQ-STOR-166): when, on what
 * input as the browser described it, with which capture profile, what was
 * asked of the browser and what it granted, the audio's shape, and how the
 * recording ended.
 *
 * Kept on the asset's provenance beside how it entered the project, so a
 * recording is traced back to its capture as an import is to its file. The
 * device's label and group are the person's own, as a file's name is, and are
 * stripped below the full level (`provenance-stripping.ts`). A recovery
 * manifest holds what is known as a recording starts (`RecordingStart`); the
 * asset made of it holds that and how it ended.
 */

import type { ChannelLayout, SampleCount, SampleRate } from '@audiogubbins/domain';

/** The kinds of capture profile a recording is made with (REQ-REC-092). */
export const CaptureProfileKind = {
  /** Every browser processing the platform lets be turned off, off: the default. */
  RawStudio: 'raw-studio',
  Voice: 'voice',
  Custom: 'custom',
} as const;

/** The kind of capture profile a recording is made with. */
export type CaptureProfileKind = (typeof CaptureProfileKind)[keyof typeof CaptureProfileKind];

/** The capture profile a recording was made with, as the person named it. */
export interface RecordedProfile {
  readonly kind: CaptureProfileKind;
  readonly name: string;
}

/**
 * Capture settings, as asked of the browser or as it granted them: each one
 * the browser was asked about or reported, and absent where it was not. A
 * latency is in seconds.
 */
export interface CaptureSettings {
  readonly echoCancellation?: boolean;
  readonly noiseSuppression?: boolean;
  readonly autoGainControl?: boolean;
  readonly voiceIsolation?: boolean;
  readonly channelCount?: number;
  readonly sampleRate?: number;
  readonly sampleSize?: number;
  readonly latency?: number;
}

/**
 * The input a recording was made on, as the browser described it: each part
 * only where the browser gave it, since none is assumed (REQ-EXEC-216).
 */
export interface RecordedDevice {
  /** The device's label, the person's own: stripped below full provenance. */
  readonly label?: string;

  /** The browser's group of the device, which also names it: stripped likewise. */
  readonly group?: string;

  readonly channelCount?: number;
}

/** Why a recording ended. */
export const RecordingEnding = {
  /** The person stopped it. */
  Stopped: 'stopped',

  /** A timed stop the person set ended it. */
  Timed: 'timed',

  /** The input device went away or its track ended. */
  DeviceLost: 'device-lost',

  /** The permission to use the input was taken away. */
  PermissionRevoked: 'permission-revoked',

  /** A write was refused for lack of storage. */
  StorageFull: 'storage-full',

  /** The browser suspended capture in the background or behind a locked screen. */
  Suspended: 'suspended',

  /** Capture failed for a reason none of the others names. */
  Failed: 'failed',

  /** The page closed, reloaded or crashed, and the recording was recovered. */
  Interrupted: 'interrupted',
} as const;

/** Why a recording ended. */
export type RecordingEnding = (typeof RecordingEnding)[keyof typeof RecordingEnding];

/** Whether a recording that ended so ended unexpectedly, and so may need review. */
export function endedUnexpectedly(ending: RecordingEnding): boolean {
  return ending !== RecordingEnding.Stopped && ending !== RecordingEnding.Timed;
}

/** What is known of a recording as it starts. */
export interface RecordingStart {
  /** When it started, in milliseconds since the epoch. */
  readonly recordedAt: number;
  readonly device: RecordedDevice;
  readonly profile: RecordedProfile;
  readonly requested: CaptureSettings;
  readonly granted: CaptureSettings;

  /** The rate it is recorded at, which its asset keeps (REQ-ARCH-085). */
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
}

/** How a recorded asset was recorded: its start, its length, and how it ended. */
export interface RecordedProvenance extends RecordingStart {
  /** The whole frames recorded, which its asset holds. */
  readonly length: SampleCount;
  readonly ending: RecordingEnding;
}
