/**
 * Keeping text nobody has read until it is set aside, and how the user is told
 * where it is.
 *
 * A store that finds stored text it cannot read holds that text where it is,
 * sets it aside before anything is written over it, and, at the quota, writes
 * nothing over it and tries again with every write. What such a write keeps
 * back is said to the user when it starts, and what a later write keeps again
 * is said once it is kept. The workspace and the shortcut profiles each keep
 * such text; which texts, which parts of theirs a held text keeps back, and
 * what is said of those parts are theirs (`workspace-custody.ts`,
 * `profile-custody.ts`). Where the text is, and that AudioGubbins tries again,
 * are worded here once for both, from the nouns each store passes.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import type { StateStorage, Withheld, WriteAccount } from './state-storage.js';

/** A text nobody has read, and the key it is set aside under. */
export interface Unread {
  readonly key: string;
  readonly text: string;
}

/**
 * Where a text nobody has read is, as its notice says it: kept aside, or left
 * where it was found. Left there, `meanwhile` says what comes of what the user
 * changes, kept beside it, or that there is no room (see {@link NO_ROOM}).
 */
export function whereTheTextIs(setAside: boolean, meanwhile: string): string {
  return setAside
    ? 'The text that could not be read is kept aside.'
    : `The text that could not be read is left where it is, and ${meanwhile}.`;
}

/**
 * Why a text is left where it is at the quota, as {@link whereTheTextIs}
 * finishes it. What that costs the user is said in the notice's fact (see
 * {@link factWithNoRoom}), and not again here.
 */
export const NO_ROOM = 'there is no room to set it aside';

/**
 * The fact of a notice whose text is left where it is for want of room: what
 * could not be read, then what cannot be kept until there is room, from the
 * noun for it as it opens a sentence, "The workspace on screen".
 *
 * Said in the fact rather than with where the text is, because the start
 * announcement says every notice's fact, however few words the facts leave for
 * the rest: what the user is losing is never the part left to the status bar.
 */
export function factWithNoRoom(fact: string, notKept: string): string {
  return `${fact} ${notKept} cannot be kept until there is room.`;
}

/**
 * That AudioGubbins tries again to set the text aside, and when. `eachTime`
 * names the change of the user's that writes the store, as "you change a
 * workspace": named as a change saved, beside a sentence saying the change
 * cannot be kept, it would say both.
 */
export function triesAgain(eachTime: string): string {
  return `AudioGubbins tries again each time ${eachTime}, and at the next start.`;
}

/**
 * Which parts of a store a write keeps back while texts are held, and what the
 * user is told about them.
 */
export interface HeldTextAccounting<Name extends string, Part> {
  /** The parts written nowhere, given which texts are still held. */
  readonly withheld: (isHeld: (name: Name) => boolean) => ReadonlySet<Part>;

  /** What a write that keeps back these parts says, or `undefined` for none. */
  readonly notKept: (parts: ReadonlySet<Part>) => Withheld | undefined;

  /** What a write that keeps these parts again says, or `undefined` for none. */
  readonly keptAgain: (parts: ReadonlySet<Part>) => string | undefined;
}

/** The custody of a store's texts that nobody has read. */
export interface HeldTexts<Name extends string> {
  /** Whether a text is still where it was found, not set aside yet. */
  readonly isHeld: (name: Name) => boolean;

  /**
   * Whether a part is written nowhere until there is room to set a text aside,
   * so something the user changes cannot be kept until there is.
   */
  readonly waitsForRoom: () => boolean;

  /**
   * Tries again to set aside each text still held, and answers what the write
   * that follows keeps back and keeps again, for the user.
   */
  readonly beforeWrite: () => WriteAccount;

  /**
   * Told which keys of that write were refused. A part is said to be kept
   * again only by a write kept whole, as the storage says it, so a write with
   * a refused key leaves it to be said by the next.
   */
  readonly written: (refused: readonly string[]) => void;
}

/**
 * Sets aside each text given, as far as there is room, and holds the rest.
 *
 * Each set-aside is read back to be sure (see `StateStorage.keepAside`): a
 * browser at its quota refuses it as readily as anything else, and a copy
 * assumed rather than checked is how text is lost. One refused at the start is
 * said in the store's notice about it rather than as a change that was not
 * saved, because the user has not changed anything yet. Tried again as often
 * as a write asks: a text already set aside is not added twice.
 */
export function holdTexts<Name extends string, Part>(
  storage: StateStorage,
  logger: Logger,
  texts: ReadonlyMap<Name, Unread>,
  accounting: HeldTextAccounting<Name, Part>,
): HeldTexts<Name> {
  const held = new Map(texts);

  /** Sets aside each text still held, and answers the names of those it set aside. */
  const setAside = (): readonly Name[] => {
    const now: Name[] = [];
    for (const [name, unread] of held) {
      if (!storage.keepAside(unread.key, unread.text)) continue;
      held.delete(name);
      now.push(name);
    }
    return now;
  };

  setAside();
  const isHeld = (name: Name): boolean => held.has(name);

  // The parts the user was told cannot be kept, those of them the user has
  // since been told are kept again, and those the last write keeps again.
  const withheldAtStart = accounting.withheld(isHeld);
  const toldKeptAgain = new Set<Part>();
  let keptAgain: ReadonlySet<Part> = new Set();

  return {
    isHeld,

    waitsForRoom: () => accounting.withheld(isHeld).size > 0,

    beforeWrite: () => {
      for (const name of setAside()) {
        logger.info('Text that could not be read is set aside now.', { text: name });
      }
      const keptBack = accounting.withheld(isHeld);
      keptAgain = new Set(
        [...withheldAtStart].filter((part) => !keptBack.has(part) && !toldKeptAgain.has(part)),
      );

      const notKept = accounting.notKept(keptBack);
      const resumed = accounting.keptAgain(keptAgain);
      return {
        ...(notKept === undefined ? {} : { withheld: notKept }),
        ...(resumed === undefined ? {} : { resumed }),
      };
    },

    written: (refused) => {
      if (refused.length === 0) for (const part of keptAgain) toldKeptAgain.add(part);
    },
  };
}
