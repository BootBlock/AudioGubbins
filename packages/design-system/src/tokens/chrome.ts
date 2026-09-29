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

import {
  ContrastRequirement,
  contrastSolver,
  hardestFor,
  oklch,
  scaleChroma,
  type Oklch,
} from './colour.js';
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

  readonly statusError: Oklch;
  readonly statusWarning: Oklch;
  readonly statusSuccess: Oklch;
  readonly statusInfo: Oklch;

  /**
   * The veil behind a modal dialogue, dimming what it blocks.
   *
   * A token rather than a literal in the stylesheet, so a theme decides it:
   * high contrast darkens it, because a dialogue that is harder to tell from
   * the page behind it is harder to read.
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

/** Surface hue and chroma. A faint tint; neutral grey reads as dead. */
const SURFACE_HUE = { dark: 255, light: 250 } as const;
const SURFACE_CHROMA = { dark: 0.012, light: 0.006 } as const;

/**
 * The contrast each token class must reach, by contrast level.
 *
 * `statusText` is its own class because a status colour is written as small
 * text: it names a state in the status bar and it also draws whole paragraphs
 * of `--ag-text-small` in the settings. Solved as an accent, it would be
 * guaranteed only the 3 to 1 of something large or drawn, where WCAG 1.4.3 asks
 * 4.5 to 1 of text this size. It stays at 4.5 in high contrast rather than
 * rising to 7: measured over every accent and brightness step, the solver
 * reaches about 6.9 at best for these hues, and a status colour that has lost
 * its hue no longer says which state it is.
 */
const REQUIREMENTS = {
  [ContrastLevel.Standard]: {
    primaryText: ContrastRequirement.BodyText,
    secondaryText: ContrastRequirement.BodyText,
    statusText: ContrastRequirement.BodyText,
    accent: ContrastRequirement.LargeText,
    strongBorder: ContrastRequirement.LargeText,
  },
  [ContrastLevel.High]: {
    primaryText: ContrastRequirement.Enhanced,
    secondaryText: ContrastRequirement.Enhanced,
    statusText: ContrastRequirement.BodyText,
    accent: ContrastRequirement.BodyText,
    strongBorder: ContrastRequirement.BodyText,
  },
} as const;

/**
 * The contrast body text and supporting text must reach at `level`, which text
 * holds wherever it is written: on the chrome, and on the editing palettes' own
 * surfaces.
 */
export function textRequirements(level: ContrastLevel): {
  readonly primary: number;
  readonly secondary: number;
} {
  const requirement = REQUIREMENTS[level];
  return { primary: requirement.primaryText, secondary: requirement.secondaryText };
}

/** How much high-contrast mode reduces colour, which impedes reading. */
const HIGH_CONTRAST_CHROMA_FACTOR = 0.6;

/** Maps brightness in -1 to 1 onto a position in 0 to 1. */
function positionInBand(brightness: number): number {
  return (brightness + 1) / 2;
}

/** How opaque the dialogue scrim is, by contrast level. */
const SCRIM_ALPHA = { [ContrastLevel.Standard]: 0.5, [ContrastLevel.High]: 0.7 } as const;

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
  const ensureContrast = (token: string, colour: Oklch, background: Oklch, requirement: number) =>
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

  const accentHue = ACCENT_HUES[options.accent];
  const accentChroma = high ? 0.12 : 0.17;

  // The accent must stay visible as a focus ring against every surface a
  // focused or highlighted thing sits on, so it is solved against whichever of
  // them it is nearest rather than against the raised one alone: a menu, a
  // select list and the palette draw on the overlay surface; the entry the
  // keyboard is on draws on the hover surface; and a control being pressed
  // draws on the active surface, which in both themes is the furthest from the
  // raised one and the hardest for the ring. Computing its lightness here is
  // what keeps the ring visible at the light end of the brightness range,
  // where a designed accent would be swallowed by the surface.
  const accentSeed = oklch(options.dark ? 0.7 : 0.52, accentChroma, accentHue);
  const accent = ensureContrast(
    'accent',
    accentSeed,
    hardestFor(accentSeed, everySurface),
    requirement.accent,
  );

  // Hover and active move away from and towards the surface respectively, so
  // the three states stay distinguishable whichever direction the accent had to
  // move to meet its contrast.
  const accentStep = options.dark ? 0.06 : -0.06;
  const accentHover = ensureContrast(
    'accentHover',
    oklch(accent.lightness + accentStep, accentChroma, accentHue),
    surfaceRaised,
    requirement.accent,
  );
  const accentActive = ensureContrast(
    'accentActive',
    oklch(accent.lightness - accentStep, accentChroma, accentHue),
    surfaceRaised,
    requirement.accent,
  );

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
   * cannot run are all `--ag-text-small` in a status colour. WCAG 1.4.3 asks
   * 4.5 to 1 of small text, and the 3 to 1 an accent is solved against is the
   * ratio for something large or for a thing drawn rather than written.
   */
  const status = (token: string, statusHue: number): Oklch => {
    const seed = oklch(options.dark ? 0.72 : 0.5, high ? 0.14 : 0.19, statusHue);
    return ensureContrast(token, seed, hardestFor(seed, everySurface), requirement.statusText);
  };

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

    // Text on the accent is chosen against the accent's own lightness, because
    // a light accent in a dark theme still needs dark text on it.
    textOnAccent: ensureContrast(
      'textOnAccent',
      accent.lightness > 0.6 ? oklch(0.12, 0.01, accentHue) : oklch(0.99, 0, 0),
      accent,
      ContrastRequirement.LargeText,
    ),

    accent,
    accentHover,
    accentActive,
    accentSubtle: scaleChroma(
      oklch(base + (options.dark ? 0.12 : -0.03), 0.06, accentHue),
      high ? HIGH_CONTRAST_CHROMA_FACTOR : 1,
    ),

    statusError: status('statusError', 25),
    statusWarning: status('statusWarning', 75),
    statusSuccess: status('statusSuccess', 150),
    statusInfo: status('statusInfo', 230),

    scrim: oklch(0, 0, 0, SCRIM_ALPHA[options.contrast]),
    shadow: oklch(0, 0, 0, options.dark ? 0.35 : 0.2),
  };
}
