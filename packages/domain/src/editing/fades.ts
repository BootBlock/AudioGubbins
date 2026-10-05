/**
 * The shapes and directions of a fade, which an edit operation names and a
 * plan's stages compute (ADR-0032), apart from both so neither imports the
 * other for them.
 */

/**
 * How a fade's gain moves from one end to the other.
 *
 * Each is a function of the ramp's position `t` in `[0, 1]` built from
 * addition, multiplication and the square root alone, so it gives the same
 * bits on every machine (ADR-0032). Equal power is the square root, whose
 * square and its partner's add to one across a crossfade.
 */
export const FadeShape = {
  Linear: 'linear',
  EqualPower: 'equal-power',
  SCurve: 's-curve',
  Square: 'square',
} as const;

/** How a fade's gain moves from one end to the other. */
export type FadeShape = (typeof FadeShape)[keyof typeof FadeShape];

/** Which way a fade goes: up from silence, or down to it. */
export const FadeDirection = { In: 'in', Out: 'out' } as const;

/** Which way a fade goes. */
export type FadeDirection = (typeof FadeDirection)[keyof typeof FadeDirection];
