/**
 * Ephemeral interaction state.
 *
 * REQ-ARCH-153 names this as its own partition, and its lifetime is what makes
 * it one: none of it is stored, and none of it survives a reload. Whether the
 * command palette is open, which chord is half-typed, what the status bar is
 * announcing. Persisting any of it would restore a user into a dialogue they
 * closed hours ago.
 *
 * It is deliberately small. The temptation with a partition like this is to let
 * anything awkward land in it, at which point it becomes the global store
 * REQ-ARCH-153 prohibits. Everything here is interface state with no owner
 * elsewhere, and nothing here is a fact about the user's project.
 */

import type { KeyPress } from '@audiogubbins/input';

import { observable, type Observable } from './observable.js';

/**
 * How an announcement is made.
 *
 * What each of these means for the notice, and what it is when absent, the
 * notice surface decides, once.
 */
export interface AnnouncementOptions {
  /**
   * Whether it is shown as a notice as well as said. Shown by default; not
   * for what the interface already shows in its own place.
   */
  readonly shown?: boolean;

  /**
   * Whether it says why something was not done. Shown for as long as an
   * urgent notice, however it is spoken.
   */
  readonly refusal?: boolean;
}

/**
 * A message shown to the user and announced to a screen reader: the options it
 * was made with, and what to say.
 *
 * Its options are {@link AnnouncementOptions} rather than a second copy of
 * them, so each is declared, and documented, once.
 */
export interface Announcement extends AnnouncementOptions {
  /** British-English text, a sentence. */
  readonly text: string;

  /** Whether it interrupts what a screen reader is reading. */
  readonly urgent: boolean;

  /** Distinguishes one announcement from an identical earlier one. */
  readonly sequence: number;
}

/** What the user is currently doing with the interface. */
export interface InteractionState {
  /** Whether the command palette is open. */
  readonly paletteOpen: boolean;

  /** Whether the settings dialogue is open. */
  readonly settingsOpen: boolean;

  /**
   * Whether the diagnostic export dialogue is open.
   *
   * A dialogue of its own rather than a section of the settings, because it is
   * where the user consents to something leaving the application, and consent
   * has to be the one thing on screen when it is given (REQ-PRIV-161).
   */
  readonly diagnosticExportOpen: boolean;

  /**
   * The presses of a chord in progress, for the hint the status bar shows.
   *
   * Empty when no chord is waiting. A user who has pressed Ctrl+K needs to see
   * that something is waiting, or the next key they press will seem to do
   * nothing (REQ-UX-066).
   */
  readonly pendingChord: readonly KeyPress[];

  /**
   * The key the settings ask the reader to press with Command now, to learn
   * how their system reads one, by its code; `undefined` while none is asked.
   *
   * The keyboard keeps the browser from acting on that press only while it is
   * asked for, and reads which key is asked here, so the settings' answer is
   * the keyboard's. At any other time the same press is the browser's, and on
   * plain Dvorak it is Copy, which a reader's first copy has to reach.
   */
  readonly commandPressKeyAsked: string | undefined;

  /** The most recent announcement, or `undefined`. */
  readonly announcement?: Announcement;
}

/** Nothing is happening. */
const INITIAL: InteractionState = {
  paletteOpen: false,
  settingsOpen: false,
  diagnosticExportOpen: false,
  pendingChord: [],
  commandPressKeyAsked: undefined,
};

/** Holds ephemeral interface state. */
export interface InteractionStore extends Observable<InteractionState> {
  readonly setPaletteOpen: (open: boolean) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly setDiagnosticExportOpen: (open: boolean) => void;
  readonly setPendingChord: (presses: readonly KeyPress[]) => void;
  readonly askForCommandPress: (code: string | undefined) => void;

  /**
   * Says something to the user.
   *
   * Each announcement carries a sequence number, so saying the same thing twice
   * is two announcements. Without it, a screen reader reading a live region
   * would stay silent the second time because the text has not changed, and the
   * user would not be told that their second attempt also failed.
   */
  readonly announce: (text: string, urgent?: boolean, options?: AnnouncementOptions) => void;
}

/** Creates the interaction store. */
export function createInteractionStore(): InteractionStore {
  const state = observable(INITIAL);
  let sequence = 0;

  return {
    get: state.get,
    subscribe: state.subscribe,

    setPaletteOpen: (open) => {
      state.update((current) => ({ ...current, paletteOpen: open }));
    },

    setSettingsOpen: (open) => {
      state.update((current) => ({ ...current, settingsOpen: open }));
    },

    setDiagnosticExportOpen: (open) => {
      state.update((current) => ({ ...current, diagnosticExportOpen: open }));
    },

    askForCommandPress: (code) => {
      state.update((current) => ({ ...current, commandPressKeyAsked: code }));
    },

    setPendingChord: (presses) => {
      state.update((current) => ({ ...current, pendingChord: presses }));
    },

    announce: (text, urgent = false, options = {}) => {
      sequence += 1;
      state.update((current) => ({
        ...current,
        announcement: { ...options, text, urgent, sequence },
      }));
    },
  };
}
