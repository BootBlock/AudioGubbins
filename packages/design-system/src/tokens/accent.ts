/**
 * The accent and the colours that go with it: its hover and pressed states,
 * the accent written as small text, the call to action's second hue, and the
 * text drawn on all of them.
 *
 * The accent is the one chrome colour the user chooses, so its family is
 * solved here, against the surfaces the chrome hands it, by the contrast table
 * every chrome token is held to.
 */

import { categoryColour } from './category.js';
import { ContrastRequirement, hardestFor, mix, oklch, type Oklch } from './colour.js';
import { REQUIREMENTS } from './contrast-requirements.js';
import { ACCENT_HUES, ContrastLevel, type AccentName } from './preferences.js';

/** The accent's family of colours. */
export interface AccentFamily {
  readonly accent: Oklch;
  readonly accentHover: Oklch;
  readonly accentActive: Oklch;
  readonly accentText: Oklch;
  readonly accentPartner: Oklch;
  readonly textOnAccent: Oklch;
}

/** What the accent family is built for. */
export interface AccentOptions {
  readonly dark: boolean;
  readonly accent: AccentName;
  readonly brightness: number;
  readonly contrast: ContrastLevel;
}

/** The surfaces the accent is solved against. */
export interface AccentSurfaces {
  /** Every surface a focused or highlighted thing sits on. */
  readonly everySurface: readonly Oklch[];

  /** The panel a control sits on, which its hover and pressed states are read on. */
  readonly surfaceRaised: Oklch;
}

/** A token solver, which records any token that falls short of its requirement. */
export type EnsureContrast = (
  token: string,
  colour: Oklch,
  background: Oklch,
  requirement: number,
) => Oklch;

/** How much of the accent the call to action's second hue keeps, the rest being rose. */
const PARTNER_SHARE = 0.7;

/**
 * The colours that go with the accent: the accent written as small text, the
 * call to action's second hue, and the text drawn on all of them.
 */
function accentCompanions(
  states: Pick<AccentFamily, 'accent' | 'accentHover' | 'accentActive'>,
  everySurface: readonly Oklch[],
  options: AccentOptions,
  ensureContrast: EnsureContrast,
): Pick<AccentFamily, 'accentText' | 'accentPartner' | 'textOnAccent'> {
  const { accent, accentHover, accentActive } = states;
  const accentPartner = mix(accent, categoryColour('rose', options), PARTNER_SHARE);

  // Text on the accent is chosen against the accent's own lightness, because a
  // light accent in a dark theme still needs dark text on it, and solved
  // against whichever accent surface it is hardest to read on: the call to
  // action is a gradient from the accent's hover to its partner, and a pressed
  // one is the active accent.
  const onAccentSeed =
    accent.lightness > 0.6 ? oklch(0.12, 0.01, ACCENT_HUES[options.accent]) : oklch(0.99, 0, 0);

  return {
    // Small text in the accent's hue, readable on every surface it is on.
    accentText: ensureContrast(
      'accentText',
      accent,
      hardestFor(accent, everySurface),
      REQUIREMENTS[options.contrast].accentText,
    ),
    accentPartner,
    textOnAccent: ensureContrast(
      'textOnAccent',
      onAccentSeed,
      hardestFor(onAccentSeed, [accent, accentHover, accentActive, accentPartner]),
      ContrastRequirement.LargeText,
    ),
  };
}

/** Builds the accent's family against the chrome's surfaces. */
export function buildAccent(
  options: AccentOptions,
  surfaces: AccentSurfaces,
  ensureContrast: EnsureContrast,
): AccentFamily {
  const { everySurface, surfaceRaised } = surfaces;
  const accentHue = ACCENT_HUES[options.accent];
  const accentChroma = options.contrast === ContrastLevel.High ? 0.12 : 0.17;

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
    REQUIREMENTS[options.contrast].accent,
  );

  // Hover and active move away from and towards the surface respectively, so
  // the three states stay distinguishable whichever direction the accent had to
  // move to meet its contrast.
  const accentStep = options.dark ? 0.06 : -0.06;
  const accentHover = ensureContrast(
    'accentHover',
    oklch(accent.lightness + accentStep, accentChroma, accentHue),
    surfaceRaised,
    REQUIREMENTS[options.contrast].accent,
  );
  const accentActive = ensureContrast(
    'accentActive',
    oklch(accent.lightness - accentStep, accentChroma, accentHue),
    surfaceRaised,
    REQUIREMENTS[options.contrast].accent,
  );

  return {
    accent,
    accentHover,
    accentActive,
    ...accentCompanions(
      { accent, accentHover, accentActive },
      everySurface,
      options,
      ensureContrast,
    ),
  };
}
