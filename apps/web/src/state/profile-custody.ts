/**
 * Where the stored shortcut profiles' text is kept when this build cannot read
 * all of it, and what is written while it cannot be kept yet.
 *
 * The profiles that could be read are listed and written again; what could not
 * be read is in no list, and the first rebind, switch, copy, import or reset
 * writes over it. So the text is set aside whole before anything is written
 * over it, as the workspaces' is. One that cannot be, at the quota, is left
 * where it is, the profiles are written nowhere over it, and every write of
 * them tries again to set it aside, as the next start does (see
 * `text-custody.ts`).
 *
 * Apart from the shortcut store, which hands it the text to write and asks
 * what the notice says, and knows nothing of setting text aside.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import type { Notice } from './recovery-notices.js';
import { PersistedPart, type StateStorage, type Withheld } from './state-storage.js';
import { PROFILES_KEY, type ProfilesDamage, type ReadProfiles } from './stored-profiles.js';
import {
  NO_ROOM,
  factWithNoRoom,
  holdTexts,
  triesAgain,
  whereTheTextIs,
  type Unread,
} from './text-custody.js';

/**
 * Where the text of the stored profiles is set aside when this build cannot
 * read all of it. Added to, never written over (see `StateStorage.keepAside`).
 */
const PROFILES_SET_ASIDE_KEY = 'audiogubbins.shortcuts.unreadable';

/** That AudioGubbins tries again to set the profiles' text aside, and when. */
const TRIES_AGAIN = triesAgain('you change your shortcuts');

/**
 * Why the profiles are written nowhere, and what the user is told: over the
 * change they have just made, so the fact and that AudioGubbins tries again,
 * and no more (see `NOTHING_MAKES_ROOM_SAFELY`).
 */
const NOT_KEPT: Withheld = {
  reason: 'there is no room to set the unreadable shortcut profiles aside',
  told: `Changes to your shortcuts cannot be kept until there is room to set aside the shortcut profiles that could not be read. ${TRIES_AGAIN}`,
};

/** What the user is told once a write keeps the profiles again. */
const KEPT_AGAIN =
  'There is room now to set aside the shortcut profiles that could not be read, so changes to your shortcuts are kept again.';

/** What could not be read, and the shortcuts in force for it. */
function damageSaid(damage: ProfilesDamage): string {
  switch (damage.kind) {
    case 'unreadable':
      return 'The shortcut profiles you made could not be read, so the default shortcuts are in force.';
    case 'another format':
      return 'The shortcut profiles you made were written in another format, one this version of AudioGubbins cannot read, so the default shortcuts are in force.';
    case 'partial': {
      const one = damage.unreadable === 1;
      const which = one
        ? 'One of the shortcut profiles you made could not be read, so it is not listed.'
        : `${String(damage.unreadable)} of the shortcut profiles you made could not be read, so they are not listed.`;
      if (!damage.inUseLeftOut) return which;
      return one
        ? `${which} It was the one in use, so the default shortcuts are in force.`
        : `${which} The one in use was among them, so the default shortcuts are in force.`;
    }
  }
}

/** What the user is told about the profiles' text, set aside or not. */
function profilesNotice(damage: ProfilesDamage, setAside: boolean): Notice {
  const where = whereTheTextIs(setAside, NO_ROOM);
  const fact = damageSaid(damage);
  return {
    fact: setAside ? fact : factWithNoRoom(fact, 'Changes to your shortcuts'),
    consequences: setAside ? where : `${where} ${TRIES_AGAIN}`,
    waitsForRoom: !setAside,
  };
}

/** The custody of the stored profiles' text, as the shortcut store uses it. */
export interface ProfileCustody {
  /** What the notice says now, or `undefined` when everything could be read. */
  readonly notice: () => Notice | undefined;

  /**
   * Whether the profiles are written nowhere until there is room to set their
   * text aside, whether or not the notice still stands.
   */
  readonly waitsForRoom: () => boolean;

  /**
   * Writes the profiles' text, after trying again to set aside the text that
   * could not be read, and writes nothing over that text while it is where it
   * was found: the storage then lists the profiles as not being kept, and the
   * user is told why.
   */
  readonly save: (text: string) => void;
}

/** The one text of the profiles that can be held, and the one part it keeps back. */
type TextName = 'profiles';

/**
 * Sets aside the stored profiles' text when any of it could not be read,
 * before anything can be written over it, and keeps track of where it is.
 */
export function takeProfileCustody(
  storage: StateStorage,
  damaged: ReadProfiles['damaged'],
  logger: Logger,
): ProfileCustody {
  const texts = new Map<TextName, Unread>();
  if (damaged !== undefined) {
    texts.set('profiles', { key: PROFILES_SET_ASIDE_KEY, text: damaged.text });
  }
  const held = holdTexts(storage, logger, texts, {
    withheld: (isHeld) => new Set<TextName>(isHeld('profiles') ? ['profiles'] : []),
    notKept: (parts) => (parts.size === 0 ? undefined : NOT_KEPT),
    keptAgain: (parts) => (parts.size === 0 ? undefined : KEPT_AGAIN),
  });

  return {
    notice: () =>
      damaged === undefined ? undefined : profilesNotice(damaged.damage, !held.isHeld('profiles')),

    waitsForRoom: held.waitsForRoom,

    save: (text) => {
      const account = held.beforeWrite();
      const entries = held.isHeld('profiles') ? {} : { [PROFILES_KEY]: text };
      held.written(storage.save(PersistedPart.Shortcuts, entries, account));
    },
  };
}
