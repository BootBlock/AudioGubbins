/**
 * The colour model the design system is built on.
 *
 * REQ-UX-070 requires a user-adjustable theme brightness and states that it
 * "must not be implemented as a simple visual filter over the whole
 * application". It requires semantic colour and luminance tokens so that
 * contrast, accessibility, readability and component hierarchy stay correct
 * across the whole brightness range.
 *
 * That rules out sRGB arithmetic. Scaling an sRGB triple changes hue and
 * saturation as well as lightness, and equal steps in sRGB are not equal steps
 * in perceived brightness, so a palette adjusted that way loses its contrast
 * relationships exactly where they matter: at the ends of the range.
 *
 * Colours are therefore held in OKLCH, where lightness is perceptual and moves
 * independently of hue and chroma. Adjusting brightness becomes a change to one
 * number per token, and the contrast between two tokens can be computed rather
 * than hoped for.
 *
 * The conversions below follow Björn Ottosson's Oklab definition and the sRGB
 * transfer function from IEC 61966-2-1.
 */

/** A colour in OKLCH. */
export interface Oklch {
  /** Perceptual lightness, 0 (black) to 1 (white). */
  readonly lightness: number;

  /** Chroma. 0 is grey; the usable maximum depends on lightness and hue. */
  readonly chroma: number;

  /** Hue angle in degrees, 0 to 360. */
  readonly hue: number;

  /** Opacity, 0 to 1. */
  readonly alpha?: number;
}

