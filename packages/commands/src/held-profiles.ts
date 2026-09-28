/**
 * What a shortcut profile is held under beside the others: an identifier the
 * text package's rule allocates, within the room the name of the file a
 * profile is exported to leaves it, and for a name given to a profile, one no
 * other profile has as a reader hears it.
 *
 * Apart from the operations that make a profile, because both rules read every
 * profile held and neither is an operation: copying one, importing one and
 * restoring a stored one each ask them. The caller hands in the profiles it
 * holds and chooses no identifier, so no profile it is given can land on
 * another's. A stored profile's name is its own, however the others are named.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { holderOf, identifierRule, namesHeldBy, utf8Bytes } from '@audiogubbins/text';

import { nameInUse, nameOfAnImport } from './profile-name.js';
import type { ShortcutBinding, ShortcutProfile } from './shortcut.js';

/**
 * A profile as a text holds it or a copy takes it: a name, held to the rule
 * for one, and bindings. No identifier, which is the holder's to give, and
 * never built in, which only a profile AudioGubbins ships is.
 */
export interface WrittenProfile {
  readonly displayName: string;
  readonly bindings: readonly ShortcutBinding[];
}

/** What a profile's identifier is derived as where its name leaves nothing to derive one from. */
const NO_IDENTIFIER_IN_THE_NAME = 'profile';

/**
 * The longest name, in UTF-8 bytes, the common file systems give a file: they
 * count a name in bytes, and a browser shortens or renames a download whose
 * name is longer, so the file saved is not the file named.
 */
const LONGEST_FILE_NAME = 255;

/**
 * What the name of the file a profile is exported to carries after the
 * profile's identifier (see `exportFileName`).
 */
export const EXPORT_FILE_ENDING = '.audiogubbins-shortcuts.json';

/**
 * The rule a profile's identifier is held to: within the longest name a file
 * system gives a file, less {@link EXPORT_FILE_ENDING}, so the file a profile
 * is exported to is saved under the name it is given, however long the
 * profile's name, numbered or not. Derived from the ending, so a longer ending
 * lowers the bound with it.
 */
const PROFILE_IDENTIFIERS = identifierRule(LONGEST_FILE_NAME - utf8Bytes(EXPORT_FILE_ENDING));

/** `written` as the user's, beside those `held`, under an identifier none of them holds. */
function heldBeside(held: readonly ShortcutProfile[], written: WrittenProfile): ShortcutProfile {
  const id = PROFILE_IDENTIFIERS.identifiersHeldBy(held, NO_IDENTIFIER_IN_THE_NAME).forName(
    written.displayName,
  );
  return { ...written, id, builtIn: false };
}

/**
 * `written`, named by the reader or by the rule for a copy's name, as a
 * profile they made beside those `held`, under an identifier none of them
 * holds, or refused where one of them has its name to a reader: a name the
 * reader chose can be chosen again, and the rule for a copy's name gives one
 * none of them has.
 *
 * Asked only where names can be compared (see `namesCanBeCompared`).
 */
export function addedTo(
  held: readonly ShortcutProfile[],
  written: WrittenProfile,
): DomainResult<ShortcutProfile> {
  const holder = holderOf(held, written.displayName);
  return holder === undefined ? succeed(heldBeside(held, written)) : fail(nameInUse(holder));
}

/**
 * A profile carried in, as it is held beside the others, and the profile held
 * that has the name it was carried in with, which it is numbered apart from:
 * `undefined` where none has that name.
 */
export interface ImportedProfile {
  readonly profile: ShortcutProfile;
  readonly namesake: ShortcutProfile | undefined;
}

/**
 * `written`, read from a file, as a profile the user made beside those `held`,
 * under an identifier none of them holds, and under the name the file gives,
 * or where one of them has it to a reader, the first free name numbered from
 * it (see `nameOfAnImport`).
 *
 * Numbered rather than refused, because the reader chose no name to choose
 * again: a profile exported on this machine, the built-in one's included,
 * carries the name of a profile held here, and a refusal would leave editing
 * the file as the only way to carry it back. The names held are read once for
 * the numbering, so a file carrying a name held with every number to
 * thousands is numbered past them in a search of the names for each.
 *
 * Asked only where names can be compared (see `namesCanBeCompared`).
 */
export function numberedInto(
  held: readonly ShortcutProfile[],
  written: WrittenProfile,
): ImportedProfile {
  const names = namesHeldBy(held);
  return {
    profile: heldBeside(held, {
      ...written,
      displayName: nameOfAnImport(written.displayName, names.taken),
    }),
    namesake: names.holderOf(written.displayName),
  };
}

/**
 * Why a stored profile is refused for the identifier it was stored under. The
 * identifier is not quoted: it is text no user chose, of any length, and the
 * refusal reaches the log.
 */
function outOfShape() {
  return failure(
    'shortcut-profile.identifier-out-of-shape',
    FailureKind.Rejected,
    'That profile is stored under an identifier AudioGubbins does not give.',
  );
}

/**
 * Profiles read from storage, each restored as the profile the user made that
 * was stored under its identifier, beside `shipped` and the profiles restored
 * before it, or refused: under its identifier, or under a free one derived
 * from it where a profile before it holds it, and refused where its text could
 * not be read or its identifier is not in the shape one is derived in, or past
 * its bound (see {@link PROFILE_IDENTIFIERS}). A refused profile takes no
 * identifier, so the next is held as though it were never stored.
 *
 * Storage is written by other versions, other tabs and hand edits, and a
 * profile under an identifier another holds would take its place, where the one
 * before it would be lost at the next write, or sit behind the built-in
 * profile, where it could be neither switched to nor deleted. Its name is not
 * held to the others': stored work is never refused for a name another profile
 * has.
 *
 * One for a whole reading of a stored list, never one for each profile, which
 * `restoreProfiles` keeps to: the identifiers held are gathered once, and each
 * profile restored adds its own, where gathered again for each, every
 * identifier held so far would be read again and each count started again from
 * two under an identifier they share, so a stored list would take time that
 * grows with the square of its length.
 */
export function restoringBeside(
  shipped: ShortcutProfile,
): (id: string, read: DomainResult<WrittenProfile>) => DomainResult<ShortcutProfile> {
  const identifiers = PROFILE_IDENTIFIERS.identifiersHeldBy([shipped], NO_IDENTIFIER_IN_THE_NAME);
  return (id, read) => {
    if (!read.ok) {
      return PROFILE_IDENTIFIERS.isIdentifier(id) ? read : fail(outOfShape(), ...read.failures);
    }
    const held = identifiers.forStored(id);
    return held === undefined
      ? fail(outOfShape())
      : succeed({ ...read.value, id: held, builtIn: false });
  };
}
