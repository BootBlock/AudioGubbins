/**
 * The encoder modules, for a test, read from the files the run's global setup
 * built from the vendored source (`tests/setup/wasm-modules.ts`): the same
 * files the application loads. The setup provides where they are, as it
 * provides the codec module's; the type of the provided value is declared
 * here alone.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { inject } from 'vitest';

import type { EncoderModuleName } from '../worker/codec-worker-messages.js';
import { readFile } from './node-files.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where each encoder module was built, for a test to read. */
    encoderModulePaths: Readonly<Record<EncoderModuleName, string>>;
  }
}

/** The bytes of each encoder module, read once for the test file. */
const read = new Map<EncoderModuleName, Uint8Array<ArrayBuffer>>();

/** A fresh copy of an encoder module's bytes. */
export function encoderModuleBytes(name: EncoderModuleName): Uint8Array<ArrayBuffer> {
  let bytes = read.get(name);
  if (bytes === undefined) {
    bytes = readFile(inject('encoderModulePaths')[name]);
    read.set(name, bytes);
  }
  return bytes.slice();
}

/** The services' loader of encoder modules, as a test gives it: each compiled from its file. */
export function encoderModuleLoader(): (
  name: EncoderModuleName,
) => Promise<DomainResult<WebAssembly.Module>> {
  return async (name) => succeed(await WebAssembly.compile(encoderModuleBytes(name)));
}
