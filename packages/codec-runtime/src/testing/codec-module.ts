/**
 * The codec module, for a test, as bytes or instantiated.
 *
 * The module is built from the crates by the test run's global setup
 * (`tests/setup/wasm-modules.ts`), so no test runs against a module older
 * than the crates. The setup provides where it wrote the module rather than
 * its bytes: the module is large, and what is provided is copied to every
 * test file's worker, which reads it here only where a test asks. The type of
 * the provided value is declared here alone.
 *
 * Node's `fs` module is reached through `process.getBuiltinModule`, as the
 * engine's test support reaches `v8`: this module is published to other
 * packages' tests, and every published entry point is compiled without
 * Node's type definitions.
 */

import { inject } from 'vitest';

import { instantiateCodecModule, type CodecModule } from '../codec-module.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where the codec module was built, for a test to read. */
    codecModulePath: string;
  }
}

/** The codec module's bytes, read once for the test file. */
let bytes: Uint8Array<ArrayBuffer> | undefined;

/** The bytes of the file at `path`, read by Node's `fs` module. */
function readFile(path: string): Uint8Array<ArrayBuffer> {
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
    throw new Error('The codec module is read on Node, whose files this test host cannot read.');
  }
  const read: unknown = Reflect.apply(readFileSync, fs, [path]);
  // Node's buffer is of Node's realm, which a test's DOM environment does
  // not share, so it is checked as a view rather than by its class.
  if (!ArrayBuffer.isView(read)) throw new Error(`${path} could not be read as bytes.`);
  return new Uint8Array(new Uint8Array(read.buffer, read.byteOffset, read.byteLength));
}

/** A fresh copy of the codec module's bytes. */
export function codecModuleBytes(): Uint8Array<ArrayBuffer> {
  bytes ??= readFile(inject('codecModulePath'));
  return bytes.slice();
}

/** A fresh instance of the codec module, which a test that cannot have one fails. */
export async function codecModule(): Promise<CodecModule> {
  const instantiated = await instantiateCodecModule(codecModuleBytes());
  if (!instantiated.ok) {
    throw new Error(`The codec module was refused: ${instantiated.failures[0].summary}`);
  }
  return instantiated.value;
}
