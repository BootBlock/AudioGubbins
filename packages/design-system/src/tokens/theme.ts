/**
 * Turning preferences into a theme, and a theme into CSS custom properties.
 *
 * REQ-UX-155 makes CSS custom properties the runtime theme contract and
 * requires that a runtime theme change must not need stylesheets rebuilt. Every
 * token is therefore emitted as a custom property on one element, and changing
 * the theme means writing a new set of values onto that element. Nothing is
 * compiled in, and no component holds a literal.
 *
 * That also satisfies the requirement to permit future custom themes without
 * component-specific overrides: a custom theme is another set of values for the
 * same property names.
 */

import { oklchToCss, type Oklch } from './colour.js';
import { buildPalette, type Palette } from './palette.js';
import { metricsFor, motionFor, type Metrics, type MotionScale } from './scale.js';
import {
  clampBrightness,
  resolveContrast,
  resolveDarkness,
  resolveMotion,
  type ContrastLevel,
  type Density,
  type MotionLevel,
  type SystemAppearance,
  type ThemePreferences,
} from './preferences.js';

/** A resolved theme: what the interface actually looks like right now. */
export interface Theme {
  /** Whether the resolved palette is the dark one. */
  readonly dark: boolean;

  readonly density: Density;
  readonly motionLevel: MotionLevel;
  readonly contrast: ContrastLevel;

  readonly palette: Palette;
  readonly metrics: Metrics;
  readonly motion: MotionScale;
}

/**
 * Resolves preferences and the system's own settings into one theme.
 *
 * Both are needed: `system` mode follows the operating system, and
 * `prefers-reduced-motion` applies unless the user has overridden it. Resolving
 * in one function is what stops two components from answering "is it dark?"
 * differently (REQ-EXEC-136.11).
 */
export function resolveTheme(preferences: ThemePreferences, system: SystemAppearance): Theme {
  const dark = resolveDarkness(preferences, system);
  const contrast = resolveContrast(preferences, system);
  const motionLevel = resolveMotion(preferences, system);

  return {
    dark,
    density: preferences.density,
    motionLevel,
    contrast,
    palette: buildPalette({
      dark,
      accent: preferences.accent,
      brightness: clampBrightness(preferences.brightness),
      contrast,
    }),
    metrics: metricsFor(preferences.density),
    motion: motionFor(motionLevel),
  };
}

/**
 * The prefix on every AudioGubbins custom property.
 *
 * Namespaced so that a token cannot collide with a property set by Dockview,
 * Radix or anything else that writes custom properties onto the same element.
 */
const PREFIX = '--ag';

/** Converts a camel-case token name to its kebab-case property suffix. */
function propertyName(group: string, token: string): string {
  return `${PREFIX}-${group}-${token.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
}

/** Emits one group of colour tokens. */
function emitColours(
  group: string,
  colours: Readonly<Record<string, Oklch>>,
  into: Record<string, string>,
): void {
  for (const [token, colour] of Object.entries(colours)) {
    into[propertyName(group, token)] = oklchToCss(colour);
  }
}

/** Emits one group of numeric tokens, in pixels. */
function emitPixels(
  group: string,
  values: Readonly<Record<string, number>>,
  into: Record<string, string>,
): void {
  for (const [token, value] of Object.entries(values)) {
    into[propertyName(group, token)] = `${String(value)}px`;
  }
}

/**
 * Every custom property a theme sets.
 *
 * This is the whole runtime contract between the design system and the
 * stylesheets. A component that reaches past it for a literal colour is the
 * thing REQ-UX-155 exists to prevent, and the architecture tests look for it.
 */
export function themeCustomProperties(theme: Theme): Readonly<Record<string, string>> {
  const properties: Record<string, string> = {};

  emitColours('chrome', theme.palette.chrome, properties);
  emitColours('waveform', theme.palette.waveform, properties);
  emitColours('selection', theme.palette.selection, properties);
  emitColours('meter', theme.palette.meter, properties);
  emitColours('category', theme.palette.category, properties);

  properties[`${PREFIX}-analysis-grid`] = oklchToCss(theme.palette.analysisGrid);

  // The spectrogram ramp is indexed rather than named: it is a continuous
  // scale, and a renderer interpolates between the stops.
  theme.palette.spectrogram.forEach((stop, index) => {
    properties[`${PREFIX}-spectrogram-${String(index)}`] = oklchToCss(stop);
  });
  properties[`${PREFIX}-spectrogram-stops`] = String(theme.palette.spectrogram.length);

  emitPixels('space', theme.metrics.space, properties);
  emitPixels('radius', theme.metrics.radius, properties);
  emitPixels('control', theme.metrics.control, properties);

  const { lineHeight, ...textSizes } = theme.metrics.text;
  emitPixels('text', textSizes, properties);
  properties[`${PREFIX}-text-line-height`] = String(lineHeight);

  const { easeIn, easeOut, easeInOut, ...durations } = theme.motion;
  for (const [token, value] of Object.entries(durations)) {
    properties[propertyName('motion', token)] = `${String(value)}ms`;
  }
  properties[`${PREFIX}-motion-ease-out`] = easeOut;
  properties[`${PREFIX}-motion-ease-in`] = easeIn;
  properties[`${PREFIX}-motion-ease-in-out`] = easeInOut;

  return properties;
}

/**
 * Attributes describing the theme, for stylesheets that need to branch.
 *
 * A stylesheet should nearly always read a token rather than branch on the
 * theme. These exist for the few cases where a rule genuinely differs rather
 * than merely taking a different value, such as a shadow that has no meaning on
 * a light surface.
 */
export function themeDataAttributes(theme: Theme): Readonly<Record<string, string>> {
  return {
    'data-ag-theme': theme.dark ? 'dark' : 'light',
    'data-ag-density': theme.density,
    'data-ag-motion': theme.motionLevel,
    'data-ag-contrast': theme.contrast,
  };
}

/**
 * Writes the theme onto an element.
 *
 * Takes the element rather than reaching for `document.documentElement`, so a
 * test can theme a fragment and a caller decides what is themed. The provider
 * calls it for its own root and for the document element, because a portalled
 * surface is a child of the document body and inherits nothing from the root.
 */
export function applyTheme(element: HTMLElement, theme: Theme): void {
  for (const [property, value] of Object.entries(themeCustomProperties(theme))) {
    element.style.setProperty(property, value);
  }
  for (const [attribute, value] of Object.entries(themeDataAttributes(theme))) {
    element.setAttribute(attribute, value);
  }
}
