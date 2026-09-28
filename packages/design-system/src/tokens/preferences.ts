/**
 * What the user has chosen about how AudioGubbins looks and moves.
 *
 * REQ-UX-070 requires dark as the default, plus light and system modes, accent
 * selection and a brightness control. REQ-UX-071 requires density preferences
 * rather than one compromise layout. REQ-UX-069 requires motion levels and
 * respect for the operating system's reduced-motion preference with an explicit
 * user override. REQ-UX-155 adds high-contrast overrides and touch-target
 * scaling.
 *
 * These are preferences, not project data. REQ-UX-059 keeps them clearly
 * separable so that a display choice can never corrupt a project, and they
 * carry their own schema version for the same reason.
 */

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

/** Which palette the interface uses. */
export const ThemeMode = {
  /** Always dark. The default (REQ-UX-070). */
  Dark: 'dark',

  /** Always light. */
  Light: 'light',

  /** Follow the operating system. */
  System: 'system',
} as const;

/** Which palette the interface uses. */
export type ThemeMode = (typeof ThemeMode)[keyof typeof ThemeMode];

/** How much room the interface gives itself. */
export const Density = {
  /** Larger controls and more space. Easier to hit, and easier to read. */
  Comfortable: 'comfortable',

  /** Tighter controls, so more of the project is on screen at once. */
  Compact: 'compact',
} as const;

/** How much room the interface gives itself. */
export type Density = (typeof Density)[keyof typeof Density];

/** How much the interface animates. */
export const MotionLevel = {
  /** The full intended experience (REQ-UX-069). */
  Full: 'full',

  /** Shorter, smaller movements. Transitions still show what moved where. */
  Reduced: 'reduced',

  /** No movement. State changes are instant. */
  Minimal: 'minimal',
} as const;

/** How much the interface animates. */
export type MotionLevel = (typeof MotionLevel)[keyof typeof MotionLevel];

/** How strongly the interface separates its surfaces and text. */
export const ContrastLevel = {
  /** The designed palette. */
  Standard: 'standard',

  /** Stronger separation, reaching WCAG 2 AAA for body text. */
  High: 'high',
} as const;

/** How strongly the interface separates its surfaces and text. */
export type ContrastLevel = (typeof ContrastLevel)[keyof typeof ContrastLevel];

/**
 * Accent hues AudioGubbins offers.
 *
 * Hue angles in OKLCH, chosen so that each reaches a usable chroma at both the
 * dark and light end of the brightness range. Users pick from these rather than
 * from a free colour wheel, because a freely chosen accent can be one that
 * cannot meet contrast against any surface, and offering a control that
 * produces an unreadable interface is not a kindness.
 */
export const ACCENT_HUES = {
  blue: 250,
  teal: 195,
  green: 145,
  amber: 75,
  orange: 50,
  red: 25,
  magenta: 340,
  violet: 295,
} as const;

/** An accent AudioGubbins offers. */
export type AccentName = keyof typeof ACCENT_HUES;

/** Whether a value names an accent AudioGubbins offers. */
export function isAccentName(value: unknown): value is AccentName {
  return typeof value === 'string' && Object.hasOwn(ACCENT_HUES, value);
}

/**
 * Every accent AudioGubbins offers, in the order they are presented.
 *
 * Filtered through the predicate rather than asserted, so no caller has to
 * assert what the object's keys are.
 */
export const ACCENT_NAMES: readonly AccentName[] = Object.keys(ACCENT_HUES).filter(isAccentName);

/**
 * What an accent is called where the user reads it.
 *
 * The one home for the rule, read by the command that chooses an accent and by
 * the control that lists them, so the two cannot write one accent differently.
 */
export function accentLabel(accent: AccentName): string {
  return `${accent.charAt(0).toUpperCase()}${accent.slice(1)}`;
}

/** The lowest and highest brightness the control offers. */
export const BRIGHTNESS_RANGE = { minimum: -1, maximum: 1 } as const;

/** How the user has set up the interface. */
export interface ThemePreferences {
  /** Version of this stored format (REQ-REPO-187). */
  readonly schemaVersion: number;

  readonly mode: ThemeMode;
  readonly accent: AccentName;

  /**
   * How light or dark the interface is, from -1 to 1, where 0 is as designed.
   *
   * Applied as a perceptual lightness offset to every surface and text token,
   * not as a filter over the rendered interface (REQ-UX-070). The palette is
   * rebuilt, so contrast is recomputed rather than degraded.
   */
  readonly brightness: number;

  readonly density: Density;

  /**
   * The contrast the user chose, or `undefined` to follow the system.
   *
   * The same model as motion. Were contrast only ever raised by the system, a
   * user whose system asked for more contrast would get high contrast, and the
   * switch that should turn it off would read "off" while it was on and could
   * not change it. Following the system until the user chooses honours an
   * accessibility setting by default and leaves the user the final say.
   */
  readonly contrast?: ContrastLevel;

  /**
   * The motion level the user chose, or `undefined` to follow the system.
   *
   * REQ-UX-069 requires the system's `prefers-reduced-motion` to be respected
   * *and* an explicit user override to be possible. Those are only compatible
   * if "no choice made" is distinguishable from "chose Full", which is what
   * `undefined` records.
   */
  readonly motion?: MotionLevel;
}

/** How AudioGubbins looks before a user changes anything. */
export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  schemaVersion: SCHEMA_VERSIONS.userPreferences,
  mode: ThemeMode.Dark,
  accent: 'blue',
  brightness: 0,
  density: Density.Comfortable,
};

/** What the operating system and browser report about the user's preferences. */
export interface SystemAppearance {
  /** Whether the system asks for a dark interface. */
  readonly prefersDark: boolean;

  /** Whether the system asks for less movement. */
  readonly prefersReducedMotion: boolean;

  /** Whether the system asks for more contrast. */
  readonly prefersMoreContrast: boolean;
}

/** Nothing is known about the system, so nothing is assumed. */
export const UNKNOWN_SYSTEM_APPEARANCE: SystemAppearance = {
  prefersDark: false,
  prefersReducedMotion: false,
  prefersMoreContrast: false,
};

/** Whether the interface should be dark, given the preference and the system. */
export function resolveDarkness(preferences: ThemePreferences, system: SystemAppearance): boolean {
  switch (preferences.mode) {
    case ThemeMode.Dark:
      return true;
    case ThemeMode.Light:
      return false;
    case ThemeMode.System:
      return system.prefersDark;
  }
}

/**
 * How much the interface should move, given the preference and the system.
 *
 * With no explicit choice, the system decides. With an explicit choice, the
 * user decides, including choosing Full while the system asks for less:
 * REQ-UX-069 permits that override, and a person who has deliberately asked for
 * the full experience has answered the question the system preference was
 * guessing at.
 */
export function resolveMotion(
  preferences: ThemePreferences,
  system: SystemAppearance,
): MotionLevel {
  if (preferences.motion !== undefined) return preferences.motion;
  return system.prefersReducedMotion ? MotionLevel.Reduced : MotionLevel.Full;
}

/** How strong the contrast should be, given the preference and the system. */
export function resolveContrast(
  preferences: ThemePreferences,
  system: SystemAppearance,
): ContrastLevel {
  // The user's choice when there is one; otherwise what the system asks for.
  return (
    preferences.contrast ??
    (system.prefersMoreContrast ? ContrastLevel.High : ContrastLevel.Standard)
  );
}

/** Constrains brightness to the range the control offers. */
export function clampBrightness(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(BRIGHTNESS_RANGE.maximum, Math.max(BRIGHTNESS_RANGE.minimum, value));
}
