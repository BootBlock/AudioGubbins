/**
 * Building the application chrome palette.
 *
 * REQ-UX-070 requires theme brightness to keep contrast, accessibility,
 * readability and component hierarchy correct across the whole user-selectable
 * range. A uniform lightness offset applied to a designed palette would not: at
 * the ends of the range the surfaces would flatten against black or white, the
 * hierarchy between them would disappear, and the accent would lose its
 * contrast against the surface behind it. The contrast tests would find exactly
 * that.
 *
 * So brightness does not move the tokens. It moves one number, the base surface
 * lightness, within a band chosen so that every derived token stays in range.
 * The surfaces are then offsets from that base, which keeps their order by
 * construction, and the text, borders and accent are *computed* to reach their
 * contrast requirements against the surfaces that result.
 *
 * That is what "semantic colour and luminance tokens" means here: the palette
 * states the relationship it must preserve, and derives the numbers that
 * preserve it, rather than stating numbers and hoping the relationship
 * survives.
 */

import { buildAccent, type EnsureContrast } from './accent.js';
import { contrastSolver, hardestFor, oklch, scaleChroma, withAlpha, type Oklch } from './colour.js';
import { REQUIREMENTS } from './contrast-requirements.js';
import { ACCENT_HUES, ContrastLevel, type AccentName } from './preferences.js';

/** Colours the application chrome uses. */
export type ChromePalette = {
  /** The window background, behind every panel. */
  readonly surfaceBase: Oklch;

  /** A panel sitting on the base. */
  readonly surfaceRaised: Oklch;

  /** A menu, dialogue or popover floating above everything. */
  readonly surfaceOverlay: Oklch;

  /** A well: a track header, a list, an inset field. */
  readonly surfaceSunken: Oklch;

  /** A hovered interactive surface. */
  readonly surfaceHover: Oklch;

  /** A pressed or selected interactive surface. */
  readonly surfaceActive: Oklch;

  /** A separator that should barely register. */
  readonly borderSubtle: Oklch;

  /** The ordinary boundary of a control. */
  readonly borderDefault: Oklch;

  /** A boundary that needs to be seen, such as a focused field. */
  readonly borderStrong: Oklch;

  /** The focus ring. Always the accent, so focus is unmistakable. */
  readonly borderFocus: Oklch;

  /** Body text. */
  readonly textPrimary: Oklch;

  /** Supporting text: a unit, a hint, a secondary label. */
  readonly textSecondary: Oklch;

  /** Text on a control that cannot be used. */
  readonly textDisabled: Oklch;

  /** Text drawn on the accent colour. */
  readonly textOnAccent: Oklch;

  /** The accent, used for focus, selection and the primary action. */
  readonly accent: Oklch;

  /** The accent under the pointer. */
  readonly accentHover: Oklch;

  /** The accent while pressed. */
  readonly accentActive: Oklch;

  /** A tinted surface carrying the accent without shouting. */
  readonly accentSubtle: Oklch;

  /**
   * The accent written as small text: a tag, an accent badge, a template
   * token, a palette match. The accent itself is solved to the 3 to 1 of
   * something large or drawn, and small text is held to 4.5 to 1.
   */
  readonly accentText: Oklch;

  /** The call to action's second hue: the accent mixed with the backdrop's rose. */
  readonly accentPartner: Oklch;

  /** A resting secondary button, select, badge or key cap: text at a high translucency. */
  readonly fillQuiet: Oklch;

  /** A fill under the pointer. */
  readonly fillHover: Oklch;

  /** A pressed fill, a chosen plain segment. */
  readonly fillPress: Oklch;

  /** A well: a field, a segmented control, a readout, a tree. */
  readonly fillWell: Oklch;

  /** A toggled icon button, a selected item's base. */
  readonly fillAccent: Oklch;

  /** A glass edge. */
  readonly edgeQuiet: Oklch;

  /** The edge of an accent fill. */
  readonly edgeAccent: Oklch;

  readonly statusError: Oklch;
  readonly statusWarning: Oklch;
  readonly statusSuccess: Oklch;
  readonly statusInfo: Oklch;

  /**
   * The record lamp, the recording status item, a shortcut being recorded.
   * Its own token rather than the meter's clip colour it starts from, so the
   * two can differ.
   */
  readonly statusRecording: Oklch;

  /**
   * The veil behind a modal dialogue, dimming what it blocks.
   *
   * The sunken surface at a translucency, so it is frosted in the theme's own
   * colour rather than blacked out. A theme decides it: high contrast makes it
   * more opaque, because a dialogue that is harder to tell from the page behind
   * it is harder to read.
   */
  readonly scrim: Oklch;

  /** The shadow under a floating notice, which lifts it off the page. */
  readonly shadow: Oklch;
};

/** How a chrome palette is built. */
export interface ChromeOptions {
  readonly dark: boolean;
  readonly accent: AccentName;

  /** Perceptual lightness offset from -1 to 1, where 0 is as designed. */
  readonly brightness: number;

