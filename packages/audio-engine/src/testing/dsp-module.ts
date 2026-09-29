/**
 * The canonical DSP module, instantiated for a test.
 *
 * The bytes come from the test run's global setup, which builds the module
 * from the crates (`tests/setup/dsp-module.ts`). The package is compiled
 * without the host's type definitions, so the WebAssembly global is reached
 * through the one call made of it, as the fixtures package reads the process.
 */

import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    dspModuleBytes: number[];
  }
}

/** The exports of a fresh instance of the canonical DSP module. */
export async function dspModuleExports(): Promise<unknown> {
  const bytes = new Uint8Array(inject('dspModuleBytes'));
  const webAssembly: unknown = Reflect.get(globalThis, 'WebAssembly');
  const instantiate: unknown =
    typeof webAssembly === 'object' && webAssembly !== null
      ? Reflect.get(webAssembly, 'instantiate')
      : undefined;
  if (typeof instantiate !== 'function') {
    throw new Error('This test host cannot instantiate WebAssembly.');
  }
  const result: unknown = await Reflect.apply(instantiate, webAssembly, [bytes, {}]);
  const instance: unknown =
    typeof result === 'object' && result !== null ? Reflect.get(result, 'instance') : undefined;
  return typeof instance === 'object' && instance !== null
    ? Reflect.get(instance, 'exports')
    : undefined;
}
