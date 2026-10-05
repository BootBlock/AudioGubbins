/**
 * The shortcut partition: which profile is in force, and what it binds.
 *
 * REQ-UX-066 states that users must be able to fully remap shortcuts, and names
 * import and export of profiles, named profiles, conflict detection and reset
 * to defaults. The rules for each are `@audiogubbins/commands`', an identifier
 * and a name no other profile has among them; this store holds the profiles the
 * user made and the one in force, hands the rules every profile it holds, and
 * writes back what they answer, so every surface reads one profile in force
 * rather than a constant of its own.
 *
 * Separate from preferences (REQ-ARCH-153) because the lifetimes and the
 * failure modes differ. A dropped preference write costs an accent colour; a
 * dropped shortcut write costs a profile someone spent an afternoon building.
 */

import { DEFAULT_PROFILE_ID } from './default-shortcuts.js';
import {
  NAMES_CANNOT_BE_COMPARED,
  duplicateProfile,
  exportProfile,
  findShortcutConflicts,
  importProfile,
  rebind,
  unbind,
  type CommandId,
  type KeyboardConvention,
  type Shortcut,
  type ShortcutConflict,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import type { Logger } from '@audiogubbins/diagnostics';
import type { KeyboardLayout } from '@audiogubbins/input';

import { observable, type Observable } from './observable.js';
import { takeProfileCustody } from './profile-custody.js';
import { reasonsOf, type Reasons } from './reasons.js';
import { noNoticeAbout, type Notice } from './recovery-notices.js';
import {
  platformSplit,
  shippedDefaults,
  type ReservedBinding,
  type WaitingDefault,
} from './shortcut-layout.js';
import { readStoredProfiles, storedProfilesText } from './stored-profiles.js';
import { PersistedPart, type StateStorage } from './state-storage.js';
import {
  notDiscarded,
  nothingUnreadAbout,
  unreadNow,
  type Discarded,
  type UnreadCopy,
  type UnreadText,
} from './text-custody.js';
import { createUserProfiles } from './user-profiles.js';
import { quoted } from '@audiogubbins/text';

/** What the shortcut store holds. */
export interface ShortcutState {
  /** The profile in force. */
  readonly profile: ShortcutProfile;

  /** Every profile the user can switch to, the built-in one first. */
  readonly available: readonly ShortcutProfile[];

  /**
   * Every conflict in the profile in force.
   *
   * Computed here rather than by each surface, so the editor, a future menu and
   * any warning all agree about what is in conflict (REQ-UX-066).
   */
  readonly conflicts: readonly ShortcutConflict[];

  /**
   * Every binding in the profile in force that the platform takes on the
   * keyboard layout as it is known, with the reason. Said rather than dropped:
   * the layout becomes known as the user types, and a binding checked when it
   * was made can be taken on the layout found later.
   */
  readonly reserved: readonly ReservedBinding[];

  /**
   * The profile in force with each binding the platform takes left out: what
   * the keyboard answers to, so a press the settings call taken reaches the
   * browser rather than a command.
   */
  readonly usable: ShortcutProfile;

  /**
   * Each default of the profile in force that has no key yet, with the
   * characters whose keys it waits for: the layout shows them as the user
   * types them.
   */
  readonly waiting: readonly WaitingDefault[];

  /**
   * What could not be read of the stored profiles and where its text is, until
   * the user dismisses it. A profile left out of the list is work the user made
   * (REQ-UX-066), and is said rather than missed; dismissing the notice keeps
   * the text as it was (see `profile-custody.ts`).
   */
  readonly recovery: Notice | undefined;

  /**
   * Whether the text that could not be read waits for room to be set aside,
   * so the profiles are written nowhere until it is. Apart from the notice,
   * because it holds after the user has dismissed it.
   */
  readonly waitsForRoom: boolean;

  /**
   * How much there is of the text that could not be read, where there is any:
   * set aside in this session or an earlier one, or held where it was found.
   * Apart from the notice, because it is there to export or discard whether
   * or not the notice still stands.
   */
  readonly unread: readonly UnreadText[];
}

/** Holds the shortcut profiles and writes them back. */
export interface ShortcutStore extends Observable<ShortcutState> {
  /**
   * Binds a command to a shortcut, replacing whatever it had.
   *
   * A built-in profile cannot be edited, so editing one copies it first and
   * switches to the copy. "Duplicate it first" is an answer for whoever wrote
   * the store, not for someone who has just pressed a key combination.
   */
  readonly rebind: (id: CommandId, value: Shortcut) => Reasons | undefined;

  /** Removes every binding for a command. Copies a built-in profile first. */
  readonly unbind: (id: CommandId) => Reasons | undefined;

  /**
   * Copies the profile in force and switches to the copy, named `displayName`
   * or, where nobody chose a name, the first free name for a copy; or says why
   * not, a name another profile has among the reasons.
   */
  readonly duplicate: (displayName?: string) => string | undefined;

  /** Switches to a profile by identifier. */
  readonly switchTo: (id: string) => string | undefined;

  /** Why a profile cannot be deleted, or `undefined` when it can. */
  readonly removalProblem: (id: string) => string | undefined;

  /** Deletes a profile the user made. */
  readonly remove: (id: string) => string | undefined;

  /** Returns to the profile AudioGubbins ships with. */
  readonly resetToDefaults: () => void;

  /** The profile in force, as the text a user exports. */
  readonly exported: () => string;

  /** Reads an exported profile, adds it and switches to it. */
  readonly imported: (text: string) => ImportOutcome;

  /**
   * Puts away the notice about the stored profiles once the user has seen it,
   * or says why not: a notice that is not showing cannot be dismissed.
   */
  readonly acknowledgeRecovery: () => string | undefined;

  /** Why there is nothing of the profiles' text that could not be read, or `undefined`. */
  readonly unreadProblem: () => string | undefined;

  /** Every text of the profiles' that could not be read, as it is exported. */
  readonly unreadCopies: () => readonly UnreadCopy[];

  /**
   * Discards every text of the profiles' that could not be read, puts away
   * the notice, which speaks of text that is gone, and writes the profiles,
   * which the text may have kept back: what the user is told comes of it, or
   * why it was refused.
   */
  readonly discardUnread: () => Discarded | string;
}

/**
 * What reading an exported profile produced: refused, with every reason, or in
 * force, with the name of the profile it is numbered apart from and the
 * commands whose bindings the platform takes.
 *
 * A shape per answer, so a caller has to say which it is reading before it can
 * read anything: a refusal carries no list of taken commands, which an empty
 * one would make read as a profile in force with nothing taken.
 */
export type ImportOutcome =
  | { readonly kind: 'refused'; readonly refusal: Reasons }
  | {
      readonly kind: 'in force';

      /**
       * The name of the profile that has the name the file gives, which the
       * one imported is numbered apart from, or `undefined` where it keeps
       * the name the file gives.
       */
      readonly namesake: string | undefined;

      /**
       * Commands whose binding the browser or the system takes on the keyboard
       * layout as it is known, kept and said rather than dropped, for the
       * reason `readProfile` gives. The Shortcuts settings list these with
       * their reasons, and say them again as the layout is learned.
       */
      readonly reservedCommands: readonly string[];
    };

/** The refusal for a profile identifier nothing is stored under, written once. */
function noProfileWith(id: string): string {
  return `There is no shortcut profile with the identifier "${id}".`;
}

/**
 * Creates the shortcut store.
 *
 * The profile it ships is built for the keyboard layout as it is known, and
 * built again whenever more of the layout becomes known, so a default is on
 * the key that types its character (see `default-shortcuts.ts`). In a profile
 * the user made, a binding still equal to the default moves with it, and every
 * other binding is the key they pressed and stays where it is.
 */
export function createShortcutStore(
  convention: KeyboardConvention,
  layout: Observable<KeyboardLayout>,
  storage: StateStorage,
  logger: Logger,
): ShortcutStore {
  const defaults = shippedDefaults(convention, layout.get);
  const stored = readStoredProfiles(storage, defaults.profile(), logger);
  const custody = takeProfileCustody(storage, stored.damaged, logger);
  let recovery = custody.notice();
  let unread = unreadNow([], [custody.unread()]);

  const userProfiles = createUserProfiles(stored.profiles);

  const all = (): readonly ShortcutProfile[] => [defaults.profile(), ...userProfiles.all()];

  const { selectedId } = stored;
  const initial =
    (selectedId === DEFAULT_PROFILE_ID ? undefined : userProfiles.get(selectedId)) ??
    defaults.profile();

  /** Everything the store says about a profile in force. */
  const stateOf = (profile: ShortcutProfile): ShortcutState => ({
    profile,
    available: all(),
    conflicts: findShortcutConflicts(profile),
    ...platformSplit(profile, convention, layout.get()),
    waiting: defaults.waitingIn(profile, (id) => userProfiles.follows(profile.id, id)),
    recovery,
    waitsForRoom: custody.waitsForRoom(),
    unread,
  });

  const state = observable<ShortcutState>(stateOf(initial));

  /**
   * Writes the profiles, with the one in force, and brings the notice up to
   * date with where the text that could not be read is now, while it shows.
   */
  const persist = (inForce: string): void => {
    custody.save(storedProfilesText(userProfiles.all(), userProfiles.followingOf, inForce));
    if (recovery !== undefined) recovery = custody.notice();
    unread = unreadNow(unread, [custody.unread()]);
  };

  const unreadProblem = (): string | undefined =>
    unread.length === 0 ? nothingUnreadAbout('profiles') : undefined;

  // The store lives as long as the application, so the subscription does too.
  layout.subscribe(() => {
    defaults.place();
    const moved = userProfiles.follow(defaults.profile());

    const inForce = state.get().profile;
    if (moved) persist(inForce.id);
    state.set(
      stateOf((inForce.builtIn ? undefined : userProfiles.get(inForce.id)) ?? defaults.profile()),
    );
  });

  /**
   * Why a profile cannot be deleted, or `undefined` when it can. No advice to
   * reset: the built-in profile is the defaults, so while it is the one in
   * force there is nothing to reset to, and such advice would point at a button
   * that cannot be used.
   */
  const removalProblem = (id: string): string | undefined => {
    if (id === DEFAULT_PROFILE_ID) return 'The built-in profile cannot be deleted.';
    return userProfiles.get(id) === undefined ? noProfileWith(id) : undefined;
  };

  /** Puts a profile in force and writes everything back. */
  const adopt = (profile: ShortcutProfile): void => {
    if (!profile.builtIn) userProfiles.put(profile);

    persist(profile.id);
    state.set(stateOf(profile));
  };

  /**
   * The profile to edit, copying the built-in one when that is what is in
   * force, or why no copy can be made.
   *
   * Copying rather than refusing is the whole difference between a shortcut
   * editor and a store method: a user who presses a key combination expects the
   * key combination, not a lecture about built-in profiles. The one refusal is
   * where this browser cannot compare names, which the copy's name needs, read
   * from the failure the command layer answers, so the built-in shortcuts stay
   * as they ship and the reason is said.
   */
  const editable = (): { readonly profile: ShortcutProfile } | { readonly refusal: Reasons } => {
    const current = state.get().profile;
    if (!current.builtIn) return { profile: current };

    const copy = duplicateProfile(current, all());
    if (!copy.ok) {
      if (copy.failures.some((failure) => failure.code === NAMES_CANNOT_BE_COMPARED)) {
        return { refusal: reasonsOf(copy.failures) };
      }
      // Nobody chose the name: it is the first free one for a copy, within
      // the rule for a profile's name and had by no other profile, so any
      // other refusal is a mistake in the rules rather than anything a user
      // did.
      throw new Error(
        `The copy of the built-in shortcuts was refused: ${copy.failures[0].summary}`,
      );
    }
    // Every default follows the layout in the copy until the user changes it,
    // those the layout does not yet show a key for included.
    userProfiles.put(copy.value, defaults.everyDefault());
    adopt(copy.value);
    return { profile: copy.value };
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    rebind: (id, value) => {
      // Decided against the profile as it stands, before anything is copied.
      //
      // A refusal has to leave everything as it was: copying first would put a
      // user who pressed a reserved combination into a profile they never asked
      // for, with nothing in it changed.
      const current = state.get().profile;
      const decided = rebind({ ...current, builtIn: false }, id, value, convention, layout.get());
      if (!decided.ok) return reasonsOf(decided.failures);

      const edited = editable();
      if ('refusal' in edited) return edited.refusal;
      userProfiles.stopFollowing(edited.profile.id, id);
      adopt({ ...edited.profile, bindings: decided.value.bindings });
      return undefined;
    },

    unbind: (id) => {
      const current = state.get().profile;
      const decided = unbind({ ...current, builtIn: false }, id);
      if (!decided.ok) return reasonsOf(decided.failures);

      const edited = editable();
      if ('refusal' in edited) return edited.refusal;
      userProfiles.stopFollowing(edited.profile.id, id);
      adopt({ ...edited.profile, bindings: decided.value.bindings });
      return undefined;
    },

    duplicate: (displayName) => {
      const current = state.get().profile;
      const copy = duplicateProfile(current, all(), displayName);
      if (!copy.ok) return copy.failures[0].summary;

      userProfiles.put(
        copy.value,
        current.builtIn ? defaults.everyDefault() : userProfiles.followingOf(current.id),
      );
      adopt(copy.value);
      return undefined;
    },

    switchTo: (id) => {
      const profile = id === DEFAULT_PROFILE_ID ? defaults.profile() : userProfiles.get(id);
      if (profile === undefined) return noProfileWith(id);
      if (profile.id === state.get().profile.id) {
        return `${quoted(profile.displayName)} is already in use.`;
      }

      adopt(profile);
      return undefined;
    },

    removalProblem,

    remove: (id) => {
      const problem = removalProblem(id);
      if (problem !== undefined) return problem;
      userProfiles.remove(id);

      // Deleting the profile in force would leave the user with no shortcuts at
      // all, so they go back to the ones AudioGubbins ships with.
      adopt(state.get().profile.id === id ? defaults.profile() : state.get().profile);
      return undefined;
    },

    resetToDefaults: () => {
      adopt(defaults.profile());
    },

    exported: () => exportProfile(state.get().profile),

    imported: (text) => {
      const result = importProfile(text, all());
      if (!result.ok) return { kind: 'refused', refusal: reasonsOf(result.failures) };

      adopt(result.value.profile);
      return {
        kind: 'in force',
        namesake: result.value.namesake?.displayName,
        reservedCommands: state.get().reserved.map((one) => one.commandId),
      };
    },

    acknowledgeRecovery: () => {
      if (recovery === undefined) return noNoticeAbout('profiles');

      // Dismissing destroys nothing: the text is set aside, or held where it
      // was found and set aside by the first write that finds room for it.
      recovery = undefined;
      state.set({ ...state.get(), recovery });
      return undefined;
    },

    unreadProblem,

    unreadCopies: custody.copies,

    discardUnread: () => {
      const problem = unreadProblem();
      if (problem !== undefined) return problem;
      const discarded = custody.discard();
      if (discarded === undefined) return notDiscarded('profiles');

      recovery = undefined;
      const { profile } = state.get();
      persist(profile.id);
      state.set(stateOf(profile));

      // Said to be kept again only where the write that follows was kept: one
      // refused has told the user so already.
      const kept = !storage.get().unsaved.includes(PersistedPart.Shortcuts);
      return { keptAgain: kept ? discarded.keptAgain : undefined };
    },
  };
}
