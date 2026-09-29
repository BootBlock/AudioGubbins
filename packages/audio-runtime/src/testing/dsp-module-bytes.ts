/**
 * The canonical DSP module's bytes, for a test.
 *
 * The run's global setup builds the module from the crates and provides its
 * bytes (`tests/setup/dsp-module.ts`), so no test here compiles a module older
 * than the crates. That declaration is outside this package's program, so the
 * provided value's type is declared again here.
 */

import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    dspModuleBytes: number[];
  }
}

/** A fresh copy of the canonical DSP module's bytes. */
export function dspModuleBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(inject('dspModuleBytes'));
}
