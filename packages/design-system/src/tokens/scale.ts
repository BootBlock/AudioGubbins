/**
 * Spacing, size, typography and motion scales.
 *
 * REQ-UX-071 requires density preferences rather than one compromise layout,
 * and REQ-UX-155 requires touch-target scaling. Those are the same problem: a
 * control sized for a mouse is too small for a finger, and a control sized for
 * a finger wastes a laptop screen.
 *
 * The scales are therefore functions of the density, not constants. A component
 * asks for `space.medium` and gets whatever that means under the current
 * density, so no component holds a number that has to change when the density
 * does.
 */

import { Density, MotionLevel } from './preferences.js';

/** Spacing steps, in pixels. */
export type SpacingScale = {
  readonly none: number;
  readonly tiny: number;
  readonly small: number;
  readonly medium: number;
  readonly large: number;
  readonly huge: number;
};

/** Corner radii, in pixels. */
export type RadiusScale = {
  readonly none: number;
  readonly small: number;
  readonly medium: number;
  readonly large: number;

  /** For a pill or a circular control. */
  readonly full: number;
};

/** Text sizes and line heights, in pixels. */
export type TypographyScale = {
  readonly tiny: number;
  readonly small: number;
  readonly body: number;
  readonly large: number;
  readonly heading: number;

  /** Line height as a multiple of the text size. */
  readonly lineHeight: number;

  /** For a numeric readout, where digits must not shift as the value changes. */
  readonly monospaceBody: number;
};

/** Control sizes, in pixels. */
export type ControlScale = {
  /** Height of an ordinary button, field or select. */
  readonly height: number;

  /** Height of a compact control inside a toolbar. */
  readonly compactHeight: number;

  /** An icon inside a control. */
  readonly iconSize: number;

  /**
   * The smallest square a pointer must be able to hit.
   *
   * A visually small control still carries a hit area of at least this, because
   * WCAG 2.2 asks for 24 pixels and a finger needs more. The gap between the
   * drawn control and its hit area is invisible and is what makes a dense
   * toolbar usable on a tablet (REQ-UX-067).
   */
  readonly minimumTouchTarget: number;
};

/** Durations in milliseconds and the easing curves that go with them. */
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
};

/** Everything the layout depends on, for one density. */
export interface Metrics {
  readonly space: SpacingScale;
  readonly radius: RadiusScale;
  readonly text: TypographyScale;
  readonly control: ControlScale;
}

const COMFORTABLE: Metrics = {
  space: { none: 0, tiny: 4, small: 8, medium: 12, large: 20, huge: 32 },
  radius: { none: 0, small: 3, medium: 6, large: 10, full: 9999 },
  text: {
    tiny: 11,
    small: 12,
    body: 14,
    large: 16,
    heading: 20,
    lineHeight: 1.5,
    monospaceBody: 13,
  },
  control: { height: 32, compactHeight: 28, iconSize: 16, minimumTouchTarget: 44 },
};

const COMPACT: Metrics = {
  space: { none: 0, tiny: 2, small: 6, medium: 8, large: 14, huge: 22 },
  radius: { none: 0, small: 2, medium: 4, large: 8, full: 9999 },
  text: {
    tiny: 10,
    small: 11,
    body: 12,
    large: 14,
    heading: 17,
    lineHeight: 1.4,
    monospaceBody: 11,
  },

  // The drawn control shrinks; the hit area does not. REQ-UX-067 requires touch
  // to keep working, and a user who chose a dense workspace on a tablet has not
  // asked for controls they cannot hit. The compact height is 24 and no less: a
  // row in a menu or a list cannot widen its hit area past its neighbours, so
  // what it draws is what a mouse user hits, and WCAG 2.5.8 sets 24 pixels as
  // the least a target may be.
  control: { height: 26, compactHeight: 24, iconSize: 14, minimumTouchTarget: 44 },
};

/** The metrics for a density. */
export function metricsFor(density: Density): Metrics {
  return density === Density.Compact ? COMPACT : COMFORTABLE;
}

/** Full motion: the intended experience (REQ-UX-069). */
const FULL_MOTION: MotionScale = {
  instant: 90,
  quick: 160,
  moderate: 240,
  deliberate: 360,
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.7, 0, 0.84, 0)',
  easeInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
};

/**
 * Reduced motion: shorter and gentler, but still present.
 *
 * Reduced is not off. A transition that shows a panel moving from one dock to
 * another is what tells the user where it went, and removing it entirely would
 * make the layout appear to teleport. The curves are made linear so nothing
 * overshoots, which is what most people asking for reduced motion are reacting
 * to.
 */
const REDUCED_MOTION: MotionScale = {
  instant: 60,
  quick: 90,
  moderate: 120,
  deliberate: 150,
  easeOut: 'linear',
  easeIn: 'linear',
  easeInOut: 'linear',
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
