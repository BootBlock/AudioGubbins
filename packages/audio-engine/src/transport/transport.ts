/**
 * The transport: whether audio is playing, and from where.
 *
 * A state machine written as one function of a state and an event, so the
 * whole of its behaviour is testable without a clock or an audio thread, and
 * the runtime only feeds it what happened. Positions are timeline frames; the
 * running state holds the clock anchor that turns the audio thread's frame
 * count into one.
 *
 * Where playback is comes from the audio thread, which counts the timeline
 * frames that have left the graph for the output: a start, a periodic report,
 * a halt and the end each carry that count, and the transport takes it as it
 * is. Between two reports the clock interpolates from the last anchor, which
 * is good enough for a playhead and for nothing else: a pause is settled by
 * the count the audio thread gives when it halts (`halted`), and the end by
 * the count at the end, because the main thread's clock lags the audio
 * thread's and does not see an underrun, which delays the audio and not the
 * context's clock.
 *
 * The system can suspend the audio context at any time: an autoplay rule, a
 * phone call on iOS, a device unplugged. The packet requires suspension and
 * resumption to preserve transport correctness. Only playback is affected, so
 * a suspension while playing freezes the position where it fell, and resuming
 * re-anchors the clock at that position rather than letting it jump by the
 * time the context was away. A stopped or paused transport is not moved by
 * the context at all.
 */

