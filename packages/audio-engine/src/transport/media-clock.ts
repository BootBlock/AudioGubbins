/**
 * The media clock: where on the timeline the audio thread is.
 *
 * The audio thread counts context frames, at the device's rate. The timeline
 * counts frames of the material, at its own rate, which REQ-ARCH-085 keeps
 * native rather than converting to the device's. The clock maps one count to
 * the other from an anchor, a context frame and the timeline frame that played
 * at it, in whole frames and exact integer arithmetic, so a position read an
 * hour into playback is where it would be read a second in (REQ-ARCH-011).
 */

import {
  sampleCount,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

/** The two rates the clock converts between. */
export interface MediaClock {
  /** Frames per second of the material on the timeline. */
  readonly timelineRate: SampleRate;
  /** Frames per second the audio context runs at. */
  readonly contextRate: SampleRate;
}

/** A context frame and the timeline frame that played at it. */
export interface ClockAnchor {
  readonly contextFrame: number;
  readonly timelineFrame: SampleCount;
}

/**
 * `floor(value · multiplier / divisor)` for whole numbers, exact where the
 * product would pass 2⁵³: the whole quotients and the remainder are scaled
 * apart, so no intermediate is larger than `divisor · multiplier`.
 */
function scaledFloor(value: number, multiplier: number, divisor: number): number {
  const whole = Math.floor(value / divisor);
  const remainder = value - whole * divisor;
  return whole * multiplier + Math.floor((remainder * multiplier) / divisor);
}

/**
 * The timeline frame playing at `contextFrame`, from an anchor.
 *
 * Rounded down, so the position reported never runs ahead of what has
 * played. A context frame before the anchor is the anchor's own frame: the
 * clock is not asked about the past of a segment it did not play.
 */
export function timelineFrameAt(
  clock: MediaClock,
  anchor: ClockAnchor,
  contextFrame: number,
): DomainResult<SampleCount> {
  const elapsed = Math.max(0, contextFrame - anchor.contextFrame);
  return sampleCount(
    anchor.timelineFrame + scaledFloor(elapsed, clock.timelineRate, clock.contextRate),
  );
}

/**
 * The first context frame at which `timelineFrame` plays, from an anchor, for
 * scheduling something to happen at a timeline position.
 */
export function contextFrameFor(
  clock: MediaClock,
  anchor: ClockAnchor,
  timelineFrame: SampleCount,
): number {
  const ahead = Math.max(0, timelineFrame - anchor.timelineFrame);
  // The smallest context count whose timeline count reaches `ahead`: a ceiling.
  const floor = scaledFloor(ahead, clock.contextRate, clock.timelineRate);
  const reaches = scaledFloor(floor, clock.timelineRate, clock.contextRate) >= ahead;
  return anchor.contextFrame + (reaches ? floor : floor + 1);
}

/**
 * The timeline frame the listener hears at `position`, given the frames the
 * output adds after the engine: the device's latency and the graph's own,
 * converted to timeline frames. What a playhead should show (REQ-ARCH-144's
 * "monitoring latency can be reported accurately").
 */
export function audibleFrame(
  clock: MediaClock,
  position: SampleCount,
  outputLatencyContextFrames: number,
): DomainResult<SampleCount> {
  const behind = scaledFloor(outputLatencyContextFrames, clock.timelineRate, clock.contextRate);
  return sampleCount(Math.max(0, position - behind));
}