/** A colour in sRGB, each channel 0 to 1. */
export interface Srgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** Constrains a value to a range. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The sRGB transfer function, from linear light to encoded value. */
function encodeSrgbChannel(linear: number): number {
  return linear <= 0.003_130_8 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

/** The inverse sRGB transfer function, from encoded value to linear light. */
function decodeSrgbChannel(encoded: number): number {
  return encoded <= 0.040_45 ? encoded / 12.92 : Math.pow((encoded + 0.055) / 1.055, 2.4);
}

/** Converts OKLCH to sRGB, clamping any colour outside the sRGB gamut. */
export function oklchToSrgb(colour: Oklch): Srgb {
  const hueRadians = (colour.hue * Math.PI) / 180;
  const a = colour.chroma * Math.cos(hueRadians);
  const b = colour.chroma * Math.sin(hueRadians);

  // Oklab to LMS, cube-rooted.
  const l = colour.lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b;
  const m = colour.lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b;
  const s = colour.lightness - 0.089_484_177_5 * a - 1.291_485_548 * b;

  const lCubed = l * l * l;
  const mCubed = m * m * m;
  const sCubed = s * s * s;

  // LMS to linear sRGB.
  const linearRed = 4.076_741_662_1 * lCubed - 3.307_711_591_3 * mCubed + 0.230_969_929_2 * sCubed;
  const linearGreen =
    -1.268_438_004_6 * lCubed + 2.609_757_401_1 * mCubed - 0.341_319_396_5 * sCubed;
  const linearBlue = -0.004_196_086_3 * lCubed - 0.703_418_614_7 * mCubed + 1.707_614_701 * sCubed;

  // Clamping is a last resort for a colour the display cannot show. The palette
  // is defined inside the gamut, so this only bites for an accent the user has
  // pushed to an extreme, where losing a little chroma is the right compromise.
  return {
    red: clamp(encodeSrgbChannel(linearRed), 0, 1),
    green: clamp(encodeSrgbChannel(linearGreen), 0, 1),
    blue: clamp(encodeSrgbChannel(linearBlue), 0, 1),
    alpha: colour.alpha ?? 1,
  };
}

/** Converts sRGB to OKLCH. */
export function srgbToOklch(colour: Srgb): Oklch {
  const linearRed = decodeSrgbChannel(colour.red);
  const linearGreen = decodeSrgbChannel(colour.green);
  const linearBlue = decodeSrgbChannel(colour.blue);

  const l = Math.cbrt(
    0.412_221_470_8 * linearRed + 0.536_332_536_3 * linearGreen + 0.051_445_992_9 * linearBlue,
  );
  const m = Math.cbrt(
    0.211_903_498_2 * linearRed + 0.680_699_545_1 * linearGreen + 0.107_396_956_6 * linearBlue,
  );
  const s = Math.cbrt(
    0.088_302_461_9 * linearRed + 0.281_718_837_6 * linearGreen + 0.629_978_700_5 * linearBlue,
  );

  const lightness = 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s;
  const a = 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s;
  const b = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s;

  const chroma = Math.hypot(a, b);
  const hue = chroma === 0 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

  return { lightness, chroma, hue, alpha: colour.alpha };
}

/**
 * Writes a colour as a CSS value.
 *
 * Emitted as `oklch()`, which every browser AudioGubbins targets understands.
 * Keeping the authored colour space in the stylesheet means a browser
 * interpolating between two of these does so perceptually, so a hover
 * transition does not dip through a grey that neither end contains.
 */
export function oklchToCss(colour: Oklch): string {
  const lightness = (colour.lightness * 100).toFixed(2);
  const chroma = colour.chroma.toFixed(4);
  const hue = colour.hue.toFixed(2);
  const alpha = colour.alpha ?? 1;

  return alpha === 1
    ? `oklch(${lightness}% ${chroma} ${hue})`
    : `oklch(${lightness}% ${chroma} ${hue} / ${alpha.toFixed(3)})`;
}

/** Writes a colour as `#rrggbb`, for a context that cannot take `oklch()`. */
export function oklchToHex(colour: Oklch): string {
  const { red, green, blue } = oklchToSrgb(colour);
  const channel = (value: number): string =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/**
 * Relative luminance, as WCAG 2 defines it.
 *
 * Distinct from OKLCH lightness: OKLCH lightness is perceptual, while this is
 * the photometric quantity the contrast formula needs. Using one for the other
 * gives ratios that look plausible and are wrong.
 */
export function relativeLuminance(colour: Oklch): number {
  const { red, green, blue } = oklchToSrgb(colour);
  return (
    0.2126 * decodeSrgbChannel(red) +
    0.7152 * decodeSrgbChannel(green) +
    0.0722 * decodeSrgbChannel(blue)
  );
}

/**
 * The WCAG 2 contrast ratio between two colours, from 1 to 21.
 *
 * The threshold AudioGubbins holds itself to is 4.5 for body text and 3 for
 * large text and for the boundary of an interactive control. A token pair that
 * cannot reach its threshold anywhere in the brightness range is a defect the
 * theme tests catch, not a judgement left to whoever looks at the screen.
 */
export function contrastRatio(foreground: Oklch, background: Oklch): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The surface a colour is hardest to be seen on: the one it has the least
 * contrast with, which is the one nearest its own lightness.
 *
 * Solving against it makes the answer hold on every surface in the list, which
 * is what a focus ring needs: it is drawn on a control, in a dialogue, on a
 * menu and on the entry the keyboard is on, and those are four surfaces.
 */
export function hardestFor(colour: Oklch, surfaces: readonly Oklch[]): Oklch {
  return surfaces.reduce((hardest, one) =>
    contrastRatio(colour, one) < contrastRatio(colour, hardest) ? one : hardest,
  );
}

/** The contrast a pair of colours must reach. */
export const ContrastRequirement = {
  /** WCAG 2 AA for body text. */
  BodyText: 4.5,

  /** WCAG 2 AA for large text and for the boundary of a control. */
  LargeText: 3,

  /** WCAG 2 AAA for body text, which the high-contrast theme reaches. */
  Enhanced: 7,
} as const;

/** The contrast a pair of colours must reach. */
export type ContrastRequirement = (typeof ContrastRequirement)[keyof typeof ContrastRequirement];

/** Whether two colours meet a contrast requirement. */
export function meetsContrast(
  foreground: Oklch,
  background: Oklch,
  requirement: ContrastRequirement,
): boolean {
  return contrastRatio(foreground, background) >= requirement;
}

/**
 * Moves a colour's lightness by `delta`, keeping its hue and chroma.
 *
 * This is what a brightness control adjusts. Because lightness is perceptual, a
 * delta applied to every token of a palette shifts them all by the same
 * perceived amount, so the hierarchy between a surface and the surface above it
 * survives the adjustment (REQ-UX-070).
 */
export function shiftLightness(colour: Oklch, delta: number): Oklch {
  return { ...colour, lightness: clamp(colour.lightness + delta, 0, 1) };
}

/**
 * Raises or lowers a colour's chroma by a factor.
 *
 * A high-contrast theme lowers chroma, because a strongly coloured surface
 * makes text on it harder to read whatever its lightness.
 */
export function scaleChroma(colour: Oklch, factor: number): Oklch {
  return { ...colour, chroma: Math.max(0, colour.chroma * factor) };
}

/** A colour chosen to reach a contrast requirement, and whether it did. */
export interface ContrastSolution {
  readonly colour: Oklch;

  /** The ratio the colour reaches against the background. */
  readonly ratio: number;

  /** Whether the ratio meets the requirement. */
  readonly met: boolean;
}

/**
 * The nearest point on a lightness path from `from` towards `to` that meets a
 * requirement, if the far end meets it at all.
 *
 * Contrast rises monotonically along the path, because the path starts on one
 * side of the background and only moves away from it, which is what makes the
 * binary search valid.
 */
function nearestMeeting(
  colour: Oklch,
  background: Oklch,
  requirement: number,
  from: number,
  to: number,
): Oklch | undefined {
  const at = (fraction: number): Oklch => ({
    ...colour,
    lightness: from + (to - from) * fraction,
  });

  if (contrastRatio(at(1), background) < requirement) return undefined;

  // Twenty iterations resolve lightness to about one part in a million, far
  // finer than any display can show, and the loop is bounded so a colour that
  // cannot converge cannot hang the interface.
  let insufficient = 0;
  let sufficient = 1;
  for (let step = 0; step < 20; step += 1) {
    const middle = (insufficient + sufficient) / 2;
    if (contrastRatio(at(middle), background) >= requirement) {
      sufficient = middle;
    } else {
      insufficient = middle;
    }
  }
  return at(sufficient);
}

/**
 * Moves a colour's lightness until it reaches a contrast requirement.
 *
 * Returns the colour nearest the one given that meets the requirement against
 * `background`, moving only lightness. It tries first on the colour's own side
 * of the background, moving away from it; if even the extreme on that side
 * cannot reach the requirement, it tries the other side, starting from the
 * background and moving away. Searching only the first side would return an
 * unreadable extreme for a mid-toned background that the other side could
 * satisfy, and say nothing about it.
 *
 * If neither side can reach the requirement, it returns whichever extreme
 * contrasts most, which is the best the display can do, and says that the
 * requirement was not met rather than leaving the caller to assume it was.
 *
 * This is what makes the contrast guarantee in REQ-UX-070 a property of the
 * palette rather than of the particular brightness setting somebody looked at.
 * A designed lightness that already passes is returned unchanged, so the
 * adjustment only bites where it is needed. The search runs over the rendered
 * colour, so a token pushed outside the sRGB gamut is judged by what the
 * display will actually show rather than by coordinates no monitor can produce.
 */
export function solveContrast(
  colour: Oklch,
  background: Oklch,
  requirement: number,
): ContrastSolution {
  const given = contrastRatio(colour, background);
  if (given >= requirement) return { colour, ratio: given, met: true };

  const ownSide = colour.lightness >= background.lightness ? 1 : 0;
  const otherSide = 1 - ownSide;

  const found =
    nearestMeeting(colour, background, requirement, colour.lightness, ownSide) ??
    nearestMeeting(colour, background, requirement, background.lightness, otherSide);
  if (found !== undefined) {
    return { colour: found, ratio: contrastRatio(found, background), met: true };
  }

  const own: Oklch = { ...colour, lightness: ownSide };
  const other: Oklch = { ...colour, lightness: otherSide };
  const ownRatio = contrastRatio(own, background);
  const otherRatio = contrastRatio(other, background);
  return ownRatio >= otherRatio
    ? { colour: own, ratio: ownRatio, met: false }
    : { colour: other, ratio: otherRatio, met: false };
}

/** A token that could not reach its contrast requirement. */
export interface ContrastShortfall {
  /** The token, as the palette names it. */
  readonly token: string;

  readonly ratio: number;
  readonly required: number;
}

/**
 * Solves the tokens of one palette, remembering any that fell short.
 *
 * The palettes AudioGubbins ships meet every requirement at every brightness,
 * which the theme tests assert. A custom theme, which REQ-UX-070 says the
 * engine must permit, need not, and a palette that quietly contains an
 * unreadable token is the failure this exists to name.
 */
export function contrastSolver(): {
  readonly solve: (token: string, colour: Oklch, background: Oklch, requirement: number) => Oklch;
  readonly shortfalls: () => readonly ContrastShortfall[];
} {
  const shortfalls: ContrastShortfall[] = [];
  return {
    solve: (token, colour, background, requirement) => {
      const solution = solveContrast(colour, background, requirement);
      if (!solution.met) shortfalls.push({ token, ratio: solution.ratio, required: requirement });
      return solution.colour;
    },
    shortfalls: () => shortfalls,
  };
}

/** Builds a colour, normalising the hue into 0 to 360. */
export function oklch(lightness: number, chroma: number, hue: number, alpha?: number): Oklch {
  return {
    lightness: clamp(lightness, 0, 1),
    chroma: Math.max(0, chroma),
    hue: ((hue % 360) + 360) % 360,
    ...(alpha === undefined ? {} : { alpha: clamp(alpha, 0, 1) }),
  };
}
