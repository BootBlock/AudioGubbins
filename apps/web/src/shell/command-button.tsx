/**
 * The button that runs a command: the one way a panel offers a command, so a
 * panel's control and the palette entry of the same name are one action,
 * drawn with one glyph, refusing for one reason.
 *
 * It leads with the command's glyph, as its menu entry and its palette row
 * draw it, and has an accessible name. While the command cannot run, it is
 * unavailable in the design system's own way (ADR-0013; design language,
 * section 13): it keeps its place and its focus, says it is unavailable, is
 * described by the reason, opens the reason on hover or focus, and runs
 * nothing when pressed. The reason is never written beside it as standing
 * text, which a row of buttons would repeat at every one.
 */

import type { ReactNode, Ref } from 'react';

import { Button, ButtonTone, Icon, type IconName } from '@audiogubbins/design-system';
import type { CommandInvocation } from '@audiogubbins/commands';

import type { VoicedOptions } from '../state/interaction-store.js';
import { COMMAND_GLYPHS } from './command-glyphs.js';

/** How a panel runs a command, and asks why one cannot run. */
export interface PanelCommands {
  readonly run: (
    id: string,
    args?: CommandInvocation['arguments'],
    options?: VoicedOptions,
  ) => void;
  /** Why the command `id` cannot run now, given `args` where the control gives them. */
  readonly unavailableReason: (
    id: string,
    args?: CommandInvocation['arguments'],
  ) => string | undefined;
}

/** A button that runs the command `id`, with `args`, as `commands` does. */
export function CommandButton({
  id,
  label,
  commands,
  args,
  tone,
  compact = false,
  iconOnly = false,
  name,
  icon,
  refusal,
  sayWhenUnchanged = false,
  ref,
}: {
  readonly id: string;

  /**
   * Its words, and its accessible name unless `name` gives a fuller one. An
   * icon-only button shows them as its hint.
   */
  readonly label: string;

  readonly commands: PanelCommands;
  readonly args?: CommandInvocation['arguments'];
  /** How prominent it is: an icon-only one is quiet unless told otherwise. */
  readonly tone?: ButtonTone;

  /** The small control height, for a row or a toolbar; full size is a header's. */
  readonly compact?: boolean;

  /**
   * Whether it draws the glyph alone, named by `label`. A command with no
   * glyph is drawn with its words instead, never with a blank button.
   */
  readonly iconOnly?: boolean;

  /**
   * The accessible name, where the words lean on what is beside them: "Apply"
   * on a candidate's card is "Apply candidate 2".
   */
  readonly name?: string;

  /**
   * A glyph in place of the command's own, where the arguments make the
   * command a different action: auditioning a loop candidate with its
   * crossfade rather than without.
   */
  readonly icon?: IconName;

  /**
   * Why the command refuses the arguments this button gives, where the panel
   * knows before it runs: given after the command's own reason.
   */
  readonly refusal?: string | undefined;

  /**
   * Whether the command says so when it finds nothing to do, for a button
   * whose panel shows nothing of what it would have done: comparing a change
   * with before it, whose comparison is the History panel's.
   */
  readonly sayWhenUnchanged?: boolean;

  readonly ref?: Ref<HTMLButtonElement>;
}): ReactNode {
  const run = (): void => {
    if (sayWhenUnchanged) commands.run(id, args, { sayWhenUnchanged });
    else if (args === undefined) commands.run(id);
    else commands.run(id, args);
  };
  const reason = commands.unavailableReason(id, args) ?? refusal;
  const common = {
    compact,
    ...(reason === undefined ? {} : { unavailableReason: reason }),
    ...(ref === undefined ? {} : { ref }),
    onClick: run,
  };
  const glyph = icon ?? COMMAND_GLYPHS.get(id);

  // One element either way, so a button that changes how it is drawn keeps
  // its focus. Bare, it is drawn as the icon button is: quiet until hovered.
  if (iconOnly && glyph !== undefined) {
    return (
      <Button
        {...common}
        tone={tone ?? ButtonTone.Quiet}
        iconOnly
        label={name ?? label}
        hint={label}
      >
        <Icon name={glyph} />
      </Button>
    );
  }
  return (
    <Button
      {...common}
      {...(tone === undefined ? {} : { tone })}
      {...(name === undefined ? {} : { label: name })}
    >
      {glyph !== undefined && <Icon name={glyph} />}
      {label}
    </Button>
  );
}