  readonly contrast: ContrastLevel;
}

/**
 * The band the base surface moves through, and the offsets of the others.
 *
 * The band ends are chosen so that `lowest + minimumOffset` and
 * `highest + maximumOffset` both stay inside 0 to 1. Nothing clamps, and no two
 * surfaces share an offset, so no two surfaces can collapse onto the same
 * lightness. Were the light theme's raised and overlay surfaces to share one, a
 * menu would be indistinguishable in lightness from the panel under it; its
 * band stops low enough that the overlay has room above the raised surface.
 */
const SURFACES = {
  dark: {
    band: { darkest: 0.1, lightest: 0.27 },
    offsets: {
      surfaceSunken: -0.045,
      surfaceBase: 0,
      surfaceRaised: 0.05,
      surfaceOverlay: 0.1,
      surfaceHover: 0.115,
      surfaceActive: 0.17,
      borderSubtle: 0.13,
      borderDefault: 0.23,
      borderStrong: 0.4,
    },
  },
  light: {
    band: { darkest: 0.88, lightest: 0.965 },
    offsets: {
      surfaceSunken: -0.045,
      surfaceBase: 0,
      surfaceRaised: 0.015,
      surfaceOverlay: 0.035,
      surfaceHover: -0.03,
      surfaceActive: -0.08,
      borderSubtle: -0.07,
      borderDefault: -0.15,
      borderStrong: -0.35,
    },
  },
} as const;

/**
 * Surface hue and chroma. A faint tint; neutral grey reads as dead. The hue is
 * the hardware materials' too, so metal sits in the same light as the panels.
 */
export const SURFACE_HUE = { dark: 255, light: 250 } as const;
const SURFACE_CHROMA = { dark: 0.012, light: 0.006 } as const;

/** How much high-contrast mode reduces colour, which impedes reading. */
const HIGH_CONTRAST_CHROMA_FACTOR = 0.6;

/** Maps brightness in -1 to 1 onto a position in 0 to 1. */
function positionInBand(brightness: number): number {
  return (brightness + 1) / 2;
}

/** How opaque the dialogue scrim is, by contrast level. */
const SCRIM_ALPHA = { [ContrastLevel.Standard]: 0.55, [ContrastLevel.High]: 0.7 } as const;

/**
 * The translucencies of the fills and edges, by theme (design language,
 * section 5). A fill takes up the backdrop behind it, so it is a token colour
 * at a high translucency rather than a solid colour.
 */
const TRANSLUCENCY = {
  dark: {
    quiet: 0.07,
    hover: 0.11,
    press: 0.15,
    well: 0.55,
    accent: 0.2,
    edge: 0.13,
    accentEdge: 0.42,
  },
  light: {
    quiet: 0.06,
    hover: 0.09,
    press: 0.15,
    well: 0.45,
    accent: 0.16,
    edge: 0.13,
    accentEdge: 0.42,
  },
} as const;

/** The hue of the recording state: the meter's clip red. */
export const RECORDING_HUE = 25;

/** The fills and edges, each a token colour at the theme's translucency for it. */
function translucentFills(
  textPrimary: Oklch,
  accent: Oklch,
  surfaceSunken: Oklch,
  dark: boolean,
): Pick<
  ChromePalette,
  'fillQuiet' | 'fillHover' | 'fillPress' | 'fillWell' | 'fillAccent' | 'edgeQuiet' | 'edgeAccent'
> {
  const translucency = dark ? TRANSLUCENCY.dark : TRANSLUCENCY.light;
  return {
    fillQuiet: withAlpha(textPrimary, translucency.quiet),
    fillHover: withAlpha(textPrimary, translucency.hover),
    fillPress: withAlpha(textPrimary, translucency.press),
    // A well is recessed: the sunken surface in the dark theme, and white in
    // the light theme, where a well is lighter than the panel it is cut into.
    fillWell: withAlpha(dark ? surfaceSunken : oklch(1, 0, 0), translucency.well),
    fillAccent: withAlpha(accent, translucency.accent),
    edgeQuiet: withAlpha(textPrimary, translucency.edge),
    edgeAccent: withAlpha(accent, translucency.accentEdge),
  };
}

/**
 * Builds the chrome palette.
 *
 * `solver` is where a token that cannot reach its contrast requirement is
 * recorded, so the palette that holds it can say so. The palette builder passes
 * its own; a caller building the chrome alone gets a fresh one.
 */
