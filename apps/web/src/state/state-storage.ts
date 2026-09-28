/**
 * Writing the shell's state to storage, and telling the user when it fails.
 *
 * A store that caught its own write failure and logged a warning would leave
 * nothing else to happen: a user in private browsing, or with a full quota,
 * would rearrange their workspace, build a shortcut profile and choose an
 * accent, and find all of it gone on the next visit with no sign that anything
 * had been wrong. A failure to write a part is told as a stored layout that
 * cannot be read is told.
 *
 * One object does every write, so there is one catch, and the answer to "is my
 * work being kept?" has one home. A part whose write fails is reported once,
 * when it starts failing, and stays listed until a write to it succeeds.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import { observable, type Observable } from './observable.js';

/**
 * Where text is kept between visits, by key.
 *
 * The raw port. A read never throws; a write throws when the text could not be
 * kept, and `StateStorage` below is what catches it, so no store handles a
 * storage failure of its own.
 */
export interface KeyValueStorage {
  /** The stored text, or `null` if there is none or it cannot be read. */
  readonly read: (key: string) => string | null;

  /** Stores text. Throws if it cannot. */
  readonly write: (key: string, value: string) => void;

  /** Removes what is stored under a key, if anything is. Throws if it cannot. */
  readonly remove: (key: string) => void;
}

/**
 * Storage backed by the browser's local storage.
 *
 * A read is guarded, because private browsing and blocked storage make reading
 * throw, and the answer then is that nothing was stored. A write is not: it
 * throws to `StateStorage`, which tells the user their change will not be kept.
 * A browser that refuses storage is still one AudioGubbins runs in, with state
 * that lasts only until the tab closes.
 */
export function browserStorage(): KeyValueStorage {
  return {
    read(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Nothing to recover: the answer is that nothing was stored.
        return null;
      }
    },

    write(key, value) {
      window.localStorage.setItem(key, value);
    },

    remove(key) {
      window.localStorage.removeItem(key);
    },
  };
}

/** A part of the shell's state that is stored on its own. */
export const PersistedPart = {
  Preferences: 'preferences',
  Workspace: 'workspace',
  Shortcuts: 'shortcuts',
  Verbosity: 'verbosity',
  KeyboardLayout: 'keyboard-layout',
} as const;

/** A part of the shell's state that is stored on its own. */
export type PersistedPart = (typeof PersistedPart)[keyof typeof PersistedPart];

/**
 * Parts AudioGubbins works out for itself, which the user never changed.
 *
 * What the keyboard types is learned from the browser's layout map and from
 * typing, and is kept only to save learning it again. Told as a change of
 * theirs, a user who had changed nothing would hear an urgent "your changes
 * will not survive a reload" at the first key they pressed, and the status bar
 * would list "keyboard layout" among what was not being saved, with nothing
 * they could do about either (REQ-ARCH-153 keeps derived state apart from
 * theirs).
 */
const LEARNED_PARTS: ReadonlySet<PersistedPart> = new Set([PersistedPart.KeyboardLayout]);

/** What the user calls each part. */
const PART_NAMES: Record<PersistedPart, string> = {
  [PersistedPart.Preferences]: 'appearance settings',
  [PersistedPart.Workspace]: 'workspaces',
  [PersistedPart.Shortcuts]: 'shortcut profiles',
  [PersistedPart.Verbosity]: 'diagnostic log levels',
  [PersistedPart.KeyboardLayout]: 'keyboard layout',
};

/** Why a caller keeps back some of a write, and what the user is told about it. */
export interface Withheld {
  /** Why, for the log. */
  readonly reason: string;

  /** What is not being kept, in a sentence or two the user reads. */
  readonly told: string;
}

/** What a caller says of a write beyond the keys in it. */
export interface WriteAccount {
  /** Why some of the part is kept back although nothing refused it, when some is. */
  readonly withheld?: Withheld;

  /**
   * What the user is told once this write is kept, when it keeps what earlier
   * writes kept back: they were told it could not be kept, and are told when
   * it is. Said only when no key of the write is refused.
   */
  readonly resumed?: string;
}

/** Which parts are not reaching storage. */
export interface PersistenceState {
  /** In the order they started failing. Empty while everything is kept. */
  readonly unsaved: readonly PersistedPart[];
}

/** Reads and writes the shell's state, and says which parts are not kept. */
export interface StateStorage extends Observable<PersistenceState> {
  /** The stored text, or `null` when there is none or it cannot be read. */
  readonly read: (key: string) => string | null;

