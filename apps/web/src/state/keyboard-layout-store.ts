/**
 * What the user's keyboard layout types on each key, as far as it is known.
 *
 * Its own partition, because the shortcut labels, the platform's reservations
 * and the default profile all read it, and it changes on its own: it is taken
 * whole from the browser's layout map where the browser gives one, and learned
 * a key at a time from what the user types everywhere else (see
 * `keyboard-layout.ts` in the input package for why it matters).
 *
 * Kept between visits, so a visit starts from the layout the last one learned.
 * Started from nothing, a browser with no layout map would read every keyboard
 * as a US one until the user had typed, and the defaults, and those that follow
 * them in a profile the user made, would move away from where they had been
 * placed and back again one key at a time.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { KeyboardConvention } from '@audiogubbins/commands';
import {
  UNKNOWN_LAYOUT,
  commandLayerOf,
  couldBeTyped,
  keyboardLayout,
  typedCharacterOf,
  withLearned,
  type KeyEventReading,
  type KeyboardLayout,
  type TypedKey,
} from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { observable, type Observable } from './observable.js';
import { PersistedPart, type StateStorage } from './state-storage.js';
import { isRecord } from './stored-value.js';

/** Where what is known of the layout is kept between visits. */
const STORAGE_KEY = 'audiogubbins.keyboard-layout';

/** The layout as it is known, and the two ways it becomes known. */
export interface KeyboardLayoutStore extends Observable<KeyboardLayout> {
  /**
   * Learns what a key event shows the layout types, when it shows something
   * not known already. A key already known to type something else is learned
   * again, as a user who changes layout presses it.
   */
  readonly learn: (reading: KeyEventReading) => void;

  /** Takes what a layout map says each key types, over what was learned. */
  readonly adopt: (pairs: Iterable<readonly [string, string]>) => void;
}

/** What a stored layout says: each key with the character it types, and how it reads Command. */
interface StoredLayout {
  readonly keys: readonly TypedKey[];
  readonly commandByPosition: boolean | undefined;
}

/** A stored layout that says nothing. */
const NOTHING_STORED: StoredLayout = { keys: [], commandByPosition: undefined };

/**
 * What a stored layout says: the keys it names, each with the character it
 * types, and whether it reads a Command press by position.
 *
 * Every pair is read as a key event's would be ({@link couldBeTyped}): a key of
 * the writing block typing one character a reader sees. Were only the shape
 * `[string, string]` checked, any stored text at all would become a key's
 * label, however the storage came by it. A pair that fails is dropped rather
 * than taken as a reason to forget the rest, since what is dropped is learned
 * again the next time that key is pressed.
 *
 * Stored text that cannot be read at all is reported, as the shortcut, the
 * preference and the workspace stores report theirs: unreported, nothing would
 * say a word, and the next write would overwrite it. The report gives a fixed
 * reason and never the parser's message, which quotes the start of the text it
 * could not read.
 */
function readStored(storage: StateStorage, logger: Logger): StoredLayout {
  const text = storage.read(STORAGE_KEY);
  if (text === null) return NOTHING_STORED;

  const unreadable = (reason: string): StoredLayout => {
    logger.warning('The stored keyboard layout could not be read, so it is learned again.', {
      reason,
    });
    return NOTHING_STORED;
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreadable('not JSON');
  }

  if (!isRecord(parsed)) return unreadable('not an object');
  if (parsed['schemaVersion'] !== SCHEMA_VERSIONS.keyboardLayout)
    return unreadable('another version');
  const keys = parsed['keys'];
  if (!Array.isArray(keys)) return unreadable('no list of keys');

  const listed: readonly unknown[] = keys;
  return {
    keys: listed.flatMap((entry) => {
      if (!Array.isArray(entry)) return [];
      const pair: readonly unknown[] = entry;
      const [code, character] = pair;
      if (typeof code !== 'string' || typeof character !== 'string') return [];
      if (!couldBeTyped(code, character)) return [];
      const typed: TypedKey = [code, character];
      return [typed];
    }),
    // Both answers are kept, and anything else is unread: a layout stored
    // before the layer was read says nothing about it, which is not the same
    // as saying it does not switch.
    commandByPosition:
      typeof parsed['commandByPosition'] === 'boolean' ? parsed['commandByPosition'] : undefined,
  };
}

/**
 * Creates the store, knowing what the last visit learned, read from `storage`
 * and written back to it as more is known.
 */
export function createKeyboardLayoutStore(
  storage: StateStorage,
  logger: Logger,
  convention: KeyboardConvention,
): KeyboardLayoutStore {
  // The ⌘ layer is a macOS arrangement and exists nowhere else. Asked on every
  // platform, a Windows-key or Super-key press reports `metaKey` like a
  // Command press, and a system that reported a different letter under it
  // would set the flag that blanks every key label held with Meta.
  const readsCommandLayer = convention === KeyboardConvention.Apple;
  let known: readonly TypedKey[] = [];
  const stored = readStored(storage, logger);
  let commandByPosition = stored.commandByPosition;

  /** Records one key, and answers whether it changed what is known. */
  const record = (code: string, typed: string): boolean => {
    const next = withLearned(known, code, typed);
    if (next === known) return false;
    known = next;
    return true;
  };

  // Through the learning rule, not straight in: a stored capital names the key
  // typed without Shift, and taken as it stood, the same key typed later would
  // look like something new at every visit.
  for (const [code, character] of stored.keys) record(code, character);

  const state = observable<KeyboardLayout>(
    known.length === 0 && commandByPosition === undefined
      ? UNKNOWN_LAYOUT
      : keyboardLayout(known, { commandByPosition }),
  );

  /**
   * Publishes what is known, and keeps it for the next visit.
   *
   * Written in the order of the keys' codes, not the order they were learned.
   * The order carries nothing, since a key is unique in both directions, and
   * written as learned it would record the order the user first typed each
   * letter in: on a browser with no layout map, typing a name would write its
   * letters out in order, into a file kept between visits.
   */
  const publish = (): void => {
    state.set(keyboardLayout(known, { commandByPosition }));
    storage.save(PersistedPart.KeyboardLayout, {
      [STORAGE_KEY]: JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.keyboardLayout,
        keys: [...known].sort(([one], [other]) => (one < other ? -1 : 1)),
        ...(commandByPosition === undefined ? {} : { commandByPosition }),
      }),
    });
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    learn: (reading) => {
      const typed = typedCharacterOf(reading);
      const learned = typed !== undefined && record(...typed);

      // What a Command press types says whether the layout switches under
      // Command, and is learned before the press is matched as a shortcut: the
      // first Command+V on "Dvorak – QWERTY ⌘" moves the chord prefix off that
      // key before the press is read, so the paste goes through.
      const layer = readsCommandLayer ? commandLayerOf(reading, state.get()) : undefined;
      const switches = layer === undefined ? commandByPosition : layer === 'another layout';
      const moved = switches !== commandByPosition;
      commandByPosition = switches;

      if (learned || moved) publish();
    },

    adopt: (pairs) => {
      let changed = false;
      for (const [code, character] of pairs) {
        if (couldBeTyped(code, character)) changed = record(code, character) || changed;
      }
      if (changed) publish();
    },
  };
}
