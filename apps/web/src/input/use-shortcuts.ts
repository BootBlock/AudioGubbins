/**
 * Turning keystrokes into commands.
 *
 * The edge that listens to the document and feeds key presses, read by the
 * input package, to the chord recognition, the conflict rules and the profile,
 * which live in `@audiogubbins/commands` where they are testable without a
 * browser.
 *
 * The listener sits on the document rather than on a container, because a
 * shortcut has to work wherever focus is, including on a panel the docking
 * engine has portalled elsewhere in the tree.
 */

import { useEffect } from 'react';
import type { ChordTracker, CommandId } from '@audiogubbins/commands';
import {
  isShortcutPress,
  isTypingPress,
  keyPressFromEvent,
  readingOf,
  type KeyEventReading,
  type KeyPress,
  type KeyboardPlatform,
} from '@audiogubbins/input';
import type { Logger } from '@audiogubbins/diagnostics';

import type { Announce } from '../commands/voiced-execution.js';

/** Whether the event is aimed at a field the user types into. */
export function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement)
  );
}

/**
 * What the keyboard layout makes of every key event read, typing included.
 *
 * One option, because both halves are the layout's: what it learns the
 * reader's layout types from a press (see `keyboard-layout-store.ts`), and
 * whether the application asked the reader for that press to learn from, so
 * the browser is kept from acting on it. Asked before the press is read,
 * which may settle what made the request.
 */
export interface KeyReader {
  readonly read: (reading: KeyEventReading) => void;
  readonly asked: (reading: KeyEventReading) => boolean;
}

/** What the hook needs. */
export interface ShortcutBindingOptions {
  readonly tracker: ChordTracker;

  /**
   * Runs the command a chord completed, saying why when it refuses.
   *
   * The application's own one voiced run, rather than a bus and a context this
   * hook builds a second one from: two routes into the bus would say a refusal
   * in two places, and the one this hook built would take no options.
   */
  readonly run: (id: CommandId) => void;

  /** Called as a chord builds, so the shell can show what is waiting. */
  readonly onPendingChange: (presses: readonly KeyPress[]) => void;

  /** Called with British-English text the user should be told. */
  readonly onAnnounce: Announce;

  /**
   * Called when a chord in progress is given up without running: by Escape,
   * or by typing into a field. The prefix was said, so its end is said too.
   */
  readonly onChordCancelled: () => void;

  /** How this platform's keyboard uses AltGr, and whether Option types in a field. */
  readonly platform: KeyboardPlatform;

  /** Given every key event read, typing included. */
  readonly reader: KeyReader;

  readonly logger: Logger;
}

/** Listens for shortcuts while the component is mounted. */
export function useShortcuts(options: ShortcutBindingOptions): void {
  const { tracker, run, onPendingChange, onAnnounce, onChordCancelled, platform, reader, logger } =
    options;

  useEffect(() => {
    /**
     * Gives up the chord in progress.
     *
     * The one place a chord is given up, so a caller that says so and one that
     * does not forget the same two things: the tracker's presses, and the
     * presses the shell shows.
     */
    const forgetChord = (): void => {
      tracker.reset();
      onPendingChange([]);
    };

    /** Gives up the chord in progress, and says so. */
    const cancelChord = (): void => {
      forgetChord();
      onChordCancelled();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      // Every key read teaches the layout, typing included.
      const reading = readingOf(event, platform);
      if (reader.asked(reading)) event.preventDefault();
      reader.read(reading);

      // A modifier, a dead key, a key an input method is composing with, and
      // anything typed with the layout's third-level modifier are the user
      // typing rather than a shortcut, and must not abandon a chord in
      // progress either.
      if (!isShortcutPress(reading)) return;

      if (event.key === 'Escape' && tracker.pending().length > 0) {
        cancelChord();
        event.preventDefault();
        return;
      }

      if (isTextField(event.target) && isTypingPress(reading, platform)) {
        // Typing gives up a chord in progress. Were the chord to survive, a
        // user who pressed the prefix, clicked into a field and typed a name
        // would complete a shortcut with the next Ctrl+X they meant as cut.
        if (tracker.pending().length > 0) cancelChord();
        return;
      }

      const outcome = tracker.press(keyPressFromEvent(reading));

      switch (outcome.kind) {
        case 'pass-through':
          return;

        case 'waiting':
          onPendingChange(outcome.presses);
          event.preventDefault();
          return;

        case 'abandoned':
          onPendingChange([]);
          onAnnounce('That key sequence is not a shortcut.', false);
          event.preventDefault();
          return;

        case 'run': {
          onPendingChange([]);
          event.preventDefault();

          // A shortcut that appears to do nothing is how a user decides the
          // application is unreliable, so a refusal is said out loud, through
          // the one route every interface caller of the bus takes.
          run(outcome.commandId);
          return;
        }
      }
    };

    /**
     * Abandons a chord when the window loses focus.
     *
     * Without this, a user who pressed Ctrl+K and then switched away would
     * return to a tracker still waiting, and their next keystroke would
     * complete a shortcut they had long forgotten starting.
     */
    const onBlur = (): void => {
      if (tracker.pending().length === 0) return;
      forgetChord();
      logger.debug('A chord was abandoned because the window lost focus.');
    };

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [tracker, run, onPendingChange, onAnnounce, onChordCancelled, platform, reader, logger]);
}
