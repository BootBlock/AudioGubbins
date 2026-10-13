/**
 * A file read whole on Node, for test support.
 *
 * Node's `fs` module is reached through `process.getBuiltinModule`, as the
 * engine's test support reaches `v8`: this module is published to other
 * packages' tests, and every published entry point is compiled without
 * Node's type definitions.
 */

/** The bytes of the file at `path`, read by Node's `fs` module. */
export function readFile(path: string): Uint8Array<ArrayBuffer> {
  const host: unknown = Reflect.get(globalThis, 'process');
  const getBuiltinModule: unknown =
    typeof host === 'object' && host !== null ? Reflect.get(host, 'getBuiltinModule') : undefined;
  const fs: unknown =
    typeof getBuiltinModule === 'function'
      ? Reflect.apply(getBuiltinModule, host, ['node:fs'])
      : undefined;
  const readFileSync: unknown =
    typeof fs === 'object' && fs !== null ? Reflect.get(fs, 'readFileSync') : undefined;
  if (typeof readFileSync !== 'function') {
    throw new Error('The file is read on Node, whose files this test host cannot read.');
  }
  const read: unknown = Reflect.apply(readFileSync, fs, [path]);
  // Node's buffer is of Node's realm, which a test's DOM environment does
  // not share, so it is checked as a view rather than by its class.
  if (!ArrayBuffer.isView(read)) throw new Error(`${path} could not be read as bytes.`);
  return new Uint8Array(new Uint8Array(read.buffer, read.byteOffset, read.byteLength));
}
