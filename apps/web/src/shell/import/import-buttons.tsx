/**
 * The buttons of the Asset Browser's import, each running its command and
 * refusing for the reason the palette gives, opened on hover or focus and tied
 * to the button (ADR-0013).
 *
 * An import button is one element whether it is drawn as a glyph beside a list
 * or as a call to action of the panel's empty state, so the focus stays on it
 * as the panel's state changes. It says it can be used as well as when it
 * cannot, as the menus' entries do.
 */

import type { ReactNode } from 'react';

import { Button, ButtonTone, IconButton, Icon, type IconName } from '@audiogubbins/design-system';

import type { PanelCommands } from '../command-button.js';
import { optionalReason } from '../optional-reason.js';

/** A button that runs the import command `id`: a glyph, or a call to action while `calling`. */
export function ImportButton({
  id,
  icon,
  label,
  call,
  callTone,
  calling,
  commands,
}: {
  readonly id: string;
  readonly icon: IconName;
  /** Its accessible name: the command's own label. */
  readonly label: string;
  /** Its words as a call to action. */
  readonly call: string;
  readonly callTone: ButtonTone;
  readonly calling: boolean;
  readonly commands: PanelCommands;
}): ReactNode {
  const reason = commands.unavailableReason(id);
  return (
    <Button
      tone={calling ? callTone : ButtonTone.Quiet}
      compact
      {...(calling ? { label } : { iconOnly: true, label, hint: label })}
      aria-disabled={reason !== undefined}
      {...optionalReason(reason)}
      onClick={() => {
        commands.run(id);
      }}
    >
      <Icon name={icon} />
      {calling && call}
    </Button>
  );
}

/** The button that clears the list of files imported. */
export function ClearImportsButton({
  label,
  commands,
}: {
  readonly label: string;
  readonly commands: PanelCommands;
}): ReactNode {
  return (
    <IconButton
      icon="clear"
      label={label}
      hint={label}
      compact
      {...optionalReason(commands.unavailableReason('file.clear-imports'))}
      onClick={() => {
        commands.run('file.clear-imports');
      }}
    />
  );
}
