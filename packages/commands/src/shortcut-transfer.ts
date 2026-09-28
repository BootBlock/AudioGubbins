/**
 * Importing and exporting shortcut profiles.
 *
 * REQ-UX-066 requires profiles to be importable and exportable so a user can
 * carry their bindings between machines or share them. An imported file is a
 * trust boundary: REQ-EXEC-136.12 requires runtime validation there, because
 * TypeScript has no opinion about a file someone else wrote.
 *
 * Nothing here reads or writes a file. This package has no filesystem and no
 * DOM; it turns a profile into text and text back into a profile, and the shell
 * decides where that text comes from.
 */

import { asQuoted, namesCanBeCompared } from '@audiogubbins/text';
import {
  FailureKind,
  combine,
  fail,
  failure,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import {
  EXPORT_FILE_ENDING,
  numberedInto,
  restoringBeside,
  type ImportedProfile,
  type WrittenProfile,
} from './held-profiles.js';
import {
  LONGEST_PROFILE_NAME,
  nameFailure,
  namingRefused,
  writtenProfileName,
  type ProfileNameProblem,
} from './profile-name.js';

import { commandId } from './command.js';
import type { Shortcut, ShortcutBinding, ShortcutProfile } from './shortcut.js';

/** How a name read from a file is refused, by the part of the rule that refused it. */
const READ_NAME_REFUSED: Readonly<Record<ProfileNameProblem['kind'], string>> = {
  blank: 'That profile has no name.',
  'too-long': `That profile's name is longer than ${String(LONGEST_PROFILE_NAME)} characters.`,
};

/** The shape a stored profile has on disk. */
interface StoredProfile {
  readonly schemaVersion: number;
  readonly displayName: string;
  readonly bindings: readonly StoredBinding[];
}

/** One stored binding. */
interface StoredBinding {
  readonly command: string;

  /**
   * The presses, each written as `CSAM+Code` with only the held modifiers
   * present, for example `C+KeyS` or `CS+KeyP`.
   */
  readonly presses: readonly string[];
}

/** Writes a profile as the text a user exports. */
export function exportProfile(profile: ShortcutProfile): string {
  const stored: StoredProfile = {
    schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
    displayName: profile.displayName,
    bindings: profile.bindings.map((binding) => ({
      command: binding.commandId,
      presses: binding.shortcut.presses.map(
        (press) =>
          `${press.control ? 'C' : ''}${press.shift ? 'S' : ''}${press.alt ? 'A' : ''}${press.meta ? 'M' : ''}+${press.key}`,
      ),
    })),
  };

  return `${JSON.stringify(stored, null, 2)}\n`;
}

/**
 * The name of the file `profile` is exported to: its identifier, then
 * {@link EXPORT_FILE_ENDING}. Within the longest name a file system gives a
 * file, since every profile is held under an identifier within the room the
 * ending leaves, so the file is saved under the name it is given.
 */
export function exportFileName(profile: ShortcutProfile): string {
  return `${profile.id}${EXPORT_FILE_ENDING}`;
}

/** Reads one stored press. */
function parsePress(
  text: string,
  index: number,
): DomainResult<ShortcutBinding['shortcut']['presses'][number]> {
  const separator = text.indexOf('+');
  if (separator === -1) {
    return fail(
      failure(
        'shortcut-profile.press-malformed',
        FailureKind.Rejected,
        `Press ${String(index + 1)} is not written as modifiers, a plus sign and a key code.`,
        { details: { press: asQuoted(text) } },
      ),
    );
  }

  const modifiers = text.slice(0, separator);
  const key = text.slice(separator + 1);

  if (key === '') {
    return fail(
      failure(
        'shortcut-profile.press-has-no-key',
        FailureKind.Rejected,
        `Press ${String(index + 1)} names no key.`,
        {
          details: { press: asQuoted(text) },
        },
      ),
    );
  }

  const unknown = modifiers.replace(/[CSAM]/g, '');
  if (unknown !== '') {
    return fail(
      failure(
        'shortcut-profile.unknown-modifier',
        FailureKind.Rejected,
        `Press ${String(index + 1)} names a modifier AudioGubbins does not recognise.`,
        { details: { press: asQuoted(text), unknown: asQuoted(unknown) } },
      ),
    );
  }

  return succeed({
    key,
    control: modifiers.includes('C'),
    shift: modifiers.includes('S'),
    alt: modifiers.includes('A'),
    meta: modifiers.includes('M'),
  });
}

/**
 * Reads a shortcut written the way {@link shortcutKey} writes one, for example
 * `C+KeyK CS+KeyP`.
 *
 * The press format is the export format, and this reads it with the same
 * parser an imported file goes through. A shortcut named in a command's
 * arguments and a shortcut in an imported file are therefore accepted by one
 * rule rather than two that could drift apart.
 */
export function parseShortcut(text: string): DomainResult<Shortcut> {
  const written = text
    .trim()
    .split(/\s+/)
    .filter((press) => press !== '');

  const combined = combine(written.map(parsePress));
  if (!combined.ok) return combined;

  const [first, ...rest] = combined.value;
  if (first === undefined) {
    return fail(
      failure(
        'shortcut-profile.binding-has-no-presses',
        FailureKind.Rejected,
        'That shortcut has no key presses.',
      ),
    );
  }
  return succeed({ presses: [first, ...rest] });
}

/**
 * Whether a value is an object with string keys, which a stored value must be
 * before any of its fields can be read.
 *
 * A predicate rather than an assertion: the check is what establishes the
 * type, so the fields are read as `unknown` and each is checked in turn.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one stored binding. */
function parseBinding(value: unknown, index: number): DomainResult<ShortcutBinding> {
  if (!isRecord(value)) {
    return fail(
      failure(
        'shortcut-profile.binding-not-an-object',
        FailureKind.Rejected,
        `Binding ${String(index + 1)} is not an object.`,
      ),
    );
  }

  const command = value['command'];
  const storedPresses: readonly unknown[] = Array.isArray(value['presses']) ? value['presses'] : [];
  const [firstStored, ...laterStored] = storedPresses;

  if (typeof command !== 'string') {
    return fail(
      failure(
        'shortcut-profile.binding-has-no-command',
        FailureKind.Rejected,
        `Binding ${String(index + 1)} names no command.`,
      ),
    );
  }

  if (firstStored === undefined) {
    return fail(
      failure(
        'shortcut-profile.binding-has-no-presses',
        FailureKind.Rejected,
        `Binding ${String(index + 1)} has no key presses.`,
        {
          details: { command: asQuoted(command) },
        },
      ),
    );
  }

  let id;
  try {
    id = commandId(command);
  } catch {
    return fail(
      failure(
        'shortcut-profile.command-malformed',
        FailureKind.Rejected,
        `Binding ${String(index + 1)} names a command identifier of the wrong shape.`,
        {
          details: { command: asQuoted(command) },
        },
      ),
    );
  }

  /** One stored press, read, or why it cannot be. */
  const read = (press: unknown, pressIndex: number) =>
    typeof press === 'string'
      ? parsePress(press, pressIndex)
      : fail(
          failure(
            'shortcut-profile.press-not-text',
            FailureKind.Rejected,
            `Press ${String(pressIndex + 1)} of binding ${String(index + 1)} is not text.`,
          ),
        );

  // The first press is its own value, because a shortcut has one: that is what
  // the type says, and reading the presses as one list would give back a list
  // the checker cannot know is not empty, so the code would have to invent a
  // refusal for a case no binding can reach. Every problem is still reported,
  // the first press's before the rest.
  const first = read(firstStored, 0);
  const later = combine(laterStored.map((press, pressIndex) => read(press, pressIndex + 1)));
  if (!first.ok) return later.ok ? first : fail(...first.failures, ...later.failures);
  if (!later.ok) return later;

  return succeed({ commandId: id, shortcut: { presses: [first.value, ...later.value] } });
}

/**
 * Reads a profile a user carried in, as one of theirs beside the profiles
 * `held`: under an identifier none of them holds, and under the name in the
 * file, numbered where one of them has it, compared as a reader hears the two
 * (see `numberedInto`), with the profile that has it. Refused where this
 * runtime cannot compare names (see `namesCanBeCompared`), since whether one of
 * them has the name cannot be decided; a file that cannot be read is refused
 * for that first, as the reader has it to put right.
 */
export function importProfile(
  text: string,
  held: readonly ShortcutProfile[],
): DomainResult<ImportedProfile> {
  const read = readProfile(text);
  if (!read.ok) return read;
  return namesCanBeCompared() ? succeed(numberedInto(held, read.value)) : fail(namingRefused());
}

/** A profile as the application stores it: its text, under its identifier. */
export interface StoredProfileEntry {
  readonly id: string;
  readonly text: string;
}

/** A stored profile, and the profile it is restored as, or why it cannot be. */
export interface RestoredEntry<Entry extends StoredProfileEntry> {
  readonly stored: Entry;
  readonly restored: DomainResult<ShortcutProfile>;
}

/**
 * Reads the list of profiles the application stored, beside `shipped`, the
 * profile AudioGubbins ships: each entry answered in its place, so a caller
 * can say which it left out by its place alone, as the profile the user made
 * under the identifier it was stored under, or under a free one derived from
 * it where a profile before it holds it, or why it cannot be read (see
 * `restoringBeside`). Each name is its own, however the others are named.
 *
 * A whole list at once, because which identifier a profile is held under
 * depends on every profile read before it, and the identifiers they hold are
 * gathered once for the list.
 */
export function restoreProfiles<Entry extends StoredProfileEntry>(
  entries: readonly Entry[],
  shipped: ShortcutProfile,
): readonly RestoredEntry<Entry>[] {
  const restore = restoringBeside(shipped);
  return entries.map((stored) => ({
    stored,
    restored: restore(stored.id, readProfile(stored.text)),
  }));
}

/**
 * Reads a profile written by `exportProfile`, every binding as it was written,
 * with no identifier: an imported profile and a stored one are each given
 * theirs by the profiles held beside them.
 *
 * Reports every problem it finds rather than the first, so a user importing a
 * profile written for an older version learns everything that needs changing in
 * one pass.
 *
 * What the platform takes is not decided here, whether the text comes from the
 * application's own storage or from a file the user carried in. A profile's
 * bindings are checked when they are made, on the keyboard layout they are
 * made on; checked again on the layout as it is known at the moment the text
 * is read, a binding on the key a French layout types Z on would be read as
 * Ctrl+W and lost. Before anything is typed, on a browser with no layout map,
 * nothing is known at all, which is exactly the case of carrying a profile to
 * another machine. What the browser takes on the layout as it becomes known is
 * said beside the table instead, and the binding stays where the user put it.
 *
 * Its refusals name the profile rather than a file, and their codes say
 * `shortcut-profile`, because it reads from storage as well as from a file,
 * and text no user chose is no file of theirs.
 */
function readProfile(text: string): DomainResult<WrittenProfile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(
      failure(
        'shortcut-profile.not-json',
        FailureKind.Rejected,
        'That is not a shortcut profile AudioGubbins can read.',
      ),
    );
  }

  if (!isRecord(parsed)) {
    return fail(
      failure(
        'shortcut-profile.not-a-profile',
        FailureKind.Rejected,
        'That does not describe a shortcut profile.',
      ),
    );
  }

  const schemaVersion = parsed['schemaVersion'];
  const displayName = parsed['displayName'];
  const bindings = parsed['bindings'];

  if (schemaVersion !== SCHEMA_VERSIONS.shortcutProfile) {
    return fail(
      failure(
        'shortcut-profile.unsupported-version',
        FailureKind.Rejected,
        `That profile was written for shortcut format ${asQuoted(schemaVersion)}, and this version of AudioGubbins reads format ${String(SCHEMA_VERSIONS.shortcutProfile)}.`,
        {
          details: {
            found: asQuoted(schemaVersion),
            expected: SCHEMA_VERSIONS.shortcutProfile,
          },
        },
      ),
    );
  }

  // A profile is something users share (REQ-UX-066), so the name in one is
  // not always the reader's own. It is stored, shown in the settings and put
  // into the sentence that says which profile is in force, so it is held to
  // the rule a new name is held to, in the words of a file read, by the part
  // of the rule that refused it, a value that is not text refused as a blank
  // name: a name with no bound is a sentence of any length in a live region.
  const name = writtenProfileName(displayName);
  if (typeof name !== 'string') return fail(nameFailure(name, READ_NAME_REFUSED[name.kind]));

  if (!Array.isArray(bindings)) {
    return fail(
      failure(
        'shortcut-profile.has-no-bindings',
        FailureKind.Rejected,
        'That profile has no list of bindings.',
      ),
    );
  }

  const stored: readonly unknown[] = bindings;
  const combined = combine(stored.map(parseBinding));
  if (!combined.ok) return combined;

  return succeed({ displayName: name, bindings: combined.value });
}
