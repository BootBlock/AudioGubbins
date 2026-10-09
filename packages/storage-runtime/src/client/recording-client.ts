/**
 * Recordings, as the page asks the storage worker for them (ADR-0071): the
 * time the storage leaves to record, a recording begun from a capture
 * channel, its status as it goes, its stop, and the recovery and discarding
 * of one a crash cut short.
 *
 * The page holds no recorded sample: it hands the worker the capture
 * channel's port, transferred, and the capture worklet writes the other end.
 */

import type { DomainResult, SampleRate } from '@audiogubbins/domain';
import type { RecordingEnding, RecordingSessionId } from '@audiogubbins/project-format';
import type { StorageTimeLeft } from '@audiogubbins/recording';
import type {
  FinishedRecording,
  InterruptedRecording,
  RecordingSetUp,
} from '@audiogubbins/storage';

import { recordingStream, type RecordingStatus } from '../protocol/recording-operations.js';
import type { ClientChannel } from '../protocol/storage-operations.js';
import type { RemoteProjectSession } from './remote-project.js';

/** A recording to begin. */
export interface RecordingBegin {
  /** The recording's session, which the page mints, so it hears the status before it begins. */
  readonly session: RecordingSessionId;

  /** The storage worker's end of the take's capture channel, which the call transfers. */
  readonly capture: MessagePort;

  /** What the recording is set up as, which names and places the take it becomes. */
  readonly setUp: RecordingSetUp;
}

/** Recording into a project, and what was cut short. */
export interface RecordingClient {
  /** The recording time the storage leaves at `sampleRate` over `channels` channels, before arming. */
  timeLeft(
    sampleRate: SampleRate,
    channels: number,
    signal?: AbortSignal,
  ): Promise<StorageTimeLeft>;

  /**
   * Begins recording into the project `project` writes, as `request` says:
   * refused, with the reason, where this window does not hold the project to
   * change it or no WAV file can hold the recording. It records until capture
   * ends, then makes the recording its asset and take.
   */
  begin(
    project: RemoteProjectSession,
    request: RecordingBegin,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>>;

  /** Hears each status of recording `session`, until the returned function is called. */
  status(session: RecordingSessionId, listener: (status: RecordingStatus) => void): () => void;

  /**
   * Says why recording `session` ends, and answers once it is its asset and
   * take, or kept to be recovered. Called off, the capture channel is cut where
   * it has reached, and the recording is made of what was committed.
   */
  stop(
    session: RecordingSessionId,
    ending: RecordingEnding,
    signal?: AbortSignal,
  ): Promise<DomainResult<FinishedRecording>>;

  /** The recordings of the project `project` writes that were cut short, none in progress. */
  interrupted(
    project: RemoteProjectSession,
    signal?: AbortSignal,
  ): Promise<DomainResult<readonly InterruptedRecording[]>>;

  /**
   * Makes an interrupted recording the asset and take it was for, named and
   * placed as when it began.
   */
  recover(
    project: RemoteProjectSession,
    session: RecordingSessionId,
    signal?: AbortSignal,
  ): Promise<DomainResult<FinishedRecording>>;

  /** Removes an interrupted recording, on the person's word. */
  discard(
    project: RemoteProjectSession,
    session: RecordingSessionId,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>>;
}

/** Recordings, over calls to the worker. */
export function recordingClient(channel: ClientChannel): RecordingClient {
  return {
    timeLeft: (sampleRate, channels, signal) =>
      channel.call('recording.timeLeft', { sampleRate, channels }, { signal }),
    begin: (project, request, signal) =>
      channel.call(
        'recording.begin',
        { handle: project.handle, ...request },
        { signal, transfer: [request.capture] },
      ),
    status: (session, listener) => channel.listen(recordingStream(session), listener),
    stop: (session, ending, signal) =>
      channel.call('recording.stop', { session, ending }, { signal }),
    interrupted: (project, signal) =>
      channel.call('recording.interrupted', { handle: project.handle }, { signal }),
    recover: (project, session, signal) =>
      channel.call('recording.recover', { handle: project.handle, session }, { signal }),
    discard: (project, session, signal) =>
      channel.call('recording.discard', { handle: project.handle, session }, { signal }),
  };
}
