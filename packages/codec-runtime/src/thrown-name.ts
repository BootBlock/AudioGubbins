/**
 * What a read of a file threw, said by its name alone.
 *
 * A file the person removed, or whose permission was withdrawn, throws from a
 * read; the name, such as `NotReadableError`, says why. Its message is never
 * kept, since a browser's message may name the file's path.
 */

/** The name of what was thrown, such as `NotReadableError`, or its type where it has none. */
export function thrownName(thrown: unknown): string {
  const name: unknown =
    typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, 'name') : undefined;
  return typeof name === 'string' ? name : typeof thrown;
}
