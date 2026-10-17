/**
 * The contrast each class of chrome token must reach, by contrast level
 * (ADR-0012). One table, read by the chrome and by the accent family built
 * beside it, so the two cannot hold one class to two ratios.
 */

import { ContrastRequirement } from './colour.js';
import { ContrastLevel } from './preferences.js';

/**
 * The contrast each token class must reach, by contrast level.
 *
 * `statusText` is its own class because a status colour is written as small
 * text: it names a state in the status bar and it also draws whole paragraphs
 * of `--ag-text-label` in the settings. Solved as an accent, it would be
 * guaranteed only the 3 to 1 of something large or drawn, where WCAG 1.4.3 asks
 * 4.5 to 1 of text this size. It stays at 4.5 in high contrast rather than
 * rising to 7: measured over every accent and brightness step, the solver
 * reaches about 6.9 at best for these hues, and a status colour that has lost
 * its hue no longer says which state it is.
 *
 * `accentText` is the accent written as small text, held to 4.5 for the same
 * reason and at both levels for the same measurement: asked for 7 in high
 * contrast, the accents reach between 6.2 and 6.9, and text in the accent's
 * hue that has lost the hue is no longer the accent.
 */
export const REQUIREMENTS = {
  [ContrastLevel.Standard]: {
    primaryText: ContrastRequirement.BodyText,
    secondaryText: ContrastRequirement.BodyText,
    statusText: ContrastRequirement.BodyText,
    accentText: ContrastRequirement.BodyText,
    accent: ContrastRequirement.LargeText,
    strongBorder: ContrastRequirement.LargeText,
  },
  [ContrastLevel.High]: {
    primaryText: ContrastRequirement.Enhanced,
    secondaryText: ContrastRequirement.Enhanced,
    statusText: ContrastRequirement.BodyText,
    accentText: ContrastRequirement.BodyText,
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
