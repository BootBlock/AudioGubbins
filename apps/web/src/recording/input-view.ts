/**
 * What the recording views read of the input (`ADR-0070`, `REQ-REC-090`): the
 * permission, the inputs the browser lists, the output the page plays through
 * where the browser says which it is, the recording session as its state
 * machine says, the input open now and what the browser granted it, how much
 * of the retrospective buffer's setting the memory left allows and how much it
 * holds, and why the input last closed unasked.
 *
 * Monitoring is not here: it is a second machine with a view of its own
 * (`monitoring-control.ts`), so arming can never be read as monitoring. The
 * meters are not here either: they change thirty times a second and are read
 * where they are drawn, once a display frame.
 */

import type { DomainFailure, SampleRate } from '@audiogubbins/domain';
import type { InputDeviceDescriptor, MicrophonePermission } from '@audiogubbins/capabilities';
import type { DeviceReport } from '@audiogubbins/audio-runtime';
import {
  CLOSED_SESSION,
  type CaptureComparison,
  type CapturePlan,
  type DeviceIdentity,
  type GrantedCapture,
  type OutputIdentity,
  type RecordingSession,
  type RetrospectiveFit,
  UNKNOWN_OUTPUT,
} from '@audiogubbins/recording';

/** Whether the browser listed its inputs, and why not where it would not. */
export type InputListing =
  | { readonly kind: 'unlisted' }
  | { readonly kind: 'listed' }
  | { readonly kind: 'refused'; readonly failure: DomainFailure };

/** An input open now, and what the browser granted it. */
export interface OpenedFacts {
  /** The input as the browser opened it; its label is personal data, shown only to the person. */
  readonly device: DeviceIdentity;
  readonly plan: CapturePlan;
  readonly granted: GrantedCapture;
  readonly comparison: CaptureComparison;
  /** The context's rate, which the capture runs at. */
  readonly rate: SampleRate;
  readonly channels: number;
  /** Whether the browser is giving silence in place of the input now. */
  readonly muted: boolean;
}

/** What the recording views read of the input. */
export interface InputView {
  readonly permission: MicrophonePermission;
  readonly devices: readonly InputDeviceDescriptor[];
  readonly listing: InputListing;
  /** The output the page plays through, which calibrations and the feedback risk are judged by. */
  readonly output: OutputIdentity;
  readonly session: RecordingSession;
  /** The input open now for recording, where one is. */
  readonly opened: OpenedFacts | undefined;
  /**
   * How much of the retrospective buffer's setting the capture keeps, as the
   * memory the page had left allowed when it was armed: none while no input is
   * armed and open with the buffer on.
   */
  readonly buffer: RetrospectiveFit | undefined;
  /** Whole seconds the retrospective buffer holds now, while it is on. */
  readonly bufferedSeconds: number;
  /** What the context reports of the output, once there is a context. */
  readonly context: DeviceReport | undefined;
  /** Why the input last closed, or would not open, unasked; cleared by the next arming. */
  readonly problem: string | undefined;
}

/** The view before anything is asked of the browser. */
export const NOTHING_ASKED: InputView = {
  permission: 'unknown',
  devices: [],
  listing: { kind: 'unlisted' },
  output: UNKNOWN_OUTPUT,
  session: CLOSED_SESSION,
  opened: undefined,
  buffer: undefined,
  bufferedSeconds: 0,
  context: undefined,
  problem: undefined,
};

/**
 * The input's state as the status bar says it (`REQ-REC-090`): each a distinct
 * state, for as long as an input is armed or open, and none otherwise.
 */
export type InputStatus =
  | { readonly kind: 'opening'; readonly device: DeviceIdentity | undefined }
  | { readonly kind: 'armed'; readonly device: DeviceIdentity }
  | { readonly kind: 'buffering'; readonly device: DeviceIdentity; readonly seconds: number }
  | { readonly kind: 'counting-in'; readonly device: DeviceIdentity }
  | { readonly kind: 'recording'; readonly device: DeviceIdentity }
  | { readonly kind: 'calibrating'; readonly device: DeviceIdentity | undefined };

/**
 * The input's status in `view`, or none while no input is armed or open: an
 * input open for a calibration (`calibrating`, with its device) is one too.
 */
export function inputStatus(
  view: InputView,
  calibrating: { readonly device: DeviceIdentity | undefined } | undefined,
): InputStatus | undefined {
  if (calibrating !== undefined) return { kind: 'calibrating', device: calibrating.device };
  const { session } = view;
  // The input as the browser opened it names it best: the session may hold
  // the browser's default, chosen before the browser said which it was.
  const opened = view.opened?.device;
  switch (session.kind) {
    case 'armed':
      if (session.input.kind === 'opening') return { kind: 'opening', device: session.device };
      // A buffer the memory left had no room for keeps nothing, so nothing is buffering.
      return session.retrospective.on && view.buffer?.kind !== 'none'
        ? { kind: 'buffering', device: opened ?? session.device, seconds: view.bufferedSeconds }
        : { kind: 'armed', device: opened ?? session.device };
    case 'counting-in':
      return { kind: 'counting-in', device: opened ?? session.device };
    case 'recording':
    case 'stopping':
      return { kind: 'recording', device: opened ?? session.device };
    // The browser's prompt is its own, and nothing is open until it is answered.
    case 'asking':
    case 'closed':
    case 'ready':
    case 'failed':
      return undefined;
  }
}
