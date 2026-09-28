/**
 * Where the workspace's texts that hold something nobody has read are kept,
 * and what is written while one of them cannot be kept yet.
 *
 * Three texts can hold such a thing: the mounted layout's, when it could not be
 * used; the collection's; and a copy of the collection written beside it. Each
 * is set aside before anything is written over it. One that cannot be, at the
 * quota, is left where it is and nothing is written over it, and every write of
 * the workspace tries again to set it aside, as the next start does (see
 * `text-custody.ts`). What a write keeps back is worded from every part it
 * keeps back, so the sentence for one part never speaks for the other.
 *
 * Apart from the workspace store, which asks it what to write and what each
 * notice says, and knows nothing of setting text aside.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { LayoutSource, type ResolvedLayout } from '@audiogubbins/workspace';

import type { Notice, RecoveryPart } from './recovery-notices.js';
import type { StateStorage, Withheld, WriteAccount } from './state-storage.js';
import { MOUNTED_KEY } from './stored-layout.js';
import {
  NO_ROOM,
  factWithNoRoom,
  holdTexts,
  triesAgain,
  whereTheTextIs,
  type Unread,
} from './text-custody.js';
import {
  COLLECTION_KEY,
  RECOVERED_COLLECTION_KEY,
  collectionDamage,
  isDamaged,
  type StoredCollection,
} from './workspace-collection.js';

/**
 * Where the text of a mounted layout that could not be used is set aside,
 * before anything is written over it.
 *
 * Its own key is written with the next change the reader makes, and the layout
 * on it may be the only copy there is: one mounted while its collection could
 * not be written is listed nowhere else. Added to, never written over (see
 * `StateStorage.keepAside`).
 */
const LAYOUT_SET_ASIDE_KEY = 'audiogubbins.workspace.unreadable';

/**
 * Where every damaged text of the collection is set aside: the collection's
 * own, and a damaged copy's written beside it.
 *
 * Added to, never written over, before anything can be written over the text
 * itself (see `StateStorage.keepAside`). After that the collection is written
 * and read as it always is: nothing the user saves waits on the notice, and
 * dismissing the notice destroys nothing. One key for both, so everything of
 * the collection that nobody has read is in one list.
 */
const SET_ASIDE_KEY = 'audiogubbins.workspaces.unreadable';

/** That AudioGubbins tries again to set the workspace's text aside, and when. */
const TRIES_AGAIN = triesAgain('you change a workspace');

/** A thing said of the mounted layout alone, of the collection alone, or of both. */
interface ByPart<T> {
  readonly layout: T;
  readonly collection: T;
  readonly both: T;
}

/** What is said of the parts named, or `undefined` when none is. */
function saidOf<T>(parts: ReadonlySet<RecoveryPart>, words: ByPart<T>): T | undefined {
  if (parts.has('layout')) return parts.has('collection') ? words.both : words.layout;
  return parts.has('collection') ? words.collection : undefined;
}

/**
 * Why a part is written nowhere while every place it could go holds text
 * nobody has read, and what the user is told: only what is withheld is said
 * not to be kept, and a part written beside it is said to be kept.
 *
 * Told over the change the user has just made, so it says that fact and that
 * AudioGubbins tries again, and no more: the advice on making room stands in
 * the status bar for as long as it applies.
 */
const NOT_KEPT: ByPart<Withheld> = {
  layout: {
    reason: 'there is no room to set the unreadable workspace aside',
    told: `The workspace on screen cannot be kept until there is room to set aside the one that could not be read, though the workspaces you save are. ${TRIES_AGAIN}`,
  },
  collection: {
    reason: 'there is no room to set the unreadable workspaces aside',
    told: `The workspaces you save cannot be kept until there is room to set aside what could not be read, though the workspace on screen is. ${TRIES_AGAIN}`,
  },
  both: {
    reason: 'there is no room to set the unreadable workspace and workspaces aside',
    told: `Neither the workspace on screen nor the workspaces you save can be kept until there is room to set aside what could not be read. ${TRIES_AGAIN}`,
  },
};

/** What the user is told once a write keeps a part that was written nowhere. */
const KEPT_AGAIN: ByPart<string> = {
  layout:
    'There is room now to set aside the workspace that could not be read, so the workspace on screen is kept again.',
  collection:
    'There is room now to set aside the workspaces that could not be read, so the workspaces you save are kept again.',
  both: 'There is room now to set aside what could not be read, so the workspace on screen and the workspaces you save are kept again.',
};

/**
 * What the user is told about a mounted layout that could not be used.
 *
 * That AudioGubbins tries again is said once: in the notice about the
 * collection, when that has no room either. The two notices stand one above
 * the other, and said in each, the same sentence would be read twice.
 */
function layoutNotice(reason: string, setAside: boolean, triesAgainBelow: boolean): Notice {
  const where = whereTheTextIs(setAside, NO_ROOM);
  return {
    fact: setAside ? reason : factWithNoRoom(reason, 'The workspace on screen'),
    consequences: setAside || triesAgainBelow ? where : `${where} ${TRIES_AGAIN}`,
    waitsForRoom: !setAside,
  };
}

