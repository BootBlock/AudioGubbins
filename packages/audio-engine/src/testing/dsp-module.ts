/**
 * The canonical DSP module, for a test, as bytes or instantiated.
 *
 * The bytes come from the test run's global setup, which builds the module
 * from the crates (`tests/setup/dsp-module.ts`), so no test runs against a
 * module older than the crates. The type of the provided value is declared
 * here alone: every program that reads it, the root's tests included, takes
 * that declaration from this module. The package is compiled without the
 * host's type definitions, so the WebAssembly global is reached through the
 * one call made of it, as the fixtures package reads the process.
 */

import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The canonical DSP module, as bytes, for a test to compile or instantiate. */
    dspModuleBytes: number[];
  }
}

/** A fresh copy of the canonical DSP module's bytes. */
export function dspModuleBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(inject('dspModuleBytes'));
}

/** The exports of a fresh instance of the canonical DSP module. */
export async function dspModuleExports(): Promise<unknown> {
  const webAssembly: unknown = Reflect.get(globalThis, 'WebAssembly');
  const instantiate: unknown =
    typeof webAssembly === 'object' && webAssembly !== null
      ? Reflect.get(webAssembly, 'instantiate')
      : undefined;
  if (typeof instantiate !== 'function') {
    throw new Error('This test host cannot instantiate WebAssembly.');
  }
  const result: unknown = await Reflect.apply(instantiate, webAssembly, [dspModuleBytes(), {}]);
  const instance: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'instance') : undefined;
  return typeof instance === 'object' && instance !== null
    ? Reflect.get(instance, 'exports')
    : undefined;
}
