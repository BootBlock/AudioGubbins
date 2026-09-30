/**
 * The keyboard shortcuts of the shell, and what is said about a chord.
 *
 * Apart from the component that draws the shell because it is a concept of its
 * own, and nothing it does is drawn. It takes the five parts of the
 * application it uses rather than the application, and says everything through
 * the interaction store, which is where the shell's announcements go.
 */

import { useCallback, useMemo } from 'react';

import { describePresses, keyboardPlatformFor, type CommandId } from '@audiogubbins/commands';
import { commandLayerOf, type KeyEventReading } from '@audiogubbins/input';

import type { Application } from '../application.js';
import { useShortcuts } from './use-shortcuts.js';

/** What the shortcuts are read and run with. */
type ShortcutParts = Pick<
  Application,
  'context' | 'run' | 'tracker' | 'logger' | 'convention' | 'registry'
>;

/** Listens for the shell's shortcuts, and says where a chord has got to. */
export function useShellShortcuts({
  context,
  run,
  tracker,
  logger,
  convention,
  registry,
}: ShortcutParts): void {
  useShortcuts({
    tracker,
    run,
    onPendingChange: useCallback(
      (presses) => {
        context.interaction.setPendingChord(presses);

        // Said, because the status bar that shows it is not a live region:
        // unsaid, a screen-reader user who pressed the prefix would hear
        // nothing, and could not tell a chord waiting for its next key from a
        // key that did nothing, and the command palette itself is behind the
        // prefix. Not shown as a notice as well, because the status bar shows
        // it, and a notice would stay over the command palette the chord had
        // just opened.
        const pressed = describePresses(presses, convention, context.keyboardLayout.get());
        if (pressed !== undefined) {
          context.interaction.announce(`${pressed} pressed. Waiting for the next key.`, false, {
            shown: false,
          });
        }
      },
      [context, convention],
    ),
    onAnnounce: context.interaction.announce,
    onChordCancelled: useCallback(() => {
      context.interaction.announce('The shortcut is cancelled.', false, { shown: false });
    }, [context]),
    runsInADialogue: useCallback(
      (id: CommandId) => registry.get(id)?.changesAppearance === true,
      [registry],
    ),
    platform: useMemo(() => keyboardPlatformFor(convention), [convention]),
    reader: useMemo(
      () => ({
        read: context.keyboardLayout.learn,
        // The press the settings ask for, to learn how Command is read, and
        // only while they ask for it: a press of the key they name that the
        // layout learns the reading from. It is bound to nothing, so let
        // through, the browser would act on it; and asked for or not, the same
        // press can be the reader's Copy.
        asked: (reading: KeyEventReading) =>
          context.interaction.get().commandPressKeyAsked === reading.code &&
          commandLayerOf(reading, context.keyboardLayout.get()) !== undefined,
      }),
      [context],
    ),
    logger,
  });
}
