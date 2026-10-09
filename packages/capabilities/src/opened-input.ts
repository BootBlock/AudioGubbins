/**
 * Opening an audio input, and the input once it is open (ADR-0070).
 *
 * The stream is opened here and nowhere else, then handed by the application
 * to the audio runtime, whose capture worklet alone reads it; nothing between
 * them looks inside. What the browser granted is read from the track, and the
 * track's own events say when the input is lost or silenced, so the recording
 * session can stop and keep what it has (REQ-REC-097). The track's label is
 * personal data and is never logged (REQ-PRIV-165).
 */

import {
  fail,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  audioConstraintsOf,
  grantedSettingsOf,
  type CaptureRequest,
  type GrantedCaptureSettings,
} from './capture-constraints.js';
import { noAudioTrack, refusalOf } from './media-input-failures.js';

/** An open audio input. */
export interface OpenedInput {
  /**
   * The browser's stream, for the application to hand to the audio runtime,
   * which makes its source from it. No other package reads it.
   */
  readonly stream: MediaStream;

  /** What the device calls itself, where the browser says; personal data, never logged. */
  readonly label: string | undefined;

  /** What the browser granted when the input opened, read from its track. */
  readonly settings: GrantedCaptureSettings;

  /** Whether the browser is giving silence in place of the input now, as a lock screen or the system may make it. */
  readonly isMuted: () => boolean;

  /**
   * Calls `ended` once the input has ended for good, as a device unplugged or
   * a permission revoked ends it, at once where it already has; answers how to
   * stop. Stopping the input with `stop` is not an ending this reports.
   */
  readonly watchEnded: (ended: () => void) => () => void;

  /** Calls `changed` whenever the browser mutes or unmutes the input; answers how to stop. */
  readonly watchMuted: (changed: (muted: boolean) => void) => () => void;

  /** Releases the input, so the browser's recording indicator goes out. */
  readonly stop: () => void;
}

/** Releases every track of a stream. */
function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** The open input of a stream and its audio track. */
function openedInput(stream: MediaStream, track: MediaStreamTrack): OpenedInput {
  return {
    stream,
    label: track.label === '' ? undefined : track.label,
    settings: grantedSettingsOf(track),
    isMuted: () => track.muted,
    watchEnded: (ended) => {
      const listener = (): void => {
        ended();
      };
      track.addEventListener('ended', listener);
      if (track.readyState === 'ended') ended();
      return () => {
        track.removeEventListener('ended', listener);
      };
    },
    watchMuted: (changed) => {
      const muted = (): void => {
        changed(true);
      };
      const unmuted = (): void => {
        changed(false);
      };
      track.addEventListener('mute', muted);
      track.addEventListener('unmute', unmuted);
      return () => {
        track.removeEventListener('mute', muted);
        track.removeEventListener('unmute', unmuted);
      };
    },
    stop: () => {
      stopStream(stream);
    },
  };
}

/**
 * Opens the audio input `request` asks for, audio only, and answers it open,
 * or the failure the browser's refusal stands for.
 *
 * The browser cannot be told to stop asking, so a cancellation that comes
 * while it asks releases the input as soon as it is given.
 */
export async function openInput(
  devices: MediaDevices,
  request: CaptureRequest,
  signal?: CancellationSignal,
): Promise<DomainResult<OpenedInput>> {
  throwIfCancelled(signal);
  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({ audio: audioConstraintsOf(request), video: false });
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === undefined) throw error;
    return fail(refusal);
  }
  if (signal?.aborted === true) {
    stopStream(stream);
    throwIfCancelled(signal);
  }
  const [track] = stream.getAudioTracks();
  if (track === undefined) {
    stopStream(stream);
    return fail(noAudioTrack());
  }
  return succeed(openedInput(stream, track));
}
