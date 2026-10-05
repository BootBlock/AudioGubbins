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
 * engine has portalled elsewhere in the tree. The clipboard commands are the
 * exception: their shortcuts are the platform's own clipboard keys, so they are
 * the editor's only where an editor has the keyboard (see `runsHere`).
 */

import { useEffect } from 'react';
import type { ChordOutcome, ChordTracker, CommandId } from '@audiogubbins/commands';
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

import { CLIPBOARD_COMMANDS } from '../commands/clipboard-commands.js';
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

const selectorOf = (roles: readonly string[], elements: readonly string[]): string =>
  roles
    .map((role) => `[role="${role}"]`)
    .concat(elements)
    .join(', ');

/** Where the editor's navigation keys pressed alone are its shortcuts: its surface. */
const TAKES_NAVIGATION = '[role="application"]';

/**
 * The attribute an editor panel marks itself with, so a clipboard key pressed
 * on any control in it, its toolbar as much as its surface, is the editor's.
 */
export const EDITOR_PANEL = 'data-ag-editor-panel';

/** Where an editor has the keyboard: on its surface, or in its panel. */
const IN_AN_EDITOR = `${TAKES_NAVIGATION}, [${EDITOR_PANEL}]`;

/** Controls that also take a letter pressed alone, to find the entry it starts. */
const TYPES_AHEAD = selectorOf(
  ['menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'listbox', 'option'],
  ['select'],
).concat(', ', selectorOf(['tree', 'treegrid', 'grid', 'combobox'], []));

/** The keys a control moves with. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * A dialogue that makes the page behind it inert while it is open: the design
 * system's modal dialogue says so of itself.
 */
const MODAL_DIALOGUE = ['dialog', 'alertdialog']
  .map((role) => `[role="${role}"][aria-modal="true"]`)
  .join(', ');

/** The keys a text field moves its caret, and deletes, with, alone or with any modifier. */
const CARET_KEYS: ReadonlySet<string> = new Set([...NAVIGATION_KEYS, 'Backspace', 'Delete']);

/** The letters a text field selects all, undoes, redoes, cuts, copies and pastes with. */
const FIELD_LETTERS: ReadonlySet<string> = new Set(['a', 'c', 'v', 'x', 'y', 'z']);

/** A Latin letter alone, which is what a key typed on a Latin layout reads as. */
const LATIN_LETTER = /^[a-z]$/iu;

/**
 * The letter a press is read as by a field's own editing: the one the layout
 * types where it types a Latin letter, and the one at its US position where it
 * does not, as a browser reads Ctrl+A on a Russian layout.
 */
function letterOf(reading: KeyEventReading): string | undefined {
  if (LATIN_LETTER.test(reading.key)) return reading.key.toLowerCase();
  return reading.code.startsWith('Key') ? reading.code.slice(3).toLowerCase() : undefined;
}

/**
 * Whether a text field edits with a press made with a modifier: the caret keys
 * with any of them, which move by a word, a line or the whole text and select
 * as they go, and delete a word, on every system (Control on Windows and Linux,
 * Option and Command on Apple hardware); and select all, undo, redo and the
 * clipboard with Control or Command. Checked by what the keys are rather than
 * by the platform's usual modifier, because each system's fields answer both:
 * Command+A selects all on a Mac, and Control+A goes to the line's start.
 */
function fieldEditsWith(reading: KeyEventReading): boolean {
  if (CARET_KEYS.has(reading.code)) return true;
  const letter = letterOf(reading);
  return (
    (reading.ctrlKey || reading.metaKey) &&
    !reading.altKey &&
    letter !== undefined &&
    FIELD_LETTERS.has(letter)
  );
}

/**
 * Whether a press is aimed at something that uses it itself.
 *
 * A text field keeps the chords it edits with, so a shortcut on Ctrl+A or
 * Ctrl+Left gives way to selecting all or moving by a word while one has the
 * keyboard, and is the editor's everywhere else. Its typing is read before
 * this, by the listener, which also gives up a chord in progress for it.
 *
 * Elsewhere, a press made with no modifier but Shift. A navigation key pressed
 * alone moves, scrolls or changes whatever has the keyboard, a list, a toolbar,
 * a slider, a scrolled panel or a dialogue, so it is a shortcut only in the
 * editor's surface and where nothing has the keyboard; any other key pressed
 * alone is a list's or a menu's, which finds an entry by its letter. A shortcut
 * on a key pressed alone gives way there, so the editor's keys never take what
 * a control or a page does with them.
 */
export function ownsItsKeys(target: EventTarget | null, reading: KeyEventReading): boolean {
  if (isTextField(target)) return fieldEditsWith(reading);
  if (reading.ctrlKey || reading.metaKey || reading.altKey || !(target instanceof Element)) {
    return false;
  }
  if (NAVIGATION_KEYS.has(reading.code)) {
    return target !== target.ownerDocument.body && target.closest(TAKES_NAVIGATION) === null;
  }
  return target.closest(TYPES_AHEAD) !== null;
}

/**
 * Whether the command a shortcut completed runs where the press was aimed.
 *
 * Everywhere, but for a clipboard command, which runs only where an editor has
 * the keyboard and not in a text field there, which keeps its own clipboard
 * keys (`fieldEditsWith`). Anywhere else the platform's clipboard keys copy the
 * text a reader selected on the page, a diagnostic or a history entry, and
 * paste where the browser pastes, which a shortcut taking them would stop.
 * Decided by the command rather than by the keys, so a clipboard command bound
 * to other keys keeps the rule, and no other command bound to these keys is
 * given it.
 */
function runsHere(id: CommandId, target: EventTarget | null): boolean {
  if (!CLIPBOARD_COMMANDS.has(id)) return true;
  return target instanceof Element && !isTextField(target) && target.closest(IN_AN_EDITOR) !== null;
}

/** What a shortcut press is, before the chord tracker reads it. */
const PressOwner = {
  /** Typed into a text field. */
  Typing: 'typing',
  /** Used by the control that has the keyboard. */
  FocusedControl: 'focused-control',
  /** Pressed alone in a modal dialogue. */
  ModalDialogue: 'modal-dialogue',
  /** The chord tracker's. */
  Shortcuts: 'shortcuts',
} as const;

type PressOwner = (typeof PressOwner)[keyof typeof PressOwner];

/**
 * Whose a shortcut press is.
 *
 * Typing into a field is the field's, and gives up a chord in progress: were
 * the chord to survive, a user who pressed the prefix, clicked into a field and
 * typed a name would complete a shortcut with the next Ctrl+X they meant as
 * cut. A key a focused control uses itself is its, unless a chord is waiting
 * for it.
 *
 * A modal dialogue has the keyboard, and the page behind it is inert. A key
 * pressed alone is the dialogue's. A chord is still read, so the browser does
 * not act on it either, and runs only where its command changes how the whole
 * interface is drawn, which the dialogue shows too, as a reader brightening the
 * page to read the dialogue expects; every other shortcut acts on the page
 * behind, or opens something over it, the palette and the settings among them,
 * and is answered with how to use it.
 */
function ownerOf(
  target: EventTarget | null,
  reading: KeyEventReading,
  platform: KeyboardPlatform,
  state: { readonly waiting: boolean; readonly modal: boolean },
): PressOwner {
  if (isTextField(target) && isTypingPress(reading, platform)) return PressOwner.Typing;
  if (state.waiting) return PressOwner.Shortcuts;
  if (ownsItsKeys(target, reading)) return PressOwner.FocusedControl;
  const alone = !reading.ctrlKey && !reading.metaKey && !reading.altKey;
  return state.modal && alone ? PressOwner.ModalDialogue : PressOwner.Shortcuts;
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

  /**
   * Whether a command's shortcut runs while a modal dialogue is open: one that
   * changes only how the whole interface is drawn (see `ownerOf`).
   */
  readonly runsInADialogue: (id: CommandId) => boolean;

  /** How this platform's keyboard uses AltGr, and whether Option types in a field. */
  readonly platform: KeyboardPlatform;

  /** Given every key event read, typing included. */
  readonly reader: KeyReader;

  readonly logger: Logger;
}

/**
 * Does what the chord tracker made of a press: shows a chord building, says one
 * that is not a shortcut, and runs a completed one, each kept from the browser,
 * which would otherwise act on it too.
 */
function answer(
  outcome: ChordOutcome,
  event: KeyboardEvent,
  to: Pick<ShortcutBindingOptions, 'run' | 'onPendingChange' | 'onAnnounce' | 'runsInADialogue'> & {
    readonly modal: boolean;
  },
): void {
  if (outcome.kind === 'pass-through') return;
  event.preventDefault();
  switch (outcome.kind) {
    case 'waiting':
      to.onPendingChange(outcome.presses);
      return;

    case 'abandoned':
      to.onPendingChange([]);
      to.onAnnounce('That key sequence is not a shortcut.', false);
      return;

    case 'run':
      to.onPendingChange([]);
      // A modal dialogue's page is inert, so a chord that acts on it is
      // answered with how to use it rather than run (see `ownerOf`).
      if (to.modal && !to.runsInADialogue(outcome.commandId)) {
        to.onAnnounce('Close the dialogue to use that shortcut.', false, { refusal: true });
        return;
      }
      // A shortcut that appears to do nothing is how a user decides the
      // application is unreliable, so a refusal is said out loud, through the
      // one route every interface caller of the bus takes.
      to.run(outcome.commandId);
      return;
  }
}

/**
 * Listens to the document for shortcuts, and to the window for losing focus,
 * with what `options` gives, until the function it answers is called.
 */
function listen(options: ShortcutBindingOptions): () => void {
  const { tracker, onPendingChange, onChordCancelled, platform, reader, logger } = options;

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

    const waiting = tracker.pending().length > 0;
    const modal = document.querySelector(MODAL_DIALOGUE) !== null;
    const owner = ownerOf(event.target, reading, platform, { waiting, modal });
    if (owner === PressOwner.Typing && waiting) cancelChord();
    if (owner !== PressOwner.Shortcuts) return;

    const outcome = tracker.press(keyPressFromEvent(reading));
    // Away from the editor, a clipboard command's press is the page's, as a
    // field's typing is the field's: it reaches the browser, and a chord it
    // completed is given up, and said to be.
    if (outcome.kind === 'run' && !runsHere(outcome.commandId, event.target)) {
      if (waiting) cancelChord();
      return;
    }
    answer(outcome, event, { ...options, modal });
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
}

/** Listens for shortcuts while the component is mounted. */
export function useShortcuts(options: ShortcutBindingOptions): void {
  const { tracker, run, onPendingChange, onAnnounce, onChordCancelled } = options;
  const { runsInADialogue, platform, reader, logger } = options;

  useEffect(
    () =>
      listen({
        tracker,
        run,
        onPendingChange,
        onAnnounce,
        onChordCancelled,
        runsInADialogue,
        platform,
        reader,
        logger,
      }),
    [
      tracker,
      run,
      onPendingChange,
      onAnnounce,
      onChordCancelled,
      runsInADialogue,
      platform,
      reader,
      logger,
    ],
  );
}
