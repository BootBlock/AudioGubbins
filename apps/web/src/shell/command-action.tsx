/**
 * A button that runs a command, drawn as the design language's button, and
 * unavailable with the command's own reason in the design system's own way
 * (ADR-0013): it keeps its focus, says it is unavailable, is described by its
 * reason and opens it on hover or focus, and runs nothing when pressed.
 *
 * Where the panel knows the command will refuse the arguments it gives, it
 * says why as `refusal`, after the command's own reason.
 */

import type { ReactNode, Ref } from 'react';

import { Button, ButtonTone, Icon, type IconName } from '@audiogubbins/design-system';
import type { CommandInvocation } from '@audiogubbins/commands';

import type { PanelCommands } from './command-button.js';
import { optionalReason } from './optional-reason.js';

/** A button that runs the command `id` with `args`, as `commands` does. */
export function CommandAction({
  id,
  label,
  commands,
  args,
  refusal,
  tone = ButtonTone.Neutral,
  icon,
  ref,
}: {
  readonly id: string;
  readonly label: string;
  readonly commands: PanelCommands;
  readonly args?: CommandInvocation['arguments'];
  readonly refusal?: string | undefined;
  readonly tone?: ButtonTone;
  /** A glyph before the label. */
  readonly icon?: IconName;
  readonly ref?: Ref<HTMLButtonElement>;
}): ReactNode {
  return (
    <Button
      compact
      tone={tone}
      {...(ref === undefined ? {} : { ref })}
      {...optionalReason(commands.unavailableReason(id, args) ?? refusal)}
      onClick={() => {
        if (args === undefined) commands.run(id);
        else commands.run(id, args);
      }}
    >
      {icon !== undefined && <Icon name={icon} />}
      {label}
    </Button>
  );
}
