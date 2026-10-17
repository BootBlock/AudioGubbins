/**
 * The motion scale: durations, easings, the loops' periods, how far and from
 * what scale a surface enters, and the meters' ballistics, per motion level
 * (REQ-UX-069, REQ-UX-222, the design language's MotionSpec).
 *
 * A function of the level, as the sizes are of the density, so a transition
 * written once over these tokens moves at Full, fades at Reduced and is
 * immediate at Minimal without knowing which is in force.
 */

import { MotionLevel } from './preferences.js';

/** How long each looping animation takes to run once, in milliseconds. */
export type LoopScale = {
  /** The focus halo's breath. */
  readonly focus: number;

  /** The floating panel's halo. */
  readonly float: number;

  /** The splitter's pulse. */
  readonly splitter: number;

  /** The landing area's glow. */
  readonly landing: number;

  /** The recording LED's breath. */
  readonly recording: number;

  /** A skeleton's shimmer and the progress bar's sheen. */
  readonly shimmer: number;

  /** One turn of a spinner. */
  readonly spinner: number;

  /** One pass of an indeterminate progress bar. */
  readonly indeterminate: number;
};

/** How far an entering or leaving surface travels, in pixels. */
export type TravelScale = {
  /** A menu, a popover, a list item. */
  readonly small: number;

  /** A dialogue. */
  readonly medium: number;

  /** A notice. */
  readonly large: number;
};

/** The scale an entering surface starts from, as a multiple of its size. */
export type EntryScale = {
  /** A menu, a popover or a select. */
  readonly overlay: number;

  /** A dialogue or a panel. */
  readonly dialogue: number;

  /** The drop compass, which springs in. */
  readonly spring: number;
};

/**
 * How a level meter moves (REQ-UX-222): its measurement, not an animation, so
 * the same at every motion level. A rise is shown in the frame it arrives.
 */
export type MeterBallistics = {
  /** How fast a level falls back, in decibels a second. */
  readonly fallRate: number;

  /** How long the peak hold waits before it falls, in milliseconds. */
  readonly peakHold: number;

  /** How fast the held peak falls, in decibels a second. */
  readonly peakFallRate: number;

  /** How long the clip LED stays lit after an over, in milliseconds. */
  readonly clipHold: number;

  /** The correlation pointer's time constant, in milliseconds. */
  readonly correlationTime: number;
};

/**
 * Durations in milliseconds, the easing curves that go with them, and the
 * distances, scales and ballistics a motion reads.
 *
 * Typed as well as emitted, so a canvas renderer (the editor's zoom, the
 * meters) reads the same values through the design system rather than parsing
 * a stylesheet.
 */
export type MotionScale = {
  /** A hover or a focus ring appearing. */
  readonly instant: number;

  /** A menu opening, a tooltip appearing. */
  readonly quick: number;

  /** A panel sliding, a dialogue entering. */
  readonly moderate: number;

  /** A workspace layout rearranging. */
  readonly deliberate: number;

  /** For something entering the screen. */
  readonly easeOut: string;

  /** For something leaving. */
  readonly easeIn: string;

  /** For something moving from one place to another. */
  readonly easeInOut: string;

  /** A damped spring, for the drop compass and the notices. */
  readonly easeSpring: string;

  /**
   * The loops' periods, the same at every level: only the full level runs the
   * animations that read them.
   */
  readonly loop: LoopScale;

  /** None below the full level, so a rule written once moves only at Full. */
  readonly distance: TravelScale;

  /** One below the full level, for the same reason as the distances. */
  readonly scale: EntryScale;

  readonly ballistics: MeterBallistics;
};

const LOOPS: LoopScale = {
  focus: 1800,
  float: 3200,
  splitter: 2200,
  landing: 2500,
  recording: 1600,
  shimmer: 1600,
  spinner: 800,
  indeterminate: 1400,
};

const BALLISTICS: MeterBallistics = {
  fallRate: 20,
  peakHold: 1200,
  peakFallRate: 12,
  clipHold: 1500,
  correlationTime: 170,
};

/** No travel and no growth: what Reduced and Minimal keep of an entrance is its fade. */
const STILL_DISTANCE: TravelScale = { small: 0, medium: 0, large: 0 };
const STILL_SCALE: EntryScale = { overlay: 1, dialogue: 1, spring: 1 };

/**
 * A damped spring with a damping ratio of 0.45: a 20 per cent overshoot at 40
 * per cent of the duration, settled by the end. Sampled into `linear()`, which
 * a transition can use where a cubic Bézier cannot overshoot and come back.
 */
const SPRING =
  'linear(0, 0.059 4%, 0.207 8%, 0.402 12%, 0.610 16%, 0.803 20%, 0.964 24%, 1.085 28%, ' +
  '1.162 32%, 1.199 36%, 1.204 40%, 1.168 46%, 1.108 52%, 1.028 60%, 0.969 70%, 0.959 80%, ' +
  '0.976 90%, 1)';

/** Full motion: the intended experience (REQ-UX-069). */
const FULL_MOTION: MotionScale = {
  instant: 90,
  quick: 160,
  moderate: 240,
  deliberate: 360,
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  easeSpring: SPRING,
  loop: LOOPS,
  distance: { small: 4, medium: 8, large: 16 },
  scale: { overlay: 0.96, dialogue: 0.98, spring: 0.82 },
  ballistics: BALLISTICS,
};

/**
 * Reduced motion: shorter and gentler, but still present.
 *
 * Reduced is not off. A transition that shows a panel moving from one dock to
 * another is what tells the user where it went, and removing it entirely would
 * make the layout appear to teleport. The curves are made linear so nothing
 * overshoots, which is what most people asking for reduced motion are reacting
 * to, and nothing travels or grows, so what is left is a fade.
 */
const REDUCED_MOTION: MotionScale = {
  instant: 60,
  quick: 90,
  moderate: 120,
  deliberate: 150,
  easeOut: 'linear',
  easeIn: 'linear',
  easeInOut: 'linear',
  easeSpring: 'linear',
  loop: LOOPS,
  distance: STILL_DISTANCE,
  scale: STILL_SCALE,
  ballistics: BALLISTICS,
};

/** Minimal motion: every change is instant. */
const MINIMAL_MOTION: MotionScale = {
  instant: 0,
  quick: 0,
  moderate: 0,
  deliberate: 0,
  easeOut: 'linear',
  easeIn: 'linear',
  easeInOut: 'linear',
  easeSpring: 'linear',
  loop: LOOPS,
  distance: STILL_DISTANCE,
  scale: STILL_SCALE,
  ballistics: BALLISTICS,
};

/** The motion scale for a level. */
export function motionFor(level: MotionLevel): MotionScale {
  switch (level) {
    case MotionLevel.Full:
      return FULL_MOTION;
    case MotionLevel.Reduced:
      return REDUCED_MOTION;
    case MotionLevel.Minimal:
      return MINIMAL_MOTION;
  }
}
