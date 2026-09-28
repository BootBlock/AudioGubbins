/**
 * What becomes of a shortcut profile as the keyboard layout becomes known.
 *
 * The layout is learned while the application runs (see
 * `keyboard-layout-store.ts`), and a profile can be made, and stored, before it
 * is. Three things follow. A default is placed again as more of the layout is
 * known, and one whose character's key is not known yet waits for it, and is
 * said to. A default copied into a profile the user made is still the default
 * until they change it, and moves with it: left at the US position it was
 * copied at before the layout was known, the chord prefix on Dvorak would sit
 * on the key the browser reads as Ctrl+T. And a binding the platform takes on
 * the layout as it now is has to be said, not dropped, for the reason
 * `readProfile` in the command package gives.
 */

import {
  describeShortcut,
  platformReservation,
  type CommandId,
  type KeyboardConvention,
  type Shortcut,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import { UNKNOWN_LAYOUT, type KeyboardLayout } from '@audiogubbins/input';

import { defaultShortcutProfile, placeDefaults } from './default-shortcuts.js';

/** A default left out until the layout shows the keys that type its characters. */
export interface WaitingDefault {
  readonly commandId: CommandId;

  /** The characters whose keys are not known yet, as they are typed. */
  readonly characters: readonly string[];

  /**
   * Whether this default waits for a press made with Command to show how the
   * system reads the layout.
   *
   * A different press settles this than settles {@link characters}, so the two
   * are said apart: told of a key to press for this, a user who pressed it
   * would see nothing happen. Whether, and not which key: one qualifying press
   * settles the reading for every waiting default at once, and which key can
   * make one is the layout's to answer (`commandLayerKeys` in the input
   * package). Carrying the characters this default's own binding waits on, the
   * settings would name the first of them in sort order, and on Apple hardware
   * that is the comma, which no reading of a Command press is taken from.
   */
  readonly waitsForCommandLayer: boolean;
}

/** The defaults AudioGubbins ships, placed on the layout as it is known. */
export interface ShippedDefaults {
  /** The default profile: the defaults whose keys are known. */
  readonly profile: () => ShortcutProfile;

  /** Places the defaults again, on the layout as it is now known. */
  readonly place: () => void;

  /**
   * The defaults a profile follows that have no key yet, with the characters
   * they wait for. The built-in profile follows all of them.
   */
  readonly waitingIn: (
    profile: ShortcutProfile,
    follows: (id: CommandId) => boolean,
  ) => readonly WaitingDefault[];

  /** Every command the defaults bind, wherever the layout lets each go. */
  readonly everyDefault: () => Set<CommandId>;
}

/** Places the defaults on the layout `layout` answers with, and again on each `place`. */
export function shippedDefaults(
  convention: KeyboardConvention,
  layout: () => KeyboardLayout,
): ShippedDefaults {
  let placement = placeDefaults(convention, layout());

  return {
    profile: () => placement.profile,
    place: () => {
      placement = placeDefaults(convention, layout());
    },
    waitingIn: (profile, follows) => {
      const ids = new Set([...placement.waiting.keys(), ...placement.waitingForCommandLayer]);
      return [...ids]
        .filter((id) => profile.builtIn || follows(id))
        .map((commandId) => ({
          commandId,
          characters: placement.waiting.get(commandId) ?? [],
          waitsForCommandLayer: placement.waitingForCommandLayer.has(commandId),
        }));
    },
    everyDefault: () =>
      new Set(
        defaultShortcutProfile(convention, UNKNOWN_LAYOUT).bindings.map((one) => one.commandId),
      ),
  };
}

/** A binding the platform takes on the layout as it is known, and what it is taken for. */
export interface ReservedBinding {
  readonly commandId: CommandId;
  readonly shortcut: Shortcut;

  /** What takes it, as a sentence, with the shortcut written for this layout. */
  readonly reason: string;
}

/** A profile split by what the platform takes on this layout. */
export interface PlatformSplit {
  /**
   * The profile with every taken binding left out: what the keyboard answers
   * to, and what is offered as a shortcut to press.
   */
  readonly usable: ShortcutProfile;

  /** Every binding the platform takes, with what takes it. */
  readonly reserved: readonly ReservedBinding[];
}

/**
 * Which of a profile's bindings the platform takes on this layout, and which
 * are left.
 *
 * Both halves in one pass, because the one caller needs both and they are the
 * same question: the state the store publishes carries the taken bindings for
 * the settings to list and the usable profile for the keyboard to answer. Read
 * apart, the whole reservation table would be walked over every binding twice
 * on every state the store builds, which is every key press whose reading is
 * new.
 *
 * A binding the platform takes is kept in the profile rather than dropped,
 * because the keyboard layout becomes known as the user types and dropping it
 * would lose it for good. It is not answered to, though: answered to, it would
 * override the browser where the browser lets a page keep the press, so an
 * imported binding on Ctrl+Equal would run its command and the page would no
 * longer zoom, while the settings say the press does not reach AudioGubbins. It
 * comes back as soon as the layout shows it free.
 */
export function platformSplit(
  profile: ShortcutProfile,
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): PlatformSplit {
  const kept: ShortcutProfile['bindings'][number][] = [];
  const reserved: ReservedBinding[] = [];

  for (const binding of profile.bindings) {
    const reservation = platformReservation(binding.shortcut, convention, layout);
    if (reservation === undefined) {
      kept.push(binding);
      continue;
    }
    reserved.push({
      commandId: binding.commandId,
      shortcut: binding.shortcut,
      reason: `${describeShortcut({ presses: [reservation.press] }, convention, layout)}: ${reservation.reason}`,
    });
  }

  return { usable: { ...profile, bindings: kept }, reserved };
}

/**
 * A profile the user made, with each command that still follows the default
 * bound as the default now is: moved with it, and left out with it where the
 * layout does not yet show its key. Every other binding is what the user
 * chose, and stays where they put it.
 *
 * Which commands follow is recorded rather than worked out from the bindings:
 * compared with the default as it was placed before, a default left out while
 * the layout is partly known could not be told from one the user has removed,
 * so a binding the user removed would come back.
 */
export function withDefaultsFollowed(
  profile: ShortcutProfile,
  following: ReadonlySet<CommandId>,
  shipped: ShortcutProfile,
): ShortcutProfile {
  const chosen = profile.bindings.filter((binding) => !following.has(binding.commandId));
  const defaults = shipped.bindings.filter((binding) => following.has(binding.commandId));
  return { ...profile, bindings: [...chosen, ...defaults] };
}
