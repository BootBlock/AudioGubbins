/**
 * The transport: whether audio is playing, and from where.
 *
 * A state machine written as one function of a state and an event, so the
 * whole of its behaviour is testable without a clock or an audio thread, and
 * the runtime only feeds it what happened. Positions are timeline frames; the
 * running state holds the clock anchor that turns the audio thread's frame
 * count into one.
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
  | { readonly kind: 'play'; readonly contextFrame: number }
  | { readonly kind: 'pause'; readonly contextFrame: number }
  | { readonly kind: 'stop' }
  | { readonly kind: 'seek'; readonly to: SampleCount; readonly contextFrame: number }
  | { readonly kind: 'context-suspended'; readonly contextFrame: number }
  | { readonly kind: 'context-resumed'; readonly contextFrame: number }
  /** The material ran out; the transport stops where it ended. */
  | { readonly kind: 'reached-end'; readonly contextFrame: number };

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

/** Where a play starts from each state, and what Stop will return to. */
function startOf(state: TransportState): { position: SampleCount; origin: SampleCount } {
  switch (state.mode) {
    case TransportMode.Stopped:
      return { position: state.position, origin: state.position };
    case TransportMode.Paused:
    case TransportMode.Suspended:
      return { position: state.position, origin: state.origin };
    case TransportMode.Playing:
      return { position: state.anchor.timelineFrame, origin: state.origin };
  }
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
      return fromPlay(state, event.contextFrame);
    case 'pause':
      return fromPause(state, event.contextFrame, clock);
    case 'stop':
      return succeed({ mode: TransportMode.Stopped, position: startOf(state).origin });
    case 'seek':
      return succeed(seekTo(state, event.to, event.contextFrame));
    case 'context-suspended':
      return fromSuspension(state, event.contextFrame, clock);
    case 'context-resumed':
      return succeed(fromResumption(state, event.contextFrame));
    case 'reached-end':
      return flatMapResult(transportPosition(state, clock, event.contextFrame), (position) =>
        succeed({ mode: TransportMode.Stopped, position }),
      );
  }
}

function fromPlay(state: TransportState, contextFrame: number): DomainResult<TransportState> {
  // Already playing, or held by the system until the context resumes it.
  if (state.mode === TransportMode.Playing || state.mode === TransportMode.Suspended) {
    return succeed(state);
  }
  const { position, origin } = startOf(state);
  return succeed(playingFrom(position, origin, contextFrame));
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
