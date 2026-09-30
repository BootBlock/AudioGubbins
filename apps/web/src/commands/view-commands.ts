/**
 * How the interface looks: theme, accent, brightness, density, contrast,
 * motion.
 *
 * Every one of these is a preference change, so none is undoable and each is
 * available from the menu, the palette and a shortcut alike (REQ-EDIT-073). The
 * settings dialogue runs these commands rather than writing to the preference
 * store, which is what keeps one place deciding whether a change is allowed.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import {
  ACCENT_NAMES,
  accentLabel,
  BRIGHTNESS_RANGE,
  ContrastLevel,
  Density,
  MotionLevel,
  ThemeMode,
  clampBrightness,
} from '@audiogubbins/design-system';

import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** How far one press of a brightness command moves the control. */
const BRIGHTNESS_STEP = 0.1;

/**
 * Available unless the preference already has the value the command sets.
 *
 * A command that finds nothing to do says so before it is chosen, as an entry
 * greyed with its reason, rather than running and being recorded as a change:
 * otherwise choosing "Use the dark theme" in the dark theme would be logged as
 * applied.
 */
function unlessAlready(
  isAlready: (preferences: ReturnType<ShellContext['preferences']['get']>) => boolean,
  reason: string,
): (context: ShellContext) => CommandAvailability {
  return (context) => availableUnless(isAlready(context.preferences.get()) ? reason : undefined);
}

/** The accent commands, one per colour AudioGubbins offers. */
function accentCommands(): readonly Command<ShellContext>[] {
  return ACCENT_NAMES.map((accent) =>
    shellCommand(
      `view.accent-${accent}`,
      `Accent colour: ${accentLabel(accent)}`,
      CommandCategory.View,
      (context) => {
        context.preferences.change({ accent });
      },
      {
        keywords: ['colour', 'accent', 'theme', accent],
        availability: unlessAlready(
          (preferences) => preferences.accent === accent,
          'That accent colour is already in use.',
        ),
      },
    ),
  );
}

/** What each animation level is called, in its entry and in its reason. */
const MOTION_NAMES: Readonly<Record<MotionLevel, string>> = {
  [MotionLevel.Full]: 'Full',
  [MotionLevel.Reduced]: 'Reduced',
  [MotionLevel.Minimal]: 'Minimal',
};

/** The commands that change how the interface looks, each saying so. */
export function viewCommands(): readonly Command<ShellContext>[] {
  return appearanceCommands().map((command) => ({ ...command, changesAppearance: true }));
}

