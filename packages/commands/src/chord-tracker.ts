/**
 * Recognising a shortcut as it is typed.
 *
 * REQ-UX-066 requires multi-key chords. A chord turns the keyboard into a
 * decision: after Ctrl+K, the application has to hold the key sequence open and
 * wait, and it has to know when to give up and let the key through. Getting
 * that wrong is worse than having no chords, because a swallowed key is a key
 * the user's next action silently lost.
 *
 * The tracker is a state machine over {@link KeyPress} values, with no keyboard
 * event anywhere near it. The DOM translation happens at the edge, so every
 * branch here is testable without synthesising events, including the ones that
 * only happen after a wait.
 */

import type { KeyPress } from '@audiogubbins/input';

import type { CommandId } from './command.js';
import { commandForShortcut, isShortcutPrefix, type ShortcutProfile } from './shortcut.js';

/** What the keyboard handler should do with a press. */
export type ChordOutcome = ChordRunCommand | ChordWaiting | ChordAbandoned | ChordPassThrough;

/** The press completed a shortcut. Run the command and consume the key. */
export interface ChordRunCommand {
  readonly kind: 'run';
  readonly commandId: CommandId;

  /** The presses that made it up, for a diagnostic record. */
  readonly presses: readonly [KeyPress, ...KeyPress[]];
}

/** The press could still complete a longer shortcut. Consume the key and wait. */
export interface ChordWaiting {
  readonly kind: 'waiting';

  /** What has been typed so far, for the hint the shell shows. */
  readonly presses: readonly [KeyPress, ...KeyPress[]];
}

/**
 * The press cannot complete any shortcut, and a chord was in progress.
 *
 * The key is consumed rather than passed through: the user was mid-chord, so
 * the press was aimed at the chord and not at whatever has focus. Passing it on
 * would type a character into a field the user was not thinking about.
 */
export interface ChordAbandoned {
  readonly kind: 'abandoned';

  /** What had been typed, so the shell can say the chord was not recognised. */
  readonly presses: readonly [KeyPress, ...KeyPress[]];
}

/** The press matches nothing and no chord was in progress. Let the key through. */
export interface ChordPassThrough {
  readonly kind: 'pass-through';
}

/** Recognises shortcuts across successive presses. */
export interface ChordTracker {
  /** Offers a press and says what to do with it. */
  press(key: KeyPress): ChordOutcome;

  /**
   * Abandons any chord in progress.
   *
   * Called when focus leaves the application or the user presses Escape. A
   * chord left half-typed would otherwise still be waiting when the user
   * returns, and their next keystroke would complete a shortcut they have
   * forgotten starting.
   */
  reset(): void;

  /** The presses typed so far, empty when no chord is in progress. */
  pending(): readonly KeyPress[];
}

/** Creates a tracker reading from a profile that may change between presses. */
export function createChordTracker(profileOf: () => ShortcutProfile): ChordTracker {
  let pending: KeyPress[] = [];

  return {
    press(key) {
      const profile = profileOf();
      const sequence = [...pending, key];
      const [first, ...rest] = sequence;

      // `sequence` always has at least the press just offered.
      if (first === undefined) return { kind: 'pass-through' };
      const presses: readonly [KeyPress, ...KeyPress[]] = [first, ...rest];

      const command = commandForShortcut(profile, { presses });
      if (command !== undefined) {
        pending = [];
        return { kind: 'run', commandId: command, presses };
      }

      if (isShortcutPrefix(profile, sequence)) {
        pending = sequence;
        return { kind: 'waiting', presses };
      }

      if (pending.length > 0) {
        pending = [];
        return { kind: 'abandoned', presses };
      }

      return { kind: 'pass-through' };
    },

    reset() {
      pending = [];
    },

    pending: () => [...pending],
  };
}