export function buildChrome(
  options: ChromeOptions,
  solver: ReturnType<typeof contrastSolver> = contrastSolver(),
): ChromePalette {
  const ensureContrast: EnsureContrast = (token, colour, background, requirement) =>
    solver.solve(token, colour, background, requirement);
  const scheme = options.dark ? SURFACES.dark : SURFACES.light;
  const hue = options.dark ? SURFACE_HUE.dark : SURFACE_HUE.light;
  const chroma = options.dark ? SURFACE_CHROMA.dark : SURFACE_CHROMA.light;
  const requirement = REQUIREMENTS[options.contrast];
  const high = options.contrast === ContrastLevel.High;

  const base =
    scheme.band.darkest +
    (scheme.band.lightest - scheme.band.darkest) * positionInBand(options.brightness);

  const surface = (token: keyof typeof scheme.offsets): Oklch =>
    oklch(base + scheme.offsets[token], high ? chroma * HIGH_CONTRAST_CHROMA_FACTOR : chroma, hue);

  const surfaceBase = surface('surfaceBase');
  const surfaceSunken = surface('surfaceSunken');
  const surfaceRaised = surface('surfaceRaised');
  const surfaceOverlay = surface('surfaceOverlay');
  const surfaceHover = surface('surfaceHover');
  const surfaceActive = surface('surfaceActive');

  const everySurface = [
    surfaceBase,
    surfaceRaised,
    surfaceOverlay,
    surfaceSunken,
    surfaceHover,
    surfaceActive,
  ];

  // Text and the status colours are readable on every surface, so each is
  // solved against the one it is hardest to see on. That question has one
  // answer, `hardestFor`, and a hand-picked constant beside it would give
  // another: naming `surfaceSunken` in the light theme, where `surfaceActive`
  // is the darker of the two by offset, would solve every piece of text against
  // the second-hardest surface.
  const primarySeed = oklch(options.dark ? 0.96 : 0.2, 0.006, hue);
  const textPrimary = ensureContrast(
    'textPrimary',
    primarySeed,
    hardestFor(primarySeed, everySurface),
    requirement.primaryText,
  );

  const secondarySeed = oklch(options.dark ? 0.78 : 0.42, 0.01, hue);
  const textSecondary = ensureContrast(
    'textSecondary',
    secondarySeed,
    hardestFor(secondarySeed, everySurface),
    requirement.secondaryText,
  );

  // Disabled text is deliberately below the contrast threshold: that reduced
  // contrast is what communicates "not available", and WCAG 2 exempts a
  // disabled control from the requirement. It still has to be legible enough to
  // read, so it sits at a fixed distance from the surface rather than at
  // whatever the brightness leaves.
  const textDisabled = oklch(base + (options.dark ? 0.3 : -0.28), 0.006, hue);

  const { accent, accentHover, accentActive, accentText, accentPartner, textOnAccent } =
    buildAccent(options, { everySurface, surfaceRaised }, ensureContrast);
  const accentHue = ACCENT_HUES[options.accent];

  const borderStrong = ensureContrast(
    'borderStrong',
    surface('borderStrong'),
    surfaceRaised,
    requirement.strongBorder,
  );

  /**
   * A status colour, given its hue, kept readable on the surfaces it sits on.
   *
   * Held to what body text is held to, not to what an accent is. A status
   * colour names a state in a word in the status bar, and it also draws whole
   * paragraphs of small text: the reserved-shortcut notes, the notes about
   * what is waiting, the recorder's refusal and the reason under a button that
   * cannot run are all `--ag-text-label` in a status colour. WCAG 1.4.3 asks
   * 4.5 to 1 of small text, and the 3 to 1 an accent is solved against is the
   * ratio for something large or for a thing drawn rather than written.
   */
  const status = (token: string, statusHue: number): Oklch => {
    const seed = oklch(options.dark ? 0.72 : 0.5, high ? 0.14 : 0.19, statusHue);
    return ensureContrast(token, seed, hardestFor(seed, everySurface), requirement.statusText);
  };

  // A lamp and an LED rather than words: the recording item's text is the
  // primary text over a wash of this, so it is held to what a drawn thing is,
  // as the accent is, from the meter's clip lightness.
  const recordingSeed = oklch(0.65, high ? 0.14 : 0.23, RECORDING_HUE);
  const statusRecording = ensureContrast(
    'statusRecording',
    recordingSeed,
    hardestFor(recordingSeed, everySurface),
    requirement.accent,
  );

  return {
    surfaceBase,
    surfaceRaised,
    surfaceOverlay,
    surfaceSunken,
    surfaceHover,
    surfaceActive,

    borderSubtle: surface('borderSubtle'),
    borderDefault: surface('borderDefault'),
    borderStrong,
    borderFocus: accent,

    textPrimary,
    textSecondary,
    textDisabled,

    textOnAccent,

    accent,
    accentHover,
    accentActive,
    accentSubtle: scaleChroma(
      oklch(base + (options.dark ? 0.12 : -0.03), 0.06, accentHue),
      high ? HIGH_CONTRAST_CHROMA_FACTOR : 1,
    ),
    accentText,
    accentPartner,

    ...translucentFills(textPrimary, accent, surfaceSunken, options.dark),

    statusError: status('statusError', 25),
    statusWarning: status('statusWarning', 75),
    statusSuccess: status('statusSuccess', 150),
    statusInfo: status('statusInfo', 230),
    statusRecording,

    scrim: withAlpha(surfaceSunken, SCRIM_ALPHA[options.contrast]),
    shadow: oklch(0, 0, 0, options.dark ? 0.35 : 0.2),
  };
}
