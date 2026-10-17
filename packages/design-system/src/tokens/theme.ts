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

import { buildChrome } from './chrome.js';
import { oklchToCss, type Oklch } from './colour.js';
import { buildEffects, buildSwatch } from './effects.js';
import { buildPalette, type Palette } from './palette.js';
import { motionFor, type MotionScale } from './motion.js';
import { metricsFor, type Metrics } from './scale.js';
import { TYPEFACE, type Typeface } from './typeface.js';
import {
  ACCENT_NAMES,
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

  /** The brightness the palette was built at, within the range the control offers. */
  readonly brightness: number;

  readonly palette: Palette;
  readonly metrics: Metrics;
  readonly typeface: Typeface;
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
  const brightness = clampBrightness(preferences.brightness);

  return {
    dark,
    density: preferences.density,
    motionLevel,
    contrast,
    brightness,
    palette: buildPalette({ dark, accent: preferences.accent, brightness, contrast }),
    metrics: metricsFor(preferences.density),
    typeface: TYPEFACE,
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

/**
 * Emits a ramp of colours, indexed rather than named: a continuous scale or a
 * gradient's stops, which a renderer or an SVG gradient reads in order.
 */
function emitRamp(prefix: string, stops: readonly Oklch[], into: Record<string, string>): void {
  stops.forEach((stop, index) => {
    into[`${prefix}-${String(index)}`] = oklchToCss(stop);
  });
}

/** Emits one group of values written with a unit, or with none. */
function emitValues(
  group: string,
  values: Readonly<Record<string, number>>,
  unit: 'px' | 'ms' | 'em' | '',
  into: Record<string, string>,
): void {
  for (const [token, value] of Object.entries(values)) {
    into[propertyName(group, token)] = `${String(value)}${unit}`;
  }
}

/** Emits one group of values that are already CSS. */
function emitCss(
  group: string,
  values: Readonly<Record<string, string>>,
  into: Record<string, string>,
): void {
  for (const [token, value] of Object.entries(values)) {
    into[propertyName(group, token)] = value;
  }
}

/** Every colour token, and the composite values written from them. */
function emitPalette(theme: Theme, into: Record<string, string>): void {
  const { palette } = theme;
  emitColours('chrome', palette.chrome, into);
  emitColours('elevation', palette.elevation, into);
  emitColours('waveform', palette.waveform, into);
  emitColours('selection', palette.selection, into);
  emitColours('meter', palette.meter, into);
  emitColours('category', palette.category, into);
  emitColours('marker', palette.marker, into);
  emitColours('analysis', palette.analysis, into);
  emitColours('hardware', palette.hardware.materials, into);
  for (const [token, stops] of Object.entries(palette.hardware.ramps)) {
    emitRamp(propertyName('hardware', token), stops, into);
  }

  // The spectrogram ramp is a continuous scale, and a renderer interpolates
  // between the stops, so it says how many there are.
  emitRamp(`${PREFIX}-spectrogram`, palette.spectrogram, into);
  into[`${PREFIX}-spectrogram-stops`] = String(palette.spectrogram.length);

  const options = { dark: theme.dark, brightness: theme.brightness, contrast: theme.contrast };
  const effects = buildEffects(palette, options);
  emitCss('effect', effects.effect, into);
  emitCss('elevation', effects.elevation, into);
  emitCss('focus', effects.focus, into);
  emitCss('hardware', effects.hardware, into);

  // Every accent the settings offer is shown as its own swatch at once, so each
  // is built from the chrome of that accent in the theme's own light, rather
  // than from the theme's one accent.
  for (const accent of ACCENT_NAMES) {
    const swatch = buildSwatch(buildChrome({ ...options, accent }));
    into[`${PREFIX}-effect-swatch-${accent}`] = swatch.fill;
    into[`${PREFIX}-effect-swatch-${accent}-edge`] = swatch.edge;
  }
}

/** Every size, in pixels, and the icon stroke, in units of the icon's grid. */
function emitMetrics(metrics: Metrics, into: Record<string, string>): void {
  emitValues('grid', metrics.grid, 'px', into);
  emitValues('space', metrics.space, 'px', into);
  emitValues('radius', metrics.radius, 'px', into);
  emitValues('control', metrics.control, 'px', into);
  emitValues('text', metrics.text, 'px', into);
  const { stroke, ...iconSizes } = metrics.icon;
  emitValues('icon', iconSizes, 'px', into);
  into[`${PREFIX}-icon-stroke`] = String(stroke);
  emitValues('shell', metrics.shell, 'px', into);
  emitValues('status-bar', metrics.statusBar, 'px', into);
  emitValues('focus', metrics.focus, 'px', into);
  emitValues('hardware', metrics.hardware, 'px', into);
  emitValues('waveform', metrics.display, 'px', into);
  emitValues('state', metrics.state, 'px', into);
  emitValues('dialogue', metrics.dialogue, 'px', into);
}

/** The faces, and the parts of the type scale that are the same at every density. */
function emitTypeface(typeface: Typeface, into: Record<string, string>): void {
  emitCss('font', typeface.family, into);
  into[`${PREFIX}-text-numeric-ratio`] = String(typeface.numericRatio);
  emitValues('text-weight', typeface.weight, '', into);
  emitValues('text-line-height', typeface.lineHeight, '', into);
  emitValues('text-tracking', typeface.tracking, 'em', into);
}

/** Durations, easings, the loops, travel, entry scales and the meter's ballistics. */
function emitMotion(motion: MotionScale, into: Record<string, string>): void {
  const { instant, quick, moderate, deliberate } = motion;
  emitValues('motion', { instant, quick, moderate, deliberate }, 'ms', into);
  const { easeOut, easeIn, easeInOut, easeSpring } = motion;
  emitCss('motion', { easeOut, easeIn, easeInOut, easeSpring }, into);
  emitValues('motion-loop', motion.loop, 'ms', into);
  emitValues('motion-distance', motion.distance, 'px', into);
  emitValues('motion-scale', motion.scale, '', into);

  // A rate in decibels a second has no CSS unit, so it is a bare number; the
  // holds and the time constant are durations like every other.
  const { peakHold, clipHold, correlationTime, fallRate, peakFallRate } = motion.ballistics;
  emitValues('ballistics', { peakHold, clipHold, correlationTime }, 'ms', into);
  emitValues('ballistics', { fallRate, peakFallRate }, '', into);
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
  emitPalette(theme, properties);
  emitMetrics(theme.metrics, properties);
  emitTypeface(theme.typeface, properties);
  emitMotion(theme.motion, properties);
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
