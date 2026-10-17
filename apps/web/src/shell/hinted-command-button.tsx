/**
 * The buttons that run a command in the design language's reason pattern: an
 * unavailable one keeps its place and its focus, and opens the command's
 * reason on hover or focus, the reason held in the page as its description
 * (ADR-0013; design language, section 13). A worded button may lead with a
 * glyph, and an icon button draws the glyph alone, named for a screen reader.
 *
 * They run the same command, with the same reason, as the palette entry of
 * the same name and as `CommandButton`, which says its reason beside it
 * instead.
 */

import type { ReactNode } from 'react';

import { Button, ButtonTone, Icon, IconButton, type IconName } from '@audiogubbins/design-system';
import type { CommandInvocation } from '@audiogubbins/commands';

import type { PanelCommands } from './command-button.js';

/** What either button is given to run its command and find its reason. */
interface CommandControl {
  readonly id: string;
  readonly commands: PanelCommands;
  readonly args?: CommandInvocation['arguments'];

  /** The small control height, for a row; full size is a header's. */
  readonly compact?: boolean;

  /**
   * Why the command refuses the arguments this button gives, where the panel
   * knows before it runs: said after the command's own reason.
   */
  readonly refusal?: string | undefined;
}

/** The command's reason, or the panel's refusal, and the handler that runs it. */
function commandOf({ id, commands, args, refusal }: CommandControl): {
  readonly reason: { readonly unavailableReason?: string };
  readonly run: () => void;
} {
  const reason = commands.unavailableReason(id, args) ?? refusal;
  return {
    reason: reason === undefined ? {} : { unavailableReason: reason },
    run: () => {
      if (args === undefined) commands.run(id);
      else commands.run(id, args);
    },
  };
}

/** A worded button that runs the command `id`, with `args`, as `commands` does. */
export function HintedCommandButton({
  label,
  name,
  icon,
  tone = ButtonTone.Neutral,
  ...control
}: CommandControl & {
  /** Its words, and its accessible name unless `name` gives a fuller one. */
  readonly label: string;

  /**
   * The accessible name, where the words lean on what is beside them: "Apply"
   * on a candidate's card is "Apply candidate 2".
   */
  readonly name?: string;

  /** A glyph before the words. */
  readonly icon?: IconName;

  readonly tone?: ButtonTone;
}): ReactNode {
  const { reason, run } = commandOf(control);
  return (
    <Button
      tone={tone}
      compact={control.compact ?? false}
      {...(name === undefined ? {} : { label: name })}
      {...reason}
      onClick={run}
    >
      {icon !== undefined && <Icon name={icon} />}
      {label}
    </Button>
  );
}

/** An icon button that runs the command `id`, with `args`, as `commands` does. */
export function CommandIconButton({
  icon,
  label,
  ...control
}: CommandControl & {
  readonly icon: IconName;

  /** The accessible name, which its hint shows too. */
  readonly label: string;
}): ReactNode {
  const { reason, run } = commandOf(control);
  return (
    <IconButton
      icon={icon}
      label={label}
      hint={label}
      compact={control.compact ?? false}
      {...reason}
      onClick={run}
    />
  );
}
