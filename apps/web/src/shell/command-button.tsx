/**
 * A button that runs a command, unavailable with the command's own reason, so
 * a panel's control and the palette entry of the same name are one action and
 * refuse for one reason.
 *
 * It stays in the tab order while it cannot be used, with its reason said on
 * screen and tied to it, as every control that can be unavailable is
 * (`reasoned-button.tsx`): disabled, it would leave the tab order, and a
 * reason kept in a tooltip reaches no screen reader and no touch.
 */

import type { ReactNode } from 'react';

import type { ButtonTone } from '@audiogubbins/design-system';
import type { CommandInvocation } from '@audiogubbins/commands';

import type { VoicedOptions } from '../state/interaction-store.js';

import {
  NotedButton,
  ReasonedButton,
  useSharedReasons,
  type SharedReasons,
} from './settings/reasoned-button.js';

/** How a panel runs a command, and asks why one cannot run. */
export interface PanelCommands {
  readonly run: (
    id: string,
    args?: CommandInvocation['arguments'],
    options?: VoicedOptions,
  ) => void;
  readonly unavailableReason: (id: string) => string | undefined;
}

/**
 * The reasons of the commands `ids`, each said once, for a row of buttons
 * that would otherwise say one reason at each (`useSharedReasons`).
 */
export function useCommandReasons(
  commands: PanelCommands,
  ids: readonly string[],
): SharedReasons<string> {
  return useSharedReasons(
    Object.fromEntries(ids.map((id) => [id, commands.unavailableReason(id)])),
  );
}

/** A button that runs the command `id`, with `args`, as `commands` does. */
export function CommandButton({
  id,
  label,
  commands,
  args,
  tone,
  compact = false,
  refusal,
  shared,
  sayWhenUnchanged = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly commands: PanelCommands;
  readonly args?: CommandInvocation['arguments'];
  readonly tone?: ButtonTone;
  readonly compact?: boolean;

  /**
   * Why the command refuses the arguments this button gives, where the panel
   * knows before it runs: said as the command's own reason is, after it.
   */
  readonly refusal?: string | undefined;

  /**
   * The reasons of the row this button is in, said once above it, where they
   * are; its own is said beside it otherwise. A row's are its commands' own,
   * so a button given them is given no `refusal`.
   */
  readonly shared?: SharedReasons<string>;

  /**
   * Whether the command says so when it finds nothing to do, for a button
   * whose panel shows nothing of what it would have done: comparing a change
   * with before it, whose comparison is the History panel's.
   */
  readonly sayWhenUnchanged?: boolean;
}): ReactNode {
  const run = (): void => {
    if (sayWhenUnchanged) commands.run(id, args, { sayWhenUnchanged });
    else if (args === undefined) commands.run(id);
    else commands.run(id, args);
  };
  const toned = tone === undefined ? {} : { tone };
  if (shared !== undefined) {
    return (
      <NotedButton {...toned} compact={compact} reasonId={shared.idOf(id)} onPress={run}>
        {label}
      </NotedButton>
    );
  }
  return (
    <ReasonedButton
      {...toned}
      compact={compact}
      reason={commands.unavailableReason(id) ?? refusal}
      onPress={run}
    >
      {label}
    </ReasonedButton>
  );
}
