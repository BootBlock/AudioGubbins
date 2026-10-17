/**
 * What a design-system button is given to run a command: the command's own
 * unavailable reason, which the button opens on hover or focus (`ADR-0013`),
 * and a press that runs it. A `CommandButton` draws a text button; this is for
 * a button the panel draws itself, with a glyph or a tone of its own, so it and
 * the palette entry of the same name still refuse for one reason.
 */

import type { CommandInvocation } from '@audiogubbins/commands';

import type { VoicedOptions } from '../state/interaction-store.js';
import type { PanelCommands } from './command-button.js';

/** A button's reason and press, spread onto `Button`, `IconButton` or `ControlBarButton`. */
export interface CommandPress {
  readonly unavailableReason?: string;
  readonly onPress: () => void;
}

/**
 * The reason and the press of the command `id` with `args`, run as `commands`
 * runs it. `refusal` is why the command refuses these arguments where the panel
 * knows before it runs; it is the reason only where the command has none of
 * its own, as `CommandButton` orders them.
 */
export function commandPress(
  commands: PanelCommands,
  id: string,
  args?: CommandInvocation['arguments'],
  options?: VoicedOptions,
  refusal?: string,
): CommandPress {
  const reason = commands.unavailableReason(id, args) ?? refusal;
  return {
    ...(reason === undefined ? {} : { unavailableReason: reason }),
    onPress: () => {
      if (options !== undefined) commands.run(id, args, options);
      else if (args === undefined) commands.run(id);
      else commands.run(id, args);
    },
  };
}