/** The commands that change how the interface looks. */
function appearanceCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      'view.theme-dark',
      'Use the dark theme',
      CommandCategory.View,
      (context) => {
        context.preferences.change({ mode: ThemeMode.Dark });
      },
      {
        keywords: ['theme', 'night', 'appearance', 'colour'],
        availability: unlessAlready(
          (preferences) => preferences.mode === ThemeMode.Dark,
          'The dark theme is already in use.',
        ),
      },
    ),

    shellCommand(
      'view.theme-light',
      'Use the light theme',
      CommandCategory.View,
      (context) => {
        context.preferences.change({ mode: ThemeMode.Light });
      },
      {
        keywords: ['theme', 'day', 'appearance', 'colour'],
        availability: unlessAlready(
          (preferences) => preferences.mode === ThemeMode.Light,
          'The light theme is already in use.',
        ),
      },
    ),

    shellCommand(
      'view.theme-system',
      'Follow the system theme',
      CommandCategory.View,
      (context) => {
        context.preferences.change({ mode: ThemeMode.System });
      },
      {
        keywords: ['theme', 'automatic', 'appearance'],
        availability: unlessAlready(
          (preferences) => preferences.mode === ThemeMode.System,
          'AudioGubbins already follows the system theme.',
        ),
      },
    ),

    shellCommand(
      'view.brighten',
      'Brighten the interface',
      CommandCategory.View,
      (context) => {
        const { brightness } = context.preferences.get();
        context.preferences.change({ brightness: clampBrightness(brightness + BRIGHTNESS_STEP) });
      },
      {
        keywords: ['brightness', 'lighter'],
        availability: unlessAlready(
          (preferences) => preferences.brightness >= BRIGHTNESS_RANGE.maximum,
          'The interface is already at its brightest.',
        ),
      },
    ),

    shellCommand(
      'view.darken',
      'Darken the interface',
      CommandCategory.View,
      (context) => {
        const { brightness } = context.preferences.get();
        context.preferences.change({ brightness: clampBrightness(brightness - BRIGHTNESS_STEP) });
      },
      {
        keywords: ['brightness', 'dimmer', 'darker'],
        availability: unlessAlready(
          (preferences) => preferences.brightness <= BRIGHTNESS_RANGE.minimum,
          'The interface is already at its darkest.',
        ),
      },
    ),

    shellCommand(
      'view.set-brightness',
      'Set the interface brightness',
      CommandCategory.View,
      (context, invocation) => {
        // A slider follows a drag, a track click and Home or End, none of which
        // is a fixed step. Wired to the two stepping commands, a drag across
        // the track would move the value by one step, and the thumb would
        // spring back to where it started.
        const asked = invocation.arguments?.['brightness'];
        if (typeof asked !== 'number' || !Number.isFinite(asked)) {
          return 'Choose a brightness with the slider in the Appearance settings.';
        }

        const brightness = clampBrightness(asked);
        if (brightness === context.preferences.get().brightness) {
          return unchanged(
            'view.brightness-already-set',
            `The brightness is already ${String(brightness)}.`,
          );
        }
        context.preferences.change({ brightness });
        return undefined;
      },
      {
        keywords: ['brightness', 'level'],
        description:
          'Sets the brightness to a stated level. Brighten and Darken move it a step at a time.',
      },
    ),

    shellCommand(
      'view.density-comfortable',
      'Use comfortable spacing',
      CommandCategory.View,
      (context) => {
        context.preferences.change({ density: Density.Comfortable });
      },
      {
        keywords: ['density', 'spacing', 'larger'],
        availability: unlessAlready(
          (preferences) => preferences.density === Density.Comfortable,
          'Comfortable spacing is already in use.',
        ),
      },
    ),

    shellCommand(
      'view.density-compact',
      'Use compact spacing',
      CommandCategory.View,
      (context) => {
        context.preferences.change({ density: Density.Compact });
      },
      {
        keywords: ['density', 'spacing', 'smaller', 'dense'],
        availability: unlessAlready(
          (preferences) => preferences.density === Density.Compact,
          'Compact spacing is already in use.',
        ),
      },
    ),

    shellCommand(
      'view.high-contrast',
      'Turn high contrast on',
      CommandCategory.View,
      (context) => {
        context.preferences.change({ contrast: ContrastLevel.High });
      },
      {
        keywords: ['contrast', 'accessibility', 'readable'],
        availability: unlessAlready(
          (preferences) => preferences.contrast === ContrastLevel.High,
          'High contrast is already on.',
        ),
      },
    ),

    shellCommand(
      'view.standard-contrast',
      'Turn high contrast off',
      CommandCategory.View,
      (context) => {
        context.preferences.change({ contrast: ContrastLevel.Standard });
      },
      {
        keywords: ['contrast', 'accessibility'],
        availability: unlessAlready(
          (preferences) => preferences.contrast === ContrastLevel.Standard,
          'High contrast is already off.',
        ),
      },
    ),

    shellCommand(
      'view.contrast-system',
      'Follow the system contrast setting',
      CommandCategory.View,
      (context) => {
        // Removing the choice, rather than setting one, is what lets the
        // system's request for more contrast apply again.
        context.preferences.followSystemContrast();
      },
      {
        keywords: ['contrast', 'accessibility', 'automatic', 'system'],
        availability: unlessAlready(
          (preferences) => preferences.contrast === undefined,
          'AudioGubbins already follows the system contrast setting.',
        ),
      },
    ),

    ...Object.values(MotionLevel).map((motion) =>
      shellCommand(
        `view.motion-${motion}`,
        `Animation: ${MOTION_NAMES[motion]}`,
        CommandCategory.View,
        (context) => {
          context.preferences.change({ motion });
        },
        {
          keywords: ['motion', 'animation', 'movement', 'accessibility'],
          availability: unlessAlready(
            (preferences) => preferences.motion === motion,
            // The level by the word its entry is labelled with: "already full"
            // would read as a statement about capacity.
            `Animation is already set to ${MOTION_NAMES[motion]}.`,
          ),
        },
      ),
    ),

    shellCommand(
      'view.motion-system',
      'Follow the system animation setting',
      CommandCategory.View,
      (context) => {
        // Removing the choice, rather than setting one, is what lets the
        // system's reduced-motion preference apply again (REQ-UX-069).
        context.preferences.followSystemMotion();
      },
      {
        keywords: ['motion', 'animation', 'automatic'],
        availability: unlessAlready(
          (preferences) => preferences.motion === undefined,
          'AudioGubbins already follows the system animation setting.',
        ),
      },
    ),

    ...accentCommands(),
  ];
}
