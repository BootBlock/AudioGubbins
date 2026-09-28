/**
 * The shortcut profiles the user made, as they are stored, and how much of what
 * is stored can be read.
 *
 * Apart from the shortcut store because it is a format of its own, with a key
 * of its own: the store asks it for the profiles it could read and for the
 * text to write. Where a text that could not all be read is kept, and whether
 * the profiles are written meanwhile, is `profile-custody.ts`.
 */

import {
  commandId,
  exportProfile,
  isCommandId,
  restoreProfiles,
  type CommandId,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import type { Logger } from '@audiogubbins/diagnostics';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { DEFAULT_PROFILE_ID } from './default-shortcuts.js';
import type { StateStorage } from './state-storage.js';
import { isRecord, versionFound } from './stored-value.js';

/** Where the profiles the user made are kept. */
export const PROFILES_KEY = 'audiogubbins.shortcuts';

/**
 * What a stored profile collection looks like.
 *
 * Each profile is kept in the same text the user exports, and read back through
 * the same validator an imported file goes through. Storage is a trust boundary
 * too (REQ-EXEC-136.12): another version, another tab or a hand edit can put
 * anything there, and a binding with a malformed press would reach the chord
 * matcher. One format and one validator means there is no second, shallower
 * check to fall out of step with the first.
 */
interface StoredProfiles {
  readonly schemaVersion: number;
  readonly selectedId: string;
  readonly profiles: readonly StoredEntry[];
}

/**
 * One stored profile: its exported text, and the commands in it that still
 * follow the default. Beside the text rather than in it, because it is this
 * store's to know: an exported profile carried to another machine is the
 * bindings it holds.
 */
interface StoredEntry {
  readonly id: string;
  readonly text: string;
  readonly following?: readonly string[];
}

/** Whether a stored entry has the shape the store writes. */
function isStoredEntry(value: unknown): value is StoredEntry {
  const following = isRecord(value) ? value['following'] : undefined;
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['text'] === 'string' &&
    (following === undefined ||
      (Array.isArray(following) && following.every((one) => typeof one === 'string')))
  );
}

/** A profile the user made, and the commands in it that follow the default. */
export interface RestoredProfile {
  readonly profile: ShortcutProfile;
  readonly following: ReadonlySet<CommandId>;
}

/**
 * What of the stored text could not be read: none of it, because it is not a
 * collection of profiles or was written in another format, or some of its
 * entries, and then whether the profile in use was among them.
 */
export type ProfilesDamage =
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'another format' }
  | { readonly kind: 'partial'; readonly unreadable: number; readonly inUseLeftOut: boolean };

/** The stored profiles, as far as this build can read them. */
export interface ReadProfiles {
  /** The profile that was in force, or the built-in one where none can be read. */
  readonly selectedId: string;

  readonly profiles: readonly RestoredProfile[];

  /** The stored text and what of it could not be read, when any of it could not. */
  readonly damaged: { readonly text: string; readonly damage: ProfilesDamage } | undefined;
}

/** What is read where nothing is stored, or nothing stored can be read. */
const NONE_READ = { selectedId: DEFAULT_PROFILE_ID, profiles: [], damaged: undefined } as const;

/**
 * The entries of a stored collection this build can read, each read on its
 * own, so a user with six profiles and one corrupt entry keeps five, and each
 * that failed is named in the log by its place in the list. Each is held
 * beside the profile AudioGubbins ships and those read before it, which is
 * what decides the identifier it is held under, so the list is read whole (see
 * `restoreProfiles`); one stored under an identifier out of the shape one is
 * derived in is one that failed.
 */
function readEntries(
  entries: readonly unknown[],
  shipped: ShortcutProfile,
  logger: Logger,
): readonly RestoredProfile[] {
  // By its place in the list, not its identifier: a profile the user made is
  // identified by the name they typed, and a log goes into a diagnostic bundle
  // by default.
  const leftOut = (index: number, firstProblem: string): void => {
    logger.warning('A stored shortcut profile could not be read and was left out.', {
      position: index + 1,
      firstProblem,
    });
  };

  const stored: (StoredEntry & { readonly index: number })[] = [];
  for (const [index, entry] of entries.entries()) {
    if (isStoredEntry(entry)) stored.push({ ...entry, index });
    else leftOut(index, 'not-a-stored-profile');
  }

  // Read as it was written: what the platform takes is decided on the layout
  // once it is known, and said, not dropped (see `shortcut-layout.ts`).
  const profiles: RestoredProfile[] = [];
  for (const { stored: entry, restored } of restoreProfiles(stored, shipped)) {
    if (!restored.ok) {
      leftOut(entry.index, restored.failures[0].code);
      continue;
    }
    const following = (entry.following ?? []).filter(isCommandId).map(commandId);
    profiles.push({ profile: restored.value, following: new Set(following) });
  }
  return profiles;
}

/** What is read of a stored text that is not a collection of profiles at all. */
function noneReadable(text: string, logger: Logger): ReadProfiles {
  logger.warning('The stored shortcut profiles could not be read, so the defaults are in force.');
  return { ...NONE_READ, damaged: { text, damage: { kind: 'unreadable' } } };
}

/**
 * The profiles the user made, as far as this build can still read them, each
 * under an identifier `shipped` and the others do not hold, and the stored
 * text with what of it could not be read, for the custody to set aside before
 * anything is written over it.
 */
export function readStoredProfiles(
  storage: StateStorage,
  shipped: ShortcutProfile,
  logger: Logger,
): ReadProfiles {
  const text = storage.read(PROFILES_KEY);
  if (text === null) return NONE_READ;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON, so there is nothing more to read; the text is set aside whole.
    parsed = undefined;
  }
  if (!isRecord(parsed)) return noneReadable(text, logger);

  // The version first: a newer format can keep its profiles anywhere.
  if (parsed['schemaVersion'] !== SCHEMA_VERSIONS.shortcutProfile) {
    logger.warning('The stored shortcut profiles were written for another format.', {
      found: versionFound(parsed['schemaVersion']),
      expected: SCHEMA_VERSIONS.shortcutProfile,
    });
    return { ...NONE_READ, damaged: { text, damage: { kind: 'another format' } } };
  }
  const entries = parsed['profiles'];
  if (!Array.isArray(entries)) return noneReadable(text, logger);

  const profiles = readEntries(entries, shipped, logger);
  const stored = parsed['selectedId'];
  const selectedId = typeof stored === 'string' ? stored : DEFAULT_PROFILE_ID;
  const unreadable = entries.length - profiles.length;
  const inUseLeftOut =
    selectedId !== DEFAULT_PROFILE_ID && !profiles.some((one) => one.profile.id === selectedId);
  return {
    selectedId,
    profiles,
    damaged:
      unreadable === 0
        ? undefined
        : { text, damage: { kind: 'partial', unreadable, inUseLeftOut } },
  };
}

/** The text the profiles the user made are stored in, with the one in force. */
export function storedProfilesText(
  profiles: readonly ShortcutProfile[],
  followingOf: (id: string) => ReadonlySet<CommandId>,
  selectedId: string,
): string {
  const value: StoredProfiles = {
    schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
    selectedId,
    profiles: profiles.map((one) => ({
      id: one.id,
      text: exportProfile(one),
      following: [...followingOf(one.id)],
    })),
  };
  return JSON.stringify(value);
}
