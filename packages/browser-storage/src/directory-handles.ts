/**
 * The handles a directory holds, one at a time.
 *
 * Every floor browser iterates a directory handle, but the DOM type definitions
 * this package is compiled with declare the iteration only in a library it does
 * not take, so the iterator is reached through `Reflect` and each step is
 * checked rather than trusted. Lazily, because a folder the user chose may hold
 * more entries than are worth holding at once (G4).
 */

/** A member of an object, where the value is one. */
function member(host: unknown, name: string): unknown {
  return typeof host === 'object' && host !== null ? Reflect.get(host, name) : undefined;
}

/** Each handle the directory holds, in the order the browser gives them. */
export async function* handlesIn(
  directory: FileSystemDirectoryHandle,
): AsyncGenerator<FileSystemHandle, void, undefined> {
  const values = member(directory, 'values');
  if (typeof values !== 'function') {
    throw new TypeError('This browser cannot list the entries of a directory.');
  }
  const iterator: unknown = Reflect.apply(values, directory, []);
  const next = member(iterator, 'next');
  if (typeof next !== 'function') {
    throw new TypeError('A directory listing is not an iterator.');
  }
  for (;;) {
    const step: unknown = await Reflect.apply(next, iterator, []);
    if (member(step, 'done') === true) return;
    const handle = member(step, 'value');
    if (!(handle instanceof FileSystemHandle)) {
      throw new TypeError('A directory listed something that is not a handle.');
    }
    yield handle;
  }
}