  /**
   * Stores text for a part, reporting a failure rather than throwing it.
   *
   * The change the user made has already taken effect on screen by the time
   * this runs; a failure costs them the change at the next visit, and they are
   * told so now.
   *
   * Every key of the part at once, because a part is kept or not kept as a
   * whole. Written one key at a time, a part whose first write failed and whose
   * second succeeded would be added to the list and taken off it again inside
   * one event, so the status bar would never show it while the user's
   * workspaces were not being kept.
   *
   * `null` removes a key. Answers with the keys that were refused, so a caller
   * can make a later write depend on one key of this one: an answer for the
   * whole part would let a refused key elsewhere in it keep a copy the kept key
   * had made stale.
   *
   * The account's `withheld` says why the part is not being kept although
   * nothing refused it: a caller that has nowhere to write some of it says so
   * there, and the part is listed as it would be after a refusal. Without it, a
   * collection written nowhere would be announced as saved, and the status bar
   * would say nothing. The user is told what the caller says is not kept,
   * unless a key was refused as well: told the whole part was lost, a user
   * whose arrangement on screen is kept would hear that it will not survive a
   * reload.
   */
  readonly save: (
    part: PersistedPart,
    entries: Readonly<Record<string, string | null>>,
    account?: WriteAccount,
  ) => readonly string[];

  /**
   * Adds text that could not be read to the texts set aside under a key, and
   * answers whether it is there now.
   *
   * Added, never written over: written over, a later damage would replace the
   * text set aside before it, which nobody had read yet. The key holds a list;
   * text already in it is not added twice, so text still damaged at the next
   * start is set aside once.
   *
   * Outside every part: a refusal is the caller's to report, in the notice
   * about that text. Reported as a part that was not saved, it would tell a
   * user who had not changed anything yet that their changes would not survive
   * a reload, beside a notice saying the opposite.
   */
  readonly keepAside: (key: string, text: string) => boolean;
}

/**
 * The texts set aside under a key, as `keepAside` stores them.
 *
 * A list of strings. Anything else found there is kept as one text, so a key
 * damaged in its turn loses nothing to the next text added.
 */
export function textsSetAside(stored: string | null): readonly string[] {
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((one) => typeof one === 'string')) return parsed;
  } catch {
    // Not a list this code wrote, so it is kept whole as one text.
  }
  return [stored];
}

/**
 * Adds a text to those set aside under a key, and answers whether it is there.
 *
 * Read back rather than assumed: a write refused at the quota leaves the text
 * out, and the caller keeps it where it was found.
 */
function setAside(storage: KeyValueStorage, logger: Logger, key: string, text: string): boolean {
  const kept = (): readonly string[] => textsSetAside(storage.read(key));
  if (kept().includes(text)) return true;
  try {
    storage.write(key, JSON.stringify([...kept(), text]));
  } catch (error) {
    // Refused as readily as any write at the quota; the read below says so.
    logger.warning('Text that could not be read could not be set aside.', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }
  return kept().includes(text);
}

/** What the status bar says while something is not being kept. */
export function describeUnsaved(unsaved: readonly PersistedPart[]): string {
  return `Not being saved: ${unsaved.map((part) => PART_NAMES[part]).join(', ')}`;
}

/**
 * Creates the storage every store writes through.
 *
 * `tell` is how the user hears about a failure: the composition root passes the
 * announcement channel, which is both spoken and shown.
 */
export function createStateStorage(
  storage: KeyValueStorage,
  logger: Logger,
  tell: (text: string) => void,
): StateStorage {
  const state = observable<PersistenceState>({ unsaved: [] });

  return {
    get: state.get,
    subscribe: state.subscribe,
    read: storage.read,

    save: (part, entries, account = {}) => {
      const { withheld } = account;
      const refused: string[] = [];
      let failure = withheld?.reason;

      for (const [key, value] of Object.entries(entries)) {
        try {
          if (value === null) storage.remove(key);
          else storage.write(key, value);
        } catch (error) {
          // A quota failure or a blocked store costs the user this change at
          // the next visit and nothing else, so it is reported rather than
          // thrown: the change they just made has to keep working on screen.
          // Every key is attempted, because one refused key is no reason to
          // abandon the others.
          refused.push(key);
          failure ??= error instanceof Error ? error.message : 'unknown';
        }
      }

      const { unsaved } = state.get();
      const resumed = refused.length === 0 ? account.resumed : undefined;

      if (failure !== undefined) {
        logger.warning('A change could not be stored, so it will not survive a reload.', {
          part,
          reason: failure,
        });

        // A part AudioGubbins learned for itself is not the user's to lose, so
        // it is neither listed as unsaved nor announced: it is learned again.
        if (LEARNED_PARTS.has(part)) return refused;

        // What is still kept back is told when the part starts failing, and
        // what this write keeps again in the same announcement: each replaces
        // the one before it, so two in a row would say only the second.
        const starting = !unsaved.includes(part);
        if (starting) state.set({ unsaved: [...unsaved, part] });
        const lost = !starting
          ? undefined
          : withheld !== undefined && refused.length === 0
            ? withheld.told
            : `Your ${PART_NAMES[part]} could not be saved, so your changes will not survive a reload.`;
        const said = [resumed, lost].filter((one) => one !== undefined).join(' ');
        if (said !== '') tell(said);
        return refused;
      }

      if (unsaved.includes(part)) {
        state.set({ unsaved: unsaved.filter((one) => one !== part) });
      }
      if (resumed !== undefined) tell(resumed);
      return refused;
    },

    keepAside: (key, text) => setAside(storage, logger, key, text),
  };
}
