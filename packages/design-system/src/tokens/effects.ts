/**
 * The design language's composite values: the gradients, glows, shadows and
 * frosted backdrops that are made of several colours and lengths (design
 * language, sections 5 to 7, 9, 10 and 12).
 *
 * Each is written from the palette's own colours, so no colour in them is a
 * literal and a theme, accent, brightness or contrast change reaches them as it
 * reaches every token (ADR-0012). White and black are the light falling on a
 * surface and the shadow under it, which are not the theme's to choose.
 *
 * A value that has to be both a background and a shadow, as a chosen segment
 * and a swatch are, is two tokens, because CSS draws the two with two
 * properties and one custom property can fill only one of them.
 */

import { categoryColour, type CategoryOptions } from './category.js';
import type { ChromePalette } from './chrome.js';
import { oklchToCss, mix, oklch, withAlpha, type Oklch } from './colour.js';
import type { Palette } from './palette.js';

/** The values of the `effect` group, by token. */
export type EffectValues = Readonly<Record<string, string>>;

/** Every composite value a theme emits, by the group it is emitted in. */
export interface Effects {
  readonly effect: EffectValues;
  readonly elevation: EffectValues;
  readonly focus: EffectValues;
  readonly hardware: EffectValues;
}

/** A swatch's glass bead: its layered fill and its edges and shadow. */
export interface Swatch {
  readonly fill: string;
  readonly edge: string;
}

const css = oklchToCss;
const white = (alpha: number): string => css(oklch(1, 0, 0, alpha));
const black = (alpha: number): string => css(oklch(0, 0, 0, alpha));
const at = (colour: Oklch, alpha: number): string => css(withAlpha(colour, alpha));

/** How much of the error colour the destructive action's second stop keeps, the rest being rose. */
const DANGER_PARTNER_SHARE = 0.75;

/**
 * The frosted glass behind a level: its blur and how much it lifts the colour
 * through it. Lengths and factors, the same in every theme.
 */
const BACKDROPS = {
  panelBackdrop: 'blur(20px) saturate(1.3)',
  overlayBackdrop: 'blur(28px) saturate(1.6)',
  scrimBackdrop: 'blur(6px) saturate(0.9)',
} as const;

/**
 * A template token's wash, as one shadow so neither the token's padding nor
 * its weight changes and the caret keeps its place: the spread draws the wash
 * past the text, and an inset spread wider than any token fills under it.
 */
function tokenWash(accent: Oklch): string {
  const wash = at(accent, 0.14);
  return `0 0 0 2px ${wash}, inset 0 0 0 100vmax ${wash}`;
}

/**
 * The call to action, the destructive action, the transport readout's glow and
 * the backdrop: the values lit by the accent, and by the rose its partner and
 * the backdrop's lower glow share.
 */
function actionValues(chrome: ChromePalette, rose: Oklch): EffectValues {
  const { accent } = chrome;
  const danger = mix(chrome.statusError, rose, DANGER_PARTNER_SHARE);
  const sunken = css(chrome.surfaceSunken);
  return {
    readoutGlow: `0 0 18px ${at(accent, 0.5)}`,
    ctaFill:
      `linear-gradient(135deg, ${at(chrome.accentHover, 0.88)}, ` +
      `${at(chrome.accentPartner, 0.82)})`,
    dangerFill: `linear-gradient(135deg, ${at(chrome.statusError, 0.88)}, ${at(danger, 0.8)})`,
    ctaGloss: `linear-gradient(180deg, ${white(0.26)}, ${white(0.06)} 50%, ${white(0)} 51%)`,
    ctaEdge: `inset 0 1px 0 ${white(0.6)}, inset 0 -1px 0 ${black(0.18)}`,
    glowCta: `0 0 18px -6px ${css(accent)}`,
    backdrop:
      `radial-gradient(70% 60% at 20% 0%, ${at(accent, 0.45)}, ${at(accent, 0)} 70%), ` +
      `radial-gradient(60% 70% at 100% 100%, ${at(rose, 0.35)}, ${at(rose, 0)} 70%), ` +
      `linear-gradient(${sunken}, ${sunken})`,
  };
}

/** The marks of what is chosen: a row's lit edge, a card's glow, a segment's wash. */
function selectionValues(accent: Oklch): EffectValues {
  return {
    litWash: `linear-gradient(90deg, ${at(accent, 0.2)}, ${at(accent, 0.06)})`,
    litEdge:
      `linear-gradient(90deg, ${css(accent)}, ${at(accent, 0.35)} 40%, ` + `${at(accent, 0.08)})`,
    litGlow: `0 0 16px -8px ${css(accent)}`,
    glow: `0 0 0 1px ${at(accent, 0.55)}, 0 0 24px ${at(accent, 0.7)}`,
    segmentWash: `linear-gradient(180deg, ${at(accent, 0.26)}, ${at(accent, 0.14)})`,
    segmentEdge: `inset 0 0 0 1px ${at(accent, 0.4)}, inset 0 1px 0 ${white(0.12)}`,
  };
}

