/**
 * Opening an input, for recording or for a calibration, and closing it again
 * (`ADR-0070`).
 *
 * The page's one context is joined, so the capture shares playback's clock and
 * no second context is made; the profile is planned against what the browser
 * supports and the input reports, at the context's rate; the browser opens the
 * input through the capabilities adapter, which asks the person where the
 * permission is not held; and the stream is handed to a capture session in
 * that context. Whatever was made before a step refused is let go, so a
 * refusal leaves no input open and no context held.
 */

import {
  FailureKind,
  fail,
  failure,
  sampleRate,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import type { LatencyHint } from '@audiogubbins/audio-engine';
import type { ContextLifecycle } from '@audiogubbins/audio-runtime';
import type { InputDeviceDescriptor, MediaInput, OpenedInput } from '@audiogubbins/capabilities';
import {
  capturePlan,
  compareCapture,
  type CaptureProfile,
  type DeviceIdentity,
} from '@audiogubbins/recording';

import type { CapturePort, OpenCapture } from '../audio/capture-parts.js';
import type { AudioContextHost, ContextGuest, ContextHold } from '../audio/context-host.js';
import {
  browserRequest,
  captureLayout,
  captureOffer,
  grantedCaptureOf,
  identityOfOpened,
  listedAs,
} from './capture-facts.js';
import type { OpenedFacts } from './input-view.js';

/** What an input is opened through. */
export interface InputOpening {
  readonly media: MediaInput;
  readonly host: AudioContextHost;
  readonly openCapture: OpenCapture;
  /** The performance profile's latency hint, which a context made for the input has. */
  readonly latencyHint: () => LatencyHint;
}

/** What is asked for: an input, where one is chosen, and the profile it is opened with. */
export interface InputRequest {
  readonly device: DeviceIdentity | undefined;
  readonly profile: CaptureProfile;
  /** The inputs the browser lists, for the channel count the chosen one reports. */
  readonly devices: readonly InputDeviceDescriptor[];
}

/** An input open in the page's context, with a capture session over it. */
export interface OpenedCapture {
  readonly input: OpenedInput;
  readonly capture: CapturePort;
  readonly lifecycle: ContextLifecycle;
  readonly facts: OpenedFacts;
  /** Closes the capture and the input and lets go of the context: the browser's indicator goes out. */
  readonly close: () => void;
}

/**
 * Joins the page's context for `guest` and starts it, from the person's
 * gesture: a browser runs a context only from a click or a key press, and
 * opening the input awaits the person's answer to the browser first. A
 * refusal to start is the capture's to report when it opens.
 */
export function joinContext(opening: InputOpening, guest: ContextGuest): ContextHold {
  const hold = opening.host.join(guest, opening.latencyHint());
  void hold.lifecycle.ensureRunning();
  return hold;
}

/** Why a capture could not be made: the engine's code could not be loaded. */
function engineUnavailable(error: Error): DomainResult<never> {
  return fail(
    failure(
      'recording.engine-unavailable',
      FailureKind.Retryable,
      `The audio engine could not be started: ${error.message}`,
    ),
  );
}

/** A capture session in `lifecycle`'s context, or why the engine could not be loaded. */
async function captureIn(
  opening: InputOpening,
  lifecycle: ContextLifecycle,
): Promise<DomainResult<CapturePort>> {
  try {
    return succeed(await opening.openCapture(lifecycle));
  } catch (error) {
    // The engine's code could not be fetched, a chunk the server no longer
    // has, which is all making a capture session waits on besides compiling
    // the DSP module, which answers rather than throws.
    if (!(error instanceof Error)) throw error;
    return engineUnavailable(error);
  }
}

/**
 * Opens the input `request` asks for in the context `hold` holds, or says why
 * it could not be opened, having let go of the hold.
 */
export async function openInput(
  opening: InputOpening,
  request: InputRequest,
  hold: ContextHold,
): Promise<DomainResult<OpenedCapture>> {
  const context = hold.lifecycle.context();
  const rate = context.ok ? sampleRate(context.value.sampleRate) : context;
  if (!rate.ok) {
    hold.release();
    return rate;
  }
  const plan = capturePlan(
    request.profile,
    captureOffer(
      opening.media.supportedConstraints,
      listedAs(request.devices, request.device),
      rate.value,
    ),
  );
  const opened = await opening.media.open(browserRequest(plan, request.device));
  if (!opened.ok) {
    hold.release();
    return opened;
  }
  const input = opened.value;
  const granted = grantedCaptureOf(input.settings);
  // A browser that does not say how many channels it gives is taken at the
  // count asked for, and the comparison says it could not be confirmed.
  const channels = granted.channelCount ?? plan.request.channelCount ?? 1;
  const letGo = (): void => {
    input.stop();
    hold.release();
  };
  const layout = captureLayout(channels);
  if (!layout.ok) {
    letGo();
    return layout;
  }
  const capture = await captureIn(opening, hold.lifecycle);
  if (!capture.ok) {
    letGo();
    return capture;
  }
  const close = (): void => {
    capture.value.dispose();
    letGo();
  };
  const started = await capture.value.open({
    stream: input.stream,
    layout: layout.value,
    inputLatency: granted.latency,
  });
  if (!started.ok) {
    close();
    return started;
  }
  return succeed({
    input,
    capture: capture.value,
    lifecycle: hold.lifecycle,
    facts: {
      device: identityOfOpened(input, request.device),
      plan,
      granted,
      comparison: compareCapture(plan, granted),
      rate: rate.value,
      channels,
      muted: input.isMuted(),
    },
    close,
  });
}
