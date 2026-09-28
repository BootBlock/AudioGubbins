/**
 * Which keyboard conventions to write shortcuts in.
 *
 * REQ-UX-066 requires platform-specific representation. It follows the
 * operating system rather than the browser, because a Chrome user on a Mac
 * presses Command and a Chrome user on Windows does not. The operating system
 * is named by the capability package's one parser, which the diagnostic summary
 * and the browser tests also ask; this only maps its answer onto the command
 * layer's conventions, which the capability package does not know.
 *
 * Its own module so that the browser suite reads the same mapping the
 * application does: a suite that decided the platform's modifier for itself
 * would be one more copy to drift apart from the others.
 */

import { OperatingSystem, usesAppleModifiers } from '@audiogubbins/capabilities';
import { KeyboardConvention } from '@audiogubbins/commands';

/** The conventions of the system named. */
export function keyboardConventionFor(system: OperatingSystem): KeyboardConvention {
  if (usesAppleModifiers(system)) return KeyboardConvention.Apple;
  return system === OperatingSystem.Windows ? KeyboardConvention.Windows : KeyboardConvention.Linux;
}
