/**
 * A take's capture on the input open now (`ADR-0070`): Record, a count-in, Stop
 * and a stop set for a frame still to come, each as the session machine allows,
 * told to the capture processor, which keeps the frames exactly; and what the
 * processor answers of a take moving the session, a count-in ending as its take
 * begins and a set stop reached.
 *
 * The input control opens and closes the input and holds the session; this is
 * the part of it a take is made with, which the recording flow drives, and
 * which never opens or closes anything.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import { FromCaptureKind, type CaptureSessionEvent } from '@audiogubbins/audio-runtime';
import type { RecordingSession, SessionEvent, StopReason } from '@audiogubbins/recording';

import type { CapturePort } from '../audio/capture-parts.js';

/** What a take's capture reads of the input control, and how it moves the session. */
export interface TakeCaptureParts {
  readonly session: () => RecordingSession;
  readonly dispatch: (event: SessionEvent) => DomainResult<void>;
  /** The capture of the input open now, and its rate, where one is open. */
  readonly open: () => { readonly capture: CapturePort; readonly rate: number } | undefined;
  /** Whole seconds the retrospective buffer holds now. */
  readonly bufferedSeconds: () => number;
  /** The context frame now, where an input is open. */
  readonly contextFrame: () => SampleCount | undefined;
}

const NO_INPUT = failure(
  'recording.no-input',
  FailureKind.Rejected,
  'No input is open to record from.',
);

/** The part of the input control a take is made with (see the module comment). */
export class TakeCapture {
  readonly #parts: TakeCaptureParts;
  /** The frame the capture was told to stop before, while it has not said it stopped. */
  #stopsAt: SampleCount | undefined;

  constructor(parts: TakeCaptureParts) {
    this.#parts = parts;
  }

  /**
   * Records from context frame `at` onto a capture channel, whose far end is
   * answered for the caller to transfer to the storage worker; or why not. A
   * frame still to come is waited for on the audio thread, so a take begins on
   * it exactly; the capture's `recording` reply says its first frame.
   */
  record(at: SampleCount, holdsWriteLease: boolean): DomainResult<MessagePort> {
    const open = this.#parts.open();
    if (open === undefined) return fail(NO_INPUT);
    const held = derivedSampleCount(Math.round(this.#parts.bufferedSeconds() * open.rate));
    const moved = this.#parts.dispatch({ kind: 'record', at, held, holdsWriteLease });
    if (!moved.ok) return moved;
    return this.#captured(open.capture, at);
  }

  /**
   * Counts in to context frame `recordAt`, which the capture is told now, so
   * the take begins on it exactly; the session records from the capture's
   * `recording` reply. Answers the capture channel's far end, as Record does.
   */
  countIn(recordAt: SampleCount, holdsWriteLease: boolean): DomainResult<MessagePort> {
    const open = this.#parts.open();
    if (open === undefined) return fail(NO_INPUT);
    const moved = this.#parts.dispatch({ kind: 'count-in-started', recordAt, holdsWriteLease });
    if (!moved.ok) return moved;
    return this.#captured(open.capture, recordAt);
  }

  #captured(capture: CapturePort, at: SampleCount): DomainResult<MessagePort> {
    const channel = capture.record(at);
    if (!channel.ok) this.#parts.dispatch({ kind: 'failed', failure: channel.failures[0] });
    return channel;
  }

  /**
   * Stops the recording, or the count-in, before context frame `at`, for
   * `reason`: the person's stop, its timed end, the page hidden while a
   * controlled recording runs, or storage refusing a write.
   */
  stop(
    at: SampleCount,
    reason: Extract<StopReason['kind'], 'person' | 'timed' | 'background-suspended' | 'quota'>,
  ): DomainResult<void> {
    const moved = this.#parts.dispatch({ kind: 'stop', reason });
    if (!moved.ok) return moved;
    this.#stopsAt = undefined;
    return this.#parts.open()?.capture.stop(at) ?? succeed(undefined);
  }

  /**
   * Has the capture stop before context frame `at`, still to come: the take
   * ends on that frame exactly, and the session stops, as timed, when the
   * capture says it has.
   */
  stopBefore(at: SampleCount): DomainResult<void> {
    const open = this.#parts.open();
    const { kind } = this.#parts.session();
    if (open === undefined || (kind !== 'recording' && kind !== 'counting-in')) {
      return fail(
        failure('recording.not-recording', FailureKind.Rejected, 'Nothing is being recorded.'),
      );
    }
    const told = open.capture.stop(at);
    if (told.ok) this.#stopsAt = at;
    return told;
  }

  /**
   * Ends the recording for `failure`, which recording cannot go on through, as
   * storage that could not keep it: the capture stops where it is.
   */
  abandon(failure: DomainFailure): void {
    const recording = this.#parts.session().kind === 'recording';
    this.#parts.dispatch({ kind: 'failed', failure });
    if (recording) this.stopNow();
  }

  /**
   * Tells the capture to stop at the frame now, where it still can: a context
   * that went says nothing more, and the storage worker cuts the channel.
   */
  stopNow(): void {
    const at = this.#parts.contextFrame();
    if (at !== undefined) this.#parts.open()?.capture.stop(at);
    this.#stopsAt = undefined;
  }

  /** The input closed: no stop it was told of is waited for any more. */
  forget(): void {
    this.#stopsAt = undefined;
  }

  /**
   * Moves the session by what the capture says of a take: a count-in ends as
   * its take begins, and a take told to stop before a frame stops, as timed,
   * when the capture has stopped it there.
   */
  heard(event: CaptureSessionEvent): void {
    const session = this.#parts.session();
    if (event.kind === FromCaptureKind.Recording && session.kind === 'counting-in') {
      this.#parts.dispatch({
        kind: 'count-in-elapsed',
        held: derivedSampleCount(event.retrospectiveFrames),
      });
    } else if (
      event.kind === FromCaptureKind.Stopped &&
      session.kind === 'recording' &&
      this.#stopsAt !== undefined
    ) {
      this.#stopsAt = undefined;
      this.#parts.dispatch({ kind: 'stop', reason: 'timed' });
    }
  }
}
