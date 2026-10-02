/**
 * What a whole history keeps of a linked file's name, kept handle and path
 * below full provenance: a placeholder in place of each (REQ-STOR-166,
 * REQ-STOR-104, REQ-PRIV-165).
 *
 * A history's changes are replayed to the states it keeps, and the commands
 * compare these values. Adopting a new version of a linked file is taken only
 * where the file the asset is linked to is known by a kept handle or path, and
 * where the new version's handle and path are each equal to its own: the rule
 * reads only whether each value is present and whether two are equal. A change
 * of media that alters nothing is no change, which compares the whole media,
 * names among it. Left out, as the state alone leaves them out, these values
 * would make every adoption refused on replay and some relinks no change at
 * all. So each distinct value of each kind is given a placeholder of its own,
 * the same one everywhere in one export (the first handle met is `handle-1`,
 * another `handle-2`, and likewise `file-` and `path-`), and a value absent
 * stays absent. A placeholder is then present exactly where its value is, and
 * two are equal exactly where their values are, so every adoption, relink and
 * refusal comes out on replay as it did when made.
 *
 * A placeholder names nothing on the person's machine, and is a valid handle
 * token, file name and relative path, so the document's reader accepts it.
 */

/** The kinds of value a placeholder stands for, each numbered on its own. */
export const PlaceholderKind = {
  Handle: 'handle',
  File: 'file',
  Path: 'path',
} as const;

/** The kinds of value a placeholder stands for, each numbered on its own. */
export type PlaceholderKind = (typeof PlaceholderKind)[keyof typeof PlaceholderKind];

/**
 * What stands for a value of a kind: its placeholder, or `undefined` to leave
 * the value out.
 */
export type Placeholders = (kind: PlaceholderKind, value: string) => string | undefined;

/** A placeholder of each kind: the kind, a hyphen and a number from one. */
const PLACEHOLDER: Readonly<Record<PlaceholderKind, RegExp>> = {
  handle: /^handle-[1-9][0-9]*$/u,
  file: /^file-[1-9][0-9]*$/u,
  path: /^path-[1-9][0-9]*$/u,
};

/**
 * Placeholders for one export: each distinct value of a kind is given the
 * next number of that kind the first time it is met, and the same placeholder
 * every time after, so the export holds one placeholder per file throughout.
 */
export function placeholderNames(): Placeholders {
  const given = new Map<PlaceholderKind, Map<string, string>>();
  return (kind, value) => {
    let names = given.get(kind);
    if (names === undefined) {
      names = new Map();
      given.set(kind, names);
    }
    let name = names.get(value);
    if (name === undefined) {
      name = `${kind}-${String(names.size + 1)}`;
      names.set(value, name);
    }
    return name;
  };
}

/**
 * Placeholders that keep a value already a placeholder and leave out any
 * other, so rewriting a value with them changes it exactly where it holds a
 * name, handle or path that is not one: how a reader checks a stripped
 * history rather than stripping it again.
 */
export const KEEP_PLACEHOLDERS: Placeholders = (kind, value) =>
  PLACEHOLDER[kind].test(value) ? value : undefined;
