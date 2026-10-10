/**
 * The prebuilt encoders' modules, for a test, read from the files
 * `wasm-media-encoders` installs: the same files the application loads. The
 * run's global setup (`tests/setup/wasm-modules.ts`) provides where they are,
 * as it provides the codec module's; the type of the provided value is
 * declared here alone.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';
import { inject } from 'vitest';

import type { PrebuiltEncoder } from '../worker/codec-worker-messages.js';
import { readFile } from './node-files.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where each prebuilt encoder's module is installed, for a test to read. */
    prebuiltEncoderPaths: Readonly<Record<PrebuiltEncoder, string>>;
  }
}

/** The bytes of each encoder's module, read once for the test file. */
const read = new Map<PrebuiltEncoder, Uint8Array<ArrayBuffer>>();

/** A fresh copy of a prebuilt encoder's module's bytes. */
export function prebuiltEncoderBytes(name: PrebuiltEncoder): Uint8Array<ArrayBuffer> {
  let bytes = read.get(name);
  if (bytes === undefined) {
    bytes = readFile(inject('prebuiltEncoderPaths')[name]);
    read.set(name, bytes);
  }
  return bytes.slice();
}

/** The services' loader of prebuilt encoders, as a test gives it: each module compiled from its file. */
export function prebuiltEncoderLoader(): (
  name: PrebuiltEncoder,
) => Promise<DomainResult<WebAssembly.Module>> {
  return async (name) => succeed(await WebAssembly.compile(prebuiltEncoderBytes(name)));
}
