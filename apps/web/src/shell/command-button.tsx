/**
 * A button that runs a command, disabled with the command's own reason, so a
 * panel's control and the palette entry of the same name are one action and
 * refuse for one reason.
 */

import type { ReactNode } from 'react';

import { Button, type ButtonTone } from '@audiogubbins/design-system';
import type { CommandInvocation } from '@audiogubbins/commands';

/** How a panel runs a command, and asks why one cannot run. */
export interface PanelCommands {
  readonly run: (id: string, args?: CommandInvocation['arguments']) => void;
  readonly unavailableReason: (id: string) => string | undefined;
}

/** A button that runs the command `id`, with `args`, as `commands` does. */
export function CommandButton({
  id,
  label,
  commands,
  args,
  tone,
  compact = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly commands: PanelCommands;
  readonly args?: CommandInvocation['arguments'];
  readonly tone?: ButtonTone;
  readonly compact?: boolean;
}): ReactNode {
  const reason = commands.unavailableReason(id);
  return (
    <Button
      {...(tone === undefined ? {} : { tone })}
      compact={compact}
      disabled={reason !== undefined}
      title={reason}
      onClick={() => {
        if (args === undefined) commands.run(id);
        else commands.run(id, args);
      }}
    >
      {label}
    </Button>
  );
}
