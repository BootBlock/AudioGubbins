/**
 * The recording diagnostics' shapes: the facts they are given and the entries
 * they give (`REQ-REC-094`, `REQ-REC-097`). Each entry says what is affected,
 * why, the practical impact and what would improve it, with a severity that
 * blocks recording only for a genuine failure.
 */

import type { SampleRate } from '@audiogubbins/domain';

import type { CaptureComparison } from './capture-comparison.js';
import type { OutputIdentity } from './device-identity.js';
import type { PathChange } from './latency-calibration.js';
import type { StorageTimeLeft } from './storage-time.js';

/** How much an entry matters. */
export const DiagnosticSeverity = {
  /** Worth knowing; nothing is lost by going on. */
  Information: 'information',
  /** Recording works, and something about it is worse than it could be. */
  Warning: 'warning',
  /** Nothing can be recorded until the person acts. */
  Blocking: 'blocking',
} as const;

/** How much an entry matters. */
export type DiagnosticSeverity = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

/**
 * What the application offers to do about an entry, where it can act on the
 * person's word, as a value a view gives a control to rather than a sentence it
 * would have to read.
 *
 * - `restart-at-input-rate`: make the audio engine again at `rate`, the
 *   input's own, so the browser stops resampling the input (`ADR-0070`).
 */
export interface DiagnosticAction {
  readonly kind: 'restart-at-input-rate';
  readonly rate: SampleRate;
}

/** One entry of the recording diagnostics. */
export interface RecordingDiagnostic {
  /** A stable name for the condition, for a test or a view to key it by. */
  readonly kind: string;
  readonly severity: DiagnosticSeverity;
  readonly affects: string;
  readonly why: string;
  readonly impact: string;
  readonly improve: string;

  /** What the application offers to do about it, where it offers anything; the person decides. */
  readonly action?: DiagnosticAction;
}

/** Whether the latest calibration applies to the current path. */
export type CalibrationStanding =
  | { readonly kind: 'current' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'stale'; readonly changes: readonly PathChange[] };

/**
 * What is known of the browser and the platform before an audio context or
 * the storage estimate has reported: enough for the entries that rest on
 * neither, which are shown at once.
 */
export interface BrowserFacts {
  readonly secureContext: boolean;
  readonly permission: 'granted' | 'prompt' | 'denied' | 'unknown';

  /** How many inputs the browser lists, or `undefined` before it has listed them. */
  readonly inputs: number | undefined;

  /** Whether the browser lists its inputs and the one chosen for recording is not among them. */
  readonly chosenInputGone: boolean;

  /** Whether this platform may suspend capture in the background or under a screen lock. */
  readonly suspensionRisk: boolean;
}

/** What is known of the browser, the hardware and the session. */
export interface RecordingFacts extends BrowserFacts {
  /** How many inputs the browser lists. */
  readonly inputs: number;

  /** The granted capture beside the request, once an input is open. */
  readonly comparison?: CaptureComparison;

  readonly contextRate: SampleRate;

  /** The input's own rate, where reported. */
  readonly inputRate?: number;

  /** Latencies in seconds: the output's as reported, the input's where reported, the round trip where measured. */
  readonly latency: {
    readonly output: number;
    readonly input?: number;
    readonly measuredRoundTrip?: number;
  };

  /** The input's name, read only to recognise a Bluetooth device. */
  readonly inputLabel?: string;

  /** The output the page plays through, where the browser names it; its name is read as the input's is. */
  readonly output: OutputIdentity;

  readonly calibration: CalibrationStanding;
  readonly storage: StorageTimeLeft;
}
