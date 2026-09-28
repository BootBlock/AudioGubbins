/**
 * What a value read back from storage can be trusted to be.
 *
 * Storage is a trust boundary (REQ-EXEC-136.12): another version, another tab
 * or a hand edit can put anything there. These are predicates rather than
 * assertions, so a field is read as `unknown` and checked before it is used,
 * and the stores of the application share one answer to each question instead
 * of each asserting the shape it hoped for.
 *
 * The command layer and the workspace package carry their own copy of the
 * record predicate. The layering gives neither of them a package to share one
 * from, and `REQ-EXEC-136.1` prefers a duplicated three-line predicate to a
 * dependency in the wrong direction.
 */

/** Whether a value is an object with string keys. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A stored version as a log may record it: the number where it is a whole
 * number, and -1 where it is anything else.
 *
 * The version is read from storage, which can hold any text, and a log goes
 * into a diagnostic bundle by default, so a stored version written as text is
 * never recorded as it stands.
 */
export function versionFound(value: unknown): number {
  return Number.isInteger(value) && typeof value === 'number' ? value : -1;
}

/** Whether a value is one of the members of a constant object. */
export function isMemberOf<T extends Record<string, string>>(
  members: T,
  value: unknown,
): value is T[keyof T] {
  return typeof value === 'string' && Object.values(members).includes(value);
}
