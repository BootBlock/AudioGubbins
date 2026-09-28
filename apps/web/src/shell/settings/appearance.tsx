/**
 * How the interface looks, and how much it moves.
 *
 * Every control here runs a command rather than calling a store (REQ-EDIT-073).
 * That is not ceremony: it is what makes the same change reachable from the
 * palette and from a shortcut, and what keeps one place deciding whether a
 * change is currently allowed.
 */

import type { ReactNode } from 'react';

import {
  ACCENT_NAMES,
  accentLabel,
  BRIGHTNESS_RANGE,
  ContrastLevel,
  Density,
  MotionLevel,
  OptionSelect,
  ThemeMode,
  ValueSlider,
  useTheme,
  type ThemePreferences,
} from '@audiogubbins/design-system';

import type { RunCommand } from './section.js';

/** What the appearance controls need. */
export interface AppearanceProps {
  readonly preferences: ThemePreferences;
  readonly run: RunCommand;
}

/** How the interface looks. */
export function Appearance({ preferences, run }: AppearanceProps): ReactNode {
  return (
    <div className="ag-settings-section">
      <OptionSelect
        label="Theme"
        value={preferences.mode}
        options={[
          { value: ThemeMode.Dark, label: 'Dark' },
          { value: ThemeMode.Light, label: 'Light' },
          { value: ThemeMode.System, label: 'Follow the system' },
        ]}
        onValueChange={(mode) => {
          run(
            mode === ThemeMode.Dark
              ? 'view.theme-dark'
              : mode === ThemeMode.Light
                ? 'view.theme-light'
                : 'view.theme-system',
          );
        }}
      />

      <OptionSelect
        label="Accent colour"
        value={preferences.accent}
        options={ACCENT_NAMES.map((accent) => ({
          value: accent,
          label: accentLabel(accent),
        }))}
        onValueChange={(accent) => {
          run(`view.accent-${accent}`);
        }}
      />

      <ValueSlider
        label="Brightness"
        value={preferences.brightness}
        minimum={BRIGHTNESS_RANGE.minimum}
        maximum={BRIGHTNESS_RANGE.maximum}
        step={0.1}
        displayValue={
          preferences.brightness === 0 ? 'As designed' : preferences.brightness.toFixed(1)
        }
        describeValue={(value) =>
          value === 0
            ? 'as designed'
            : value > 0
              ? `${(value * 100).toFixed(0)} per cent brighter`
              : `${(-value * 100).toFixed(0)} per cent darker`
        }
        onValueChange={(next) => {
          // The slider sets the value it was moved to, rather than running
          // whichever of the two stepping commands matches the direction: a
          // stepping command would move the value by one step across a whole
          // drag, so the thumb would spring back, and would do nothing at all
          // for Home and End.
          run('view.set-brightness', { brightness: next });
        }}
      />

      <OptionSelect
        label="Density"
        value={preferences.density}
        options={[
          { value: Density.Comfortable, label: 'Comfortable' },
          { value: Density.Compact, label: 'Compact' },
        ]}
        onValueChange={(density) => {
          run(density === Density.Compact ? 'view.density-compact' : 'view.density-comfortable');
        }}
      />
    </div>
  );
}

/** How a level the system decides is written, with what it currently is. */
function followingTheSystem(current: string): string {
  return `Follow the system (${current} now)`;
}

/**
 * Accessibility settings.
 *
 * Each setting the system can decide offers to follow it, and says what
 * following it means right now. A switch that read the stored choice could do
 * neither: under a system request for more contrast it would say "off" while
 * high contrast is in force, and could not turn it off.
 */
export function Accessibility({ preferences, run }: AppearanceProps): ReactNode {
  const theme = useTheme();

  return (
    <div className="ag-settings-section">
      <OptionSelect
        label="Contrast"
        value={preferences.contrast ?? 'system'}
        options={[
          {
            value: 'system',
            label: followingTheSystem(theme.contrast === ContrastLevel.High ? 'high' : 'standard'),
          },
          { value: ContrastLevel.Standard, label: 'Standard' },
          { value: ContrastLevel.High, label: 'High, reaching WCAG AAA for body text' },
        ]}
        onValueChange={(contrast) => {
          run(
            contrast === 'system'
              ? 'view.contrast-system'
              : contrast === ContrastLevel.High
                ? 'view.high-contrast'
                : 'view.standard-contrast',
          );
        }}
      />

      <OptionSelect
        label="Animation"
        value={preferences.motion ?? 'system'}
        options={[
          { value: 'system', label: followingTheSystem(theme.motionLevel) },
          { value: MotionLevel.Full, label: 'Full' },
          { value: MotionLevel.Reduced, label: 'Reduced' },
          { value: MotionLevel.Minimal, label: 'Minimal' },
        ]}
        onValueChange={(motion) => {
          run(motion === 'system' ? 'view.motion-system' : `view.motion-${motion}`);
        }}
      />
    </div>
  );
}
