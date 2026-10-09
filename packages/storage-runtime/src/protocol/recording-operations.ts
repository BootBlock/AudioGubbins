/**
 * What the page asks the storage worker of recordings (ADR-0071), and the
 * status the worker sends of each as it is made.
 *
 * The page never holds a recorded sample: it hands the worker the capture
 * channel's port, transferred, which the capture worklet writes, and the
 * worker commits what arrives. A recording is named by the session identifier
 * the page mints, so the page hears its status stream from before the worker
 * can send on it. Before arming, the page asks how long the storage leaves to
 * record; while recording, the status says how much is committed, the frames
 * lost and the time left, and then how the recording ended and what it
 * became.
 */

import type { DomainFailure, DomainResult, SampleRate } from '@audiogubbins/domain';
import type { RecordingEnding, RecordingSessionId } from '@audiogubbins/project-format';
import type { StorageTimeLeft } from '@audiogubbins/recording';
import type {
  FinishedRecording,
  InterruptedRecording,
  LostFrames,
  RecordingSetUp,
} from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { ProjectHandle } from './project-operations.js';

/** What a recording's status says, each time it changes. */
export type RecordingStatus =
  | {
      /** Capture runs: the frames committed so far, those lost, and the recording time left. */
      readonly kind: 'recording';
      readonly committed: number;
      readonly lost: LostFrames;
      readonly timeLeft: StorageTimeLeft;
    }
  | {
      /**
       * Capture ended, for `ending`, with the frames committed and lost. Where
       * `named`, the page ended it, and it is made into its asset once the
       * page's stop says why, which is then its ending; otherwise at once.
       */
      readonly kind: 'ended';
      readonly ending: RecordingEnding;
      readonly problem?: string;
      readonly committed: number;
      readonly lost: LostFrames;
      readonly named: boolean;
    }
  /** The recording is its asset and its take. */
  | { readonly kind: 'finished'; readonly recording: FinishedRecording }
  /** It could not be made into its asset, for `failure`: it is kept, to be recovered. */
  | { readonly kind: 'kept'; readonly failure: DomainFailure };

/** The stream a recording's status is sent on. */
export type RecordingStream = `recording:${string}`;

/** The name of the stream the status of recording `session` is sent on. */
export function recordingStream(session: RecordingSessionId): RecordingStream {
  return `recording:${session}`;
}

/** The operations of recordings. */
export type RecordingOperations = {
  /**
   * The recording time the storage leaves at `sampleRate` over `channels`
   * channels, read from the browser's estimate, which counts that finishing a
   * recording takes its size again.
   */
  'recording.timeLeft': Operation<
    { readonly sampleRate: SampleRate; readonly channels: number },
    StorageTimeLeft
  >;

  /**
   * Starts recording `session` into the project open under `handle`, from the
   * capture channel `capture`, transferred, as `setUp` says, which names and
   * places the take it becomes: refused, with the reason, where this window
   * does not hold the project to change it, no WAV file can hold the recording
   * or a recording that starts a stack does not name it. It records until
   * capture ends, then makes the recording its asset.
   */
  'recording.begin': Operation<
    {
      readonly handle: ProjectHandle;
      readonly session: RecordingSessionId;
      readonly capture: MessagePort;
      readonly setUp: RecordingSetUp;
    },
    DomainResult<void>
  >;

  /**
   * Says why recording `session` ends, and answers once it is its asset and
   * take, or kept to be recovered. Where the page ended the capture, this is
   * its ending, and the recording waits for it: every recording begun is
   * stopped, once. Called off, the channel is cut where it has reached, and
   * the recording is made of what was committed.
   */
  'recording.stop': Operation<
    { readonly session: RecordingSessionId; readonly ending: RecordingEnding },
    DomainResult<FinishedRecording>
  >;

  /** The recordings of the project open under `handle` that were cut short, none in progress. */
  'recording.interrupted': Operation<
    { readonly handle: ProjectHandle },
    DomainResult<readonly InterruptedRecording[]>
  >;

  /**
   * Makes an interrupted recording the asset and take it was for, named and
   * placed as when it began.
   */
  'recording.recover': Operation<
    { readonly handle: ProjectHandle; readonly session: RecordingSessionId },
    DomainResult<FinishedRecording>
  >;

  /** Removes an interrupted recording, on the person's word. */
  'recording.discard': Operation<
    { readonly handle: ProjectHandle; readonly session: RecordingSessionId },
    DomainResult<void>
  >;
};
