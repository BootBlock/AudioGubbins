/**
 * Applying the user's brightness and contrast to a designed colour.
 *
 * The editing palettes, the category colours and the hardware materials are
 * stated as designed lightnesses rather than solved against a surface band, as
 * the chrome is. Each still has to move with the brightness the user chose and
 * separate further at high contrast, or it would stay the same whatever the
 * user asked for (REQ-UX-070). This is that one step, shared so that no palette
 * finishes its colours differently from another.
 */

import { scaleChroma, shiftLightness, type Oklch } from './colour.js';
import { ContrastLevel } from './preferences.js';

/** The preferences a designed colour is finished for. */
export interface Finishing {
  /** Perceptual lightness offset from -1 to 1, where 0 is as designed. */
  readonly brightness: number;

  readonly contrast: ContrastLevel;
}

/**
 * How far the brightness control moves lightness.
 *
 * A full-scale brightness of 1 moves every token by 0.18 in OKLCH lightness,
 * which is a clearly visible change while leaving room above the lightest
 * surface and below the darkest. A larger range would let a user flatten the
 * palette against either end, where every surface becomes the same colour.
 */
const BRIGHTNESS_SCALE = 0.18;

/** How high-contrast mode separates surfaces from text. */
const HIGH_CONTRAST = {
  /** Extra perceptual lightness between the darkest and lightest tokens. */
  separation: 0.08,

  /** Colour is reduced, because a strong tint makes text on it harder to read. */
  chromaFactor: 0.6,
} as const;

/** Applies the brightness offset, in the direction that makes a theme lighter. */
function brighten(colour: Oklch, finishing: Finishing): Oklch {
  return shiftLightness(colour, finishing.brightness * BRIGHTNESS_SCALE);
}

/**
 * Pushes a token away from the mid point, for high-contrast mode.
 *
 * Dark tokens get darker and light tokens get lighter, so the gap between a
 * surface and the text on it widens rather than both moving together.
 */
function separate(colour: Oklch, finishing: Finishing): Oklch {
  if (finishing.contrast !== ContrastLevel.High) return colour;

  const direction = colour.lightness >= 0.5 ? 1 : -1;
  return scaleChroma(
    shiftLightness(colour, direction * HIGH_CONTRAST.separation),
    HIGH_CONTRAST.chromaFactor,
  );
}

/** Applies brightness and contrast to a designed token. */
export function finish(colour: Oklch, finishing: Finishing): Oklch {
  return separate(brighten(colour, finishing), finishing);
}
