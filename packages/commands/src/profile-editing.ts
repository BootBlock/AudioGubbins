/**
 * Changing a shortcut profile: binding, unbinding and copying.
 *
 * REQ-UX-066 requires full remapping. Each change returns a new profile, or a
 * refusal that says why, and never edits the profile it was given: the store
 * decides what is in force, and a refused change has to leave it as it was.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { KeyboardLayout } from '@audiogubbins/input';
import { namesCanBeCompared, namesHeldBy } from '@audiogubbins/text';

import type { CommandId } from './command.js';
import { addedTo } from './held-profiles.js';
import { describeReservation, platformReservation } from './platform-reservations.js';
import { nameFailure, nameOfACopy, namingRefused, profileName } from './profile-name.js';
import {
  shortcutKey,
  type KeyboardConvention,
  type Shortcut,
  type ShortcutProfile,
} from './shortcut.js';

/**
 * The refusal for a change to a profile AudioGubbins ships.
 *
 * One refusal, written once for rebinding and unbinding alike, because two
 * wordings of one rule drift apart.
 */
function builtInIsReadOnly(profile: ShortcutProfile): DomainFailure {
  return failure(
    'shortcut.built-in-profile-is-read-only',
    FailureKind.Conflict,
    'A built-in profile cannot be changed. Duplicate it first.',
    { details: { profileId: profile.id } },
  );
}

/**
 * Adds or replaces a binding, returning a new profile.
 *
 * Rebinding a command replaces every binding it had. A user remapping Save
 * expects the old shortcut to stop saving, not to keep working alongside the
 * new one. The convention and the layout are the platform the profile is being
 * edited on, which is what decides which presses its browser takes.
 */
export function rebind(
  profile: ShortcutProfile,
  id: CommandId,
  value: Shortcut,
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): DomainResult<ShortcutProfile> {
  if (profile.builtIn) return fail(builtInIsReadOnly(profile));

  const reservation = platformReservation(value, convention, layout);
  if (reservation !== undefined) {
    return fail(
      failure(
        'shortcut.reserved-by-platform',
        FailureKind.Rejected,
        describeReservation(reservation, convention, layout),
        { details: { shortcut: shortcutKey(value) } },
      ),
    );
  }

  return succeed({
    ...profile,
    bindings: [
      ...profile.bindings.filter((binding) => binding.commandId !== id),
      { commandId: id, shortcut: value },
    ],
  });
}

/** Removes every binding for a command, returning a new profile. */
export function unbind(profile: ShortcutProfile, id: CommandId): DomainResult<ShortcutProfile> {
  if (profile.builtIn) return fail(builtInIsReadOnly(profile));

  return succeed({
    ...profile,
    bindings: profile.bindings.filter((binding) => binding.commandId !== id),
  });
}

/**
 * Copies a profile, so it can be edited, beside the profiles `held`: under an
 * identifier none of them holds, named `displayName`, or where nobody chose a
 * name, the first free name for a copy (see `nameOfACopy`).
 *
 * Refuses a name the copy could not be read back with, or one a profile in
 * `held` has, compared as a reader hears the two (see `addedTo`), and any copy
 * where this runtime cannot compare names (see `namesCanBeCompared`). The names
 * held are read once for the numbering of a copy nobody named (see
 * `namesHeldBy`).
 */
export function duplicateProfile(
  profile: ShortcutProfile,
  held: readonly ShortcutProfile[],
  displayName?: string,
): DomainResult<ShortcutProfile> {
  if (!namesCanBeCompared()) return fail(namingRefused());
  const given = displayName ?? nameOfACopy(profile, namesHeldBy(held).taken);
  const name = profileName(given);
  if (typeof name !== 'string') return fail(nameFailure(name));

  return addedTo(held, { displayName: name, bindings: [...profile.bindings] });
}
