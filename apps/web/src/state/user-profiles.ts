/**
 * The shortcut profiles the user made, each with the defaults it follows.
 *
 * A profile the user made is a copy of another. Each binding in it that the
 * user has not changed follows the default as the keyboard layout is learned,
 * and every other stays where the user put it (see `withDefaultsFollowed`).
 *
 * The profiles and what each follows are kept together, because every change to
 * a profile is a change to what it follows: kept apart in the store, the two
 * would have to be written together at every place a profile changes.
 */

import { shortcutKey, type CommandId, type ShortcutProfile } from '@audiogubbins/commands';

import { withDefaultsFollowed } from './shortcut-layout.js';

/** The profiles the user made, and what each follows. */
export interface UserProfiles {
  /** Every profile the user made, in the order they were made. */
  readonly all: () => readonly ShortcutProfile[];

  readonly get: (id: string) => ShortcutProfile | undefined;

  /**
   * Puts a profile in, or replaces the one with its identifier. It follows the
   * defaults in `following` when they are given, and what it followed before
   * when they are not.
   */
  readonly put: (profile: ShortcutProfile, following?: ReadonlySet<CommandId>) => void;

  /** Whether a command's binding in a profile still follows the default. */
  readonly follows: (profileId: string, id: CommandId) => boolean;

  /** The commands whose binding in a profile still follows the default. */
  readonly followingOf: (profileId: string) => ReadonlySet<CommandId>;

  /** Stops a command's binding following the default, as the user has changed it. */
  readonly stopFollowing: (profileId: string, id: CommandId) => void;

  /** Removes a profile. */
  readonly remove: (id: string) => void;

  /**
   * Moves every binding that follows the default to where `shipped` has it,
   * and answers whether any moved.
   */
  readonly follow: (shipped: ShortcutProfile) => boolean;
}

/**
 * Whether two profiles bind the same commands to the same presses, in whatever
 * order each lists them.
 *
 * Compared as the text each exports, the order would count:
 * `withDefaultsFollowed` lists the bindings the user chose before the ones that
 * follow, so the first layout event after any rebind would say a default had
 * moved and write every profile again. A command may be bound twice, which an
 * imported file can carry, so the pairs are counted rather than looked up.
 */
function sameBindings(one: ShortcutProfile, other: ShortcutProfile): boolean {
  const pairs = (profile: ShortcutProfile): readonly string[] =>
    profile.bindings
      .map((binding) => `${binding.commandId} ${shortcutKey(binding.shortcut)}`)
      .sort();

  const mine = pairs(one);
  const theirs = pairs(other);
  return mine.length === theirs.length && mine.every((pair, at) => pair === theirs[at]);
}

/** Holds the profiles the user made, starting from those restored from storage. */
export function createUserProfiles(
  restored: readonly {
    readonly profile: ShortcutProfile;
    readonly following: ReadonlySet<CommandId>;
  }[],
): UserProfiles {
  const profiles = new Map(restored.map((one) => [one.profile.id, one.profile]));
  const following = new Map(restored.map((one) => [one.profile.id, new Set(one.following)]));

  return {
    all: () => [...profiles.values()],
    get: (id) => profiles.get(id),

    put: (profile, followed) => {
      profiles.set(profile.id, profile);
      if (followed !== undefined) following.set(profile.id, new Set(followed));
    },

    follows: (profileId, id) => following.get(profileId)?.has(id) === true,
    followingOf: (profileId) => new Set(following.get(profileId) ?? []),

    stopFollowing: (profileId, id) => {
      following.get(profileId)?.delete(id);
    },

    remove: (id) => {
      following.delete(id);
      profiles.delete(id);
    },

    follow: (shipped) => {
      let moved = false;
      for (const [id, profile] of profiles) {
        const followed = withDefaultsFollowed(profile, following.get(id) ?? new Set(), shipped);
        if (sameBindings(followed, profile)) continue;
        profiles.set(id, followed);
        moved = true;
      }
      return moved;
    },
  };
}