/**
 * What the user is told about a damaged collection, or a damaged copy beside
 * it, or `undefined` when neither is.
 */
function collectionNotice(
  { collection, copy }: StoredCollection,
  collectionFree: boolean,
  copyFree: boolean,
): Notice | undefined {
  const copyDamaged = isDamaged(copy);
  const copyKept = copyFree
    ? 'What could not be read of them is kept aside.'
    : 'What could not be read of them is left where it is.';

  if (!isDamaged(collection)) {
    return copyDamaged
      ? {
          fact: 'Some of the workspaces you saved in an earlier session could not be read, so they are not listed.',
          consequences: copyKept,
          waitsForRoom: false,
        }
      : undefined;
  }

  const waitsForRoom = !collectionFree && !copyFree;
  const where = whereTheTextIs(
    collectionFree,
    copyFree ? 'what you save is kept beside it' : NO_ROOM,
  );
  const retry = waitsForRoom ? ` ${TRIES_AGAIN}` : '';
  const since = copyDamaged
    ? ` Some of the workspaces you saved since could not be read either, so they are not listed. ${copyKept}`
    : '';

  const damage = collectionDamage(collection.parsed);
  return {
    fact: waitsForRoom ? factWithNoRoom(damage, 'The workspaces you save now') : damage,
    consequences: where + retry + since,
    waitsForRoom,
  };
}

/** One write of the workspace, every key in one call. */
export interface WorkspaceWrite {
  /** The keys to write, `null` to remove. */
  readonly entries: Readonly<Record<string, string | null>>;

  /** What the write keeps back, and what it keeps again, for the user. */
  readonly account: WriteAccount;
}

/** The custody of the workspace's texts, as the workspace store uses it. */
export interface WorkspaceCustody {
  /** What a part's notice says now, or `undefined` when there is nothing to say. */
  readonly notice: (part: RecoveryPart) => Notice | undefined;

  /**
   * Whether a part is written nowhere until there is room to set a text aside,
   * whether or not its notice still stands.
   */
  readonly waitsForRoom: () => boolean;

  /**
   * What to write the mounted layout and the collection under, after trying
   * again to set aside each text that is not set aside yet.
   *
   * The mounted layout in its own place once its damaged text is set aside,
   * and nowhere while it is not. The collection in its own place once its
   * damaged text is set aside; beside it while that text is held in place,
   * unless a damaged copy is there already and could not be set aside either:
   * then nowhere, because every place it could go holds text nobody has read.
   */
  readonly write: (layout: string, collection: string) => WorkspaceWrite;

  /**
   * Told which keys of that write were refused. Only once the collection's own
   * key was kept is a copy written beside it in an earlier session removed:
   * removed in the same write, it would go even when the collection's own write
   * was refused, and the workspaces it held with it.
   */
  readonly written: (refused: readonly string[]) => void;
}

/**
 * What is stored beside the collection: no copy; a copy written with every
 * write of the collection; or one to remove with the next, because a write
 * since kept the collection's own key.
 */
type CopyBeside = 'none' | 'in step' | 'removable';

/**
 * Where a write puts the collection, given which of its texts are held:
 * nowhere, while both are; beside its own place, while only its own is; in its
 * own place, leaving a held copy alone; or in its own place with nothing held,
 * the one write that may touch the copy.
 */
type CollectionWrite = 'nowhere' | 'beside' | 'own place, copy held' | 'own place';

/** Where a write puts the collection, given which of its texts are held. */
function collectionWrite(collectionHeld: boolean, copyHeld: boolean): CollectionWrite {
  if (collectionHeld) return copyHeld ? 'nowhere' : 'beside';
  return copyHeld ? 'own place, copy held' : 'own place';
}

/**
 * The keys a write of the collection's text goes under.
 *
 * While the copy is still there it holds the same text, and goes only in a
 * later write. Left as it was for the one write before it can be removed, it
 * would be a copy older than the collection: a workspace deleted in that write
 * would be merged back in from it by the next start.
 */
function entriesOf(
  write: CollectionWrite,
  copy: CopyBeside,
  saved: string,
): Readonly<Record<string, string | null>> {
  switch (write) {
    case 'nowhere':
      return {};
    case 'beside':
      return { [RECOVERED_COLLECTION_KEY]: saved };
    case 'own place, copy held':
      return { [COLLECTION_KEY]: saved };
    case 'own place': {
      const beside =
        copy === 'none' ? {} : { [RECOVERED_COLLECTION_KEY]: copy === 'removable' ? null : saved };
      return { [COLLECTION_KEY]: saved, ...beside };
    }
  }
}

