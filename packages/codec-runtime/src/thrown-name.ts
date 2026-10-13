/**
 * What was thrown, said for a reason: by its name alone, or with its message
 * redacted.
 *
 * A file the person removed, or whose permission was withdrawn, throws from a
 * read; the name, such as `NotReadableError`, says why, and its message is
 * never kept, since a browser's message may name the file's path. A module the
 * browser would not instantiate is said by its message too, since the name
 * alone, `LinkError`, says nothing of which import failed; that message is
 * redacted by the rules that redact the person's diagnostics, so a path or an
 * address in it never reaches them.
 */

import { previewRedaction } from '@audiogubbins/diagnostics';

/** The name of what was thrown, such as `NotReadableError`, or its type where it has none. */
export function thrownName(thrown: unknown): string {
  const name: unknown =
    typeof thrown === 'object' && thrown !== null ? Reflect.get(thrown, 'name') : undefined;
  return typeof name === 'string' ? name : typeof thrown;
}

/** What was thrown, by its name and its message redacted, or by its name where it has no message. */
export function thrownSaid(thrown: unknown): string {
  return thrown instanceof Error && thrown.message !== ''
    ? `${thrown.name}: ${previewRedaction(thrown.message).text}`
    : thrownName(thrown);
}
