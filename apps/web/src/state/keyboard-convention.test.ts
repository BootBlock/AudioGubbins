import { describe, expect, it } from 'vitest';

import { OperatingSystem } from '@audiogubbins/capabilities';
import { KeyboardConvention } from '@audiogubbins/commands';

import { keyboardConventionFor } from './keyboard-convention.js';

describe('which keyboard conventions a system uses', () => {
  it.each([
    [OperatingSystem.MacOs, KeyboardConvention.Apple],
    [OperatingSystem.Ios, KeyboardConvention.Apple],
    [OperatingSystem.IpadOs, KeyboardConvention.Apple],
    [OperatingSystem.Windows, KeyboardConvention.Windows],
    [OperatingSystem.Linux, KeyboardConvention.Linux],
  ])('gives %s its own conventions', (system, convention) => {
    expect(keyboardConventionFor(system)).toBe(convention);
  });

  it.each([OperatingSystem.ChromeOs, OperatingSystem.Android, OperatingSystem.Unknown])(
    'maps %s onto the Linux conventions, which is what the table is written for',
    (system) => {
      // Read by a test rather than only by the composition root, because it is
      // what decides which reservation reasons a user of one of these systems
      // is shown. Six rows named a GNOME launcher and a KDE force-quit cursor
      // to a Chromebook user before anything said this mapping out loud.
      expect(keyboardConventionFor(system)).toBe(KeyboardConvention.Linux);
    },
  );
});
