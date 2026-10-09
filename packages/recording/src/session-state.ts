/**
 * The recording session's states, and what each says about the input
 * (`REQ-ARCH-153`, `REQ-REC-090`, ADR-0070).
 *
 * - `closed`: nothing is asked of the browser.
 * - `asking`: the browser is asking the person for the microphone.
 * - `ready`: the permission is held and an input may be chosen, but the input
 *   is closed: nothing is captured and nothing is buffered. No input is opened
 *   unless the person arms or records, so readiness never opens one.
 * - `armed`: the person armed an input for a purpose; it is opening, or open,
 *   and, with the retrospective buffer on, buffering.
 * - `counting-in`: an open input counts in to a known clock frame.
 * - `recording`: the input is recorded from a known clock frame.
 * - `stopping`: the recording is ending, for a stated reason, and what was
 *   captured is being finished.
 * - `failed`: recording cannot go on, for the reason held, until the person
 *   asks again.
 *
 * Monitoring is not a state of the session: it is a second machine
 * (`monitoring.ts`), so arming never turns it on.
 */

import type {
  AssetId,
  DomainFailure,
  SampleCount,
  SampleRate,
  TakeStackId,
} from '@audiogubbins/domain';

import type { GrantedCapture } from './capture-comparison.js';
import type { CaptureProfile } from './capture-profile.js';
import type { DeviceIdentity } from './device-identity.js';
import type { RetrospectiveSetting } from './retrospective-buffer.js';

/**
 * What an armed input records for: a new take stack, a new take in a stack,
 * or a punch over a range of an asset, with the frames recorded before and
 * after it for the performer's context (ADR-0072).
 */
export type ArmedPurpose =
  | { readonly kind: 'new-stack' }
  | { readonly kind: 'take'; readonly stack: TakeStackId }
  | {
      readonly kind: 'punch';
      readonly asset: AssetId;
      readonly start: SampleCount;
      readonly length: SampleCount;
      readonly preRoll: SampleCount;
      readonly postRoll: SampleCount;
    };

/** The input, the profile it is opened with, and the retrospective buffer's setting. */
export interface SessionSetup {
  /** The chosen input: none until one is chosen, or after the chosen one is lost. */
  readonly device?: DeviceIdentity;
  readonly profile: CaptureProfile;
  readonly retrospective: RetrospectiveSetting;
}

/** An input the browser opened, at the context's rate, with the settings it granted. */
export interface OpenInput {
  readonly kind: 'open';
  readonly granted: GrantedCapture;

  /** The context's rate, which the capture runs at (ADR-0070). */
  readonly rate: SampleRate;

  /** The channels the capture has: the input's granted count. */
  readonly channels: number;
}

/** An armed input: asked of the browser and not yet given, or open. */
export type ArmedInput = { readonly kind: 'opening' } | OpenInput;

/** Why a recording stopped: the person, its timed end, or something that ended capture. */
export type StopReason =
  | { readonly kind: 'person' }
  | { readonly kind: 'timed' }
  | { readonly kind: 'device-lost' }
  | { readonly kind: 'permission-revoked' }
  | { readonly kind: 'background-suspended' }
  | { readonly kind: 'quota' }
  | { readonly kind: 'failure'; readonly failure: DomainFailure };

/** An armed input and what it is armed for. */
export interface Armed extends SessionSetup {
  readonly device: DeviceIdentity;
  readonly purpose: ArmedPurpose;
}

/** Where a recording's first frame is, and how many of its first frames the buffer gave. */
export interface RecordingStart {
  /** The media clock's frame of the take's first frame. */
  readonly firstFrame: SampleCount;

  /** The frames from before Record the take begins with. */
  readonly retrospectiveFrames: SampleCount;
}

/** The recording session (see the module comment). */
export type RecordingSession =
  | { readonly kind: 'closed' }
  | { readonly kind: 'asking' }
  | ({ readonly kind: 'ready' } & SessionSetup)
  | ({ readonly kind: 'armed'; readonly input: ArmedInput } & Armed)
  | ({
      readonly kind: 'counting-in';
      readonly input: OpenInput;
      /** The clock frame recording begins at, when the count-in ends. */
      readonly recordAt: SampleCount;
    } & Armed)
  | ({ readonly kind: 'recording'; readonly input: OpenInput } & Armed & RecordingStart)
  | ({
      readonly kind: 'stopping';
      readonly input: OpenInput;
      readonly reason: StopReason;
      /** What closed the input while the recording was being finished, if anything did. */
      readonly inputClosedBy?: 'device-lost' | 'permission-revoked';
    } & Armed &
      RecordingStart)
  | { readonly kind: 'failed'; readonly failure: DomainFailure };

/** A session that has asked nothing of the browser. */
export const CLOSED_SESSION: RecordingSession = { kind: 'closed' };

/** Whether `session` holds an input open: only while armed, counting in, recording or stopping. */
export function inputIsOpen(session: RecordingSession): boolean {
  switch (session.kind) {
    case 'armed':
      return session.input.kind === 'open';
    case 'counting-in':
    case 'recording':
    case 'stopping':
      return true;
    case 'closed':
    case 'asking':
    case 'ready':
    case 'failed':
      return false;
  }
}

/**
 * What the status bar and its live region say of the input, for as long as an
 * input is armed (`REQ-REC-090`): the device, whether it is buffering and for
 * how long, and whether it is recording, as distinct states. None while no
 * input is armed.
 */
export type InputIndicator =
  | { readonly kind: 'armed'; readonly device: DeviceIdentity; readonly bufferingSeconds?: number }
  | { readonly kind: 'recording'; readonly device: DeviceIdentity };

/** The input's indicator in `session`, or none while no input is armed. */
export function inputIndicator(session: RecordingSession): InputIndicator | undefined {
  switch (session.kind) {
    case 'armed':
    case 'counting-in':
      return session.input.kind === 'open' && session.retrospective.on
        ? { kind: 'armed', device: session.device, bufferingSeconds: session.retrospective.seconds }
        : { kind: 'armed', device: session.device };
    case 'recording':
    case 'stopping':
      return { kind: 'recording', device: session.device };
    case 'closed':
    case 'asking':
    case 'ready':
    case 'failed':
      return undefined;
  }
}

/** Whether a recording that stopped for `reason` ended unexpectedly, as its provenance says (ADR-0071). */
export function stoppedUnexpectedly(reason: StopReason): boolean {
  return reason.kind !== 'person' && reason.kind !== 'timed';
}

/** The setup of `session`, with `device` as its input. */
export function setupOf(session: SessionSetup, device: DeviceIdentity | undefined): SessionSetup {
  return {
    profile: session.profile,
    retrospective: session.retrospective,
    ...(device === undefined ? {} : { device }),
  };
}

/** `session` with its input closed and its setup kept. */
export function readied(session: SessionSetup): RecordingSession {
  return { kind: 'ready', ...setupOf(session, session.device) };
}