/**
 * What is stored beside the collection after a write, given where it put the
 * collection and which keys were refused.
 *
 * A copy written beside the collection is kept in step from then on, refused
 * or not: one that could be there is never left older than the collection. It
 * becomes removable once a write with nothing held keeps the collection's own
 * key, and goes once a later one removes it. Removed in the collection's own
 * write rather than a write of its own: a removal of its own that succeeded
 * would take the part off the list of what is not being kept, though the write
 * before it was refused.
 */
function copyAfter(
  copy: CopyBeside,
  write: CollectionWrite,
  refused: readonly string[],
): CopyBeside {
  if (write === 'beside') return 'in step';
  if (write !== 'own place') return copy;
  switch (copy) {
    case 'in step':
      return refused.includes(COLLECTION_KEY) ? 'in step' : 'removable';
    case 'removable':
      return refused.includes(RECOVERED_COLLECTION_KEY) ? 'removable' : 'none';
    case 'none':
      return 'none';
  }
}

/** Where the collection is written, and when the copy beside it goes. */
interface CollectionPlace {
  /** The keys to write the collection's text under, given which texts are held. */
  readonly entries: (
    saved: string,
    collectionHeld: boolean,
    copyHeld: boolean,
  ) => Readonly<Record<string, string | null>>;

  /** Told which keys of the last write were refused. */
  readonly written: (refused: readonly string[]) => void;
}

/**
 * Places the collection's text: in its own place once its damaged text is set
 * aside, beside it while that text is held, and nowhere while a damaged copy
 * beside it is held too. The copy can go once nothing in it can be lost, and in
 * a write after one that kept the collection's own key (see {@link copyAfter}).
 */
function placeCollection(copyThere: boolean): CollectionPlace {
  let copy: CopyBeside = copyThere ? 'in step' : 'none';
  let last: CollectionWrite = 'nowhere';

  return {
    entries: (saved, collectionHeld, copyHeld) => {
      last = collectionWrite(collectionHeld, copyHeld);
      return entriesOf(last, copy, saved);
    },

    written: (refused) => {
      copy = copyAfter(copy, last, refused);
    },
  };
}

/** Each text of the workspace that could need setting aside. */
type TextName = 'layout' | 'collection' | 'copy';

/**
 * Every text that holds something no list shows, and so is to be set aside
 * before anything can be written over it, in the order each is tried.
 *
 * A copy this build could read whole needs nothing more: every one of its
 * workspaces is in the list, two under one identifier among them (see
 * `readCollection`), and is written into the collection. One that could not
 * all be read is set aside before anything can remove it, because the part
 * that could not be read is in no list. A whole collection whose entries the
 * copy replaces is set aside as a damaged one is.
 */
function textsToSetAside(
  { collection, copy, replaced }: StoredCollection,
  mounted: ResolvedLayout,
): ReadonlyMap<TextName, Unread> {
  const texts = new Map<TextName, Unread>();
  if (collection !== undefined && (isDamaged(collection) || replaced > 0)) {
    texts.set('collection', { key: SET_ASIDE_KEY, text: collection.text });
  }
  if (isDamaged(copy)) texts.set('copy', { key: SET_ASIDE_KEY, text: copy.text });
  if (mounted.source === LayoutSource.Recovered) {
    texts.set('layout', { key: LAYOUT_SET_ASIDE_KEY, text: mounted.text });
  }
  return texts;
}

/** The parts written nowhere, because every place each could go holds unread text. */
function withheldParts(isHeld: (name: TextName) => boolean): ReadonlySet<RecoveryPart> {
  const parts = new Set<RecoveryPart>();
  if (isHeld('layout')) parts.add('layout');
  if (isHeld('collection') && isHeld('copy')) parts.add('collection');
  return parts;
}

/**
 * Sets aside every text that holds something no list shows, before anything
 * can be written over it, and keeps track of where each text is.
 */
export function takeCustody(
  storage: StateStorage,
  stored: StoredCollection,
  mounted: ResolvedLayout,
  logger: Logger,
): WorkspaceCustody {
  const texts = holdTexts(storage, logger, textsToSetAside(stored, mounted), {
    withheld: withheldParts,
    notKept: (parts) => saidOf(parts, NOT_KEPT),
    keptAgain: (parts) => saidOf(parts, KEPT_AGAIN),
  });
  const place = placeCollection(stored.copy !== undefined);

  return {
    notice: (part) =>
      part === 'collection'
        ? collectionNotice(stored, !texts.isHeld('collection'), !texts.isHeld('copy'))
        : mounted.source === LayoutSource.Recovered
          ? layoutNotice(
              mounted.reason,
              !texts.isHeld('layout'),
              withheldParts(texts.isHeld).has('collection'),
            )
          : undefined,

    waitsForRoom: texts.waitsForRoom,

    write: (layout, saved) => {
      const account = texts.beforeWrite();
      return {
        entries: {
          ...(texts.isHeld('layout') ? {} : { [MOUNTED_KEY]: layout }),
          ...place.entries(saved, texts.isHeld('collection'), texts.isHeld('copy')),
        },
        account,
      };
    },

    written: (refused) => {
      texts.written(refused);
      place.written(refused);
    },
  };
}
