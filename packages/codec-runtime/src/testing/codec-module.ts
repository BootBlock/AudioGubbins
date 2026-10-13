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
 * The file is read through Node's `fs` module (`node-files.ts`).
 */

import { inject } from 'vitest';

import { instantiateCodecModule, type CodecModule } from '../codec-module.js';
import { readFile } from './node-files.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where the codec module was built, for a test to read. */
    codecModulePath: string;
  }
}

/** The codec module's bytes, read once for the test file. */
let bytes: Uint8Array<ArrayBuffer> | undefined;

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