/**
 * How much of the sunken surface a progress bar's track keeps, the rest being
 * black: a pale panel needs less shade for the track to read as recessed.
 */
const PROGRESS_TRACK_SHARE = { dark: 0.75, light: 0.9 } as const;

/** A skeleton line, the progress bar's track and sheen, and a template token's wash. */
function stateValues(chrome: ChromePalette, dark: boolean): EffectValues {
  const text = chrome.textPrimary;
  const trackShare = dark ? PROGRESS_TRACK_SHARE.dark : PROGRESS_TRACK_SHARE.light;
  return {
    skeleton: `linear-gradient(90deg, ${at(text, 0.06)}, ${at(text, 0.12)}, ${at(text, 0.06)})`,
    progressTrack: css(mix(chrome.surfaceSunken, oklch(0, 0, 0), trackShare)),
    progressSheen:
      `linear-gradient(90deg, ${white(0)} 60%, ${white(0.45)} 80%, ` + `${white(0)} 95%)`,
    tokenWash: tokenWash(chrome.accent),
  };
}

/**
 * Each level's shadow: one geometry in both themes, softer in the light theme
 * by the shadow token's colour rather than by a second geometry.
 */
function elevationValues(chrome: ChromePalette): EffectValues {
  const shadow = css(chrome.shadow);
  return {
    ...BACKDROPS,
    panelShadow: `inset 0 1px 0 ${white(0.07)}, 0 12px 32px -12px ${shadow}`,
    overlayShadow:
      `inset 0 1px 0 ${white(0.08)}, 0 24px 60px -16px ${shadow}, ` + `0 4px 14px -6px ${shadow}`,
    tooltipShadow: `0 8px 22px -8px ${shadow}`,
    floatingShadow: `inset 0 1px 0 ${white(0.08)}, 0 30px 70px -18px ${shadow}`,
    noteShadow: `0 10px 24px -10px ${shadow}`,
    dragShadow: `0 14px 30px -8px ${shadow}`,
  };
}

/**
 * The hardware controls' shadows, deeper in the light theme by their
 * geometry: a control on a pale panel casts a wider, softer shadow (design
 * language, section 10).
 */
function hardwareValues(dark: boolean): EffectValues {
  return dark
    ? {
        dropShadow: `0 1.5px 1.5px ${black(0.45)}`,
        deepShadow: `0 3px 2px ${black(0.5)}, 0 8px 10px ${black(0.35)}`,
        recordShadow: `0 2px 2px ${black(0.45)}`,
      }
    : {
        dropShadow: `0 1.5px 2px ${black(0.35)}`,
        deepShadow: `0 3px 2px ${black(0.35)}, 0 8px 12px ${black(0.35)}`,
        recordShadow: `0 2px 3px ${black(0.3)}`,
      };
}

/**
 * Builds every composite value from a palette, in the theme, brightness and
 * contrast it was built for.
 */
export function buildEffects(palette: Palette, options: CategoryOptions): Effects {
  const { chrome } = palette;
  const focus = chrome.borderFocus;
  return {
    effect: {
      ...actionValues(chrome, categoryColour('rose', options)),
      ...selectionValues(chrome.accent),
      ...stateValues(chrome, options.dark),
    },
    elevation: elevationValues(chrome),
    focus: { halo: `0 0 0 6px ${at(focus, 0.22)}, 0 0 18px -2px ${at(focus, 0.55)}` },
    hardware: hardwareValues(options.dark),
  };
}

/**
 * An accent's swatch: a glass bead of its colour, with a soft specular
 * highlight, a light pooled at its foot, a body from the accent's hover to the
 * accent to the accent darkened, an inset edge, a lower shade and a shadow of
 * its own colour. Built from the chrome of the accent it shows, which is not
 * the theme's own accent for every swatch but one.
 */
export function buildSwatch(chrome: ChromePalette): Swatch {
  const { accent, accentHover } = chrome;
  const pooled = mix(accentHover, oklch(1, 0, 0), 0.92);
  return {
    fill:
      `radial-gradient(circle at 34% 28%, ${white(0.34)}, ${white(0)} 34%), ` +
      `radial-gradient(circle at 50% 120%, ${css(pooled)}, ${at(pooled, 0)} 50%), ` +
      `linear-gradient(160deg, ${css(accentHover)}, ${css(accent)} 55%, ` +
      `${css(mix(accent, oklch(0, 0, 0), 0.75))})`,
    edge:
      `inset 0 0 0 1px ${white(0.22)}, inset 0 -3px 6px ${black(0.28)}, ` +
      `0 3px 10px -2px ${at(accent, 0.6)}`,
  };
}