import {
  ZERO_SAMPLES,
  failure,
  FailureKind,
  fail,
  flatMapResult,
  succeed,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';

import { timelineFrameAt, type ClockAnchor, type MediaClock } from './media-clock.js';

/** What the transport is doing. */
export const TransportMode = {
  Stopped: 'stopped',
  Playing: 'playing',
  Paused: 'paused',
  /**
   * Playing, but the system took the audio context away: the position is
   * frozen until it comes back, and playback continues then.
   */
  Suspended: 'suspended',
} as const;

/** What the transport is doing. */
export type TransportMode = (typeof TransportMode)[keyof typeof TransportMode];

/** The transport's state. `origin` is where the last play started, for Stop to return to. */
export type TransportState =
  | { readonly mode: typeof TransportMode.Stopped; readonly position: SampleCount }
  | {
      readonly mode: typeof TransportMode.Playing;
      readonly anchor: ClockAnchor;
      readonly origin: SampleCount;
    }
  | {
      readonly mode: typeof TransportMode.Paused;
      readonly position: SampleCount;
      readonly origin: SampleCount;
    }
  | {
      readonly mode: typeof TransportMode.Suspended;
      readonly position: SampleCount;
      readonly origin: SampleCount;
    };

/** Something that happened to the transport, at the audio thread's frame. */
export type TransportEvent =
  /** The audio thread started: timeline frame `position` reaches the output at `contextFrame`. */
  | { readonly kind: 'play'; readonly contextFrame: number; readonly position: SampleCount }
  /** The audio thread's count while playing: `position` reaches the output at `contextFrame`. */
  | { readonly kind: 'clock'; readonly contextFrame: number; readonly position: SampleCount }
  /** Paused where the clock puts it at `contextFrame`, until the audio thread says where it halted. */
  | { readonly kind: 'pause'; readonly contextFrame: number }
  /** The audio thread halted with `position` the next frame it would have output. */
  | { readonly kind: 'halted'; readonly position: SampleCount }
  | { readonly kind: 'stop' }
  | { readonly kind: 'seek'; readonly to: SampleCount; readonly contextFrame: number }
  | { readonly kind: 'context-suspended'; readonly contextFrame: number }
  | { readonly kind: 'context-resumed'; readonly contextFrame: number }
  /** The material ran out, its last frame output; the transport stops at `position`, its end. */
  | { readonly kind: 'reached-end'; readonly position: SampleCount };

/** A stopped transport at the start. */
export const TRANSPORT_AT_START: TransportState = {
  mode: TransportMode.Stopped,
  position: ZERO_SAMPLES,
};

/** The timeline frame the transport is at, as of `contextFrame`. */
export function transportPosition(
  state: TransportState,
  clock: MediaClock,
  contextFrame: number,
): DomainResult<SampleCount> {
  return state.mode === TransportMode.Playing
    ? timelineFrameAt(clock, state.anchor, contextFrame)
    : succeed(state.position);
}

/** What Stop returns to from each state: where the last play started, or where a stop left it. */
function originOf(state: TransportState): SampleCount {
  return state.mode === TransportMode.Stopped ? state.position : state.origin;
}

function playingFrom(
  position: SampleCount,
  origin: SampleCount,
  contextFrame: number,
): TransportState {
  return {
    mode: TransportMode.Playing,
    anchor: { contextFrame, timelineFrame: position },
    origin,
  };
}

/** The state after `event`, or why the event is not possible now. */
export function nextTransportState(
  state: TransportState,
  event: TransportEvent,
  clock: MediaClock,
): DomainResult<TransportState> {
  switch (event.kind) {
    case 'play':
      return succeed(fromPlay(state, event.contextFrame, event.position));
    case 'clock':
      return succeed(
        state.mode === TransportMode.Playing
          ? playingFrom(event.position, state.origin, event.contextFrame)
          : state,
      );
    case 'halted':
      return succeed(
        state.mode === TransportMode.Paused ? { ...state, position: event.position } : state,
      );
    case 'pause':
      return fromPause(state, event.contextFrame, clock);
    case 'stop':
      return succeed({ mode: TransportMode.Stopped, position: originOf(state) });
    case 'seek':
      return succeed(seekTo(state, event.to, event.contextFrame));
    case 'context-suspended':
      return fromSuspension(state, event.contextFrame, clock);
    case 'context-resumed':
      return succeed(fromResumption(state, event.contextFrame));
    case 'reached-end':
      return succeed({ mode: TransportMode.Stopped, position: event.position });
  }
}

/**
 * Playing from `position`, the audio thread's count, which is where the
 * transport stood unless a halt landed after the estimate a pause made.
 */
function fromPlay(
  state: TransportState,
  contextFrame: number,
  position: SampleCount,
): TransportState {
  // Held by the system until the context resumes it.
  if (state.mode === TransportMode.Suspended) return state;
  return playingFrom(position, originOf(state), contextFrame);
}

function fromPause(
  state: TransportState,
  contextFrame: number,
  clock: MediaClock,
): DomainResult<TransportState> {
  switch (state.mode) {
    case TransportMode.Playing:
      return flatMapResult(timelineFrameAt(clock, state.anchor, contextFrame), (position) =>
        succeed({ mode: TransportMode.Paused, position, origin: state.origin }),
      );
    case TransportMode.Suspended:
      // Paused where the system held it, so resumption leaves it paused.
      return succeed({
        mode: TransportMode.Paused,
        position: state.position,
        origin: state.origin,
      });
    case TransportMode.Paused:
      return succeed(state);
    case TransportMode.Stopped:
      return fail(
        failure(
          'transport.pause-while-stopped',
          FailureKind.Conflict,
          'The transport is stopped, so there is nothing to pause.',
        ),
      );
  }
}

function seekTo(state: TransportState, to: SampleCount, contextFrame: number): TransportState {
  switch (state.mode) {
    case TransportMode.Stopped:
      return { mode: TransportMode.Stopped, position: to };
    case TransportMode.Playing:
      // Playing goes on from the new place, and Stop returns there.
      return playingFrom(to, to, contextFrame);
    case TransportMode.Paused:
      return { mode: TransportMode.Paused, position: to, origin: to };
    case TransportMode.Suspended:
      return { ...state, position: to, origin: to };
  }
}

function fromSuspension(
  state: TransportState,
  contextFrame: number,
  clock: MediaClock,
): DomainResult<TransportState> {
  if (state.mode !== TransportMode.Playing) return succeed(state);
  return flatMapResult(timelineFrameAt(clock, state.anchor, contextFrame), (position) =>
    succeed({ mode: TransportMode.Suspended, position, origin: state.origin }),
  );
}

function fromResumption(state: TransportState, contextFrame: number): TransportState {
  return state.mode === TransportMode.Suspended
    ? playingFrom(state.position, state.origin, contextFrame)
    : state;
}
