/**
 * The runtime's WebAssembly files, and the port the adapter reads them
 * through (ADR-0062).
 *
 * The adapter is handed each build's file as bytes, checks them against the
 * digest the application's setup states, and gives the runtime those bytes,
 * so the runtime fetches nothing of its own and the digest a pinned render
 * records is that of the code that ran. Where the bytes come from is the
 * port's: the worker reads them from the application's own origin, and a test
 * from wherever it keeps them.
 */

import type { DomainResult } from '@audiogubbins/domain';

import { RuntimeBuild } from './inference-options.js';

/**
 * Each build's WebAssembly file, by the name the runtime gives it, which the
 * application serves under its files base.
 */
export const RUNTIME_WEBASSEMBLY_FILES: Readonly<Record<RuntimeBuild, string>> = {
  [RuntimeBuild.Cpu]: 'ort-wasm-simd-threaded.wasm',
  [RuntimeBuild.WebGpu]: 'ort-wasm-simd-threaded.asyncify.wasm',
};

/** Reads the runtime's WebAssembly files. */
export interface RuntimeFiles {
  /**
   * The bytes of `build`'s WebAssembly file, unchecked, or why they could not
   * be read, as a failure whose code begins `inference.`. It takes no signal:
   * a build is started once for every session that waits on it, so no one
   * caller's cancelling may stop the read the others need.
   */
  read(build: RuntimeBuild): Promise<DomainResult<Uint8Array<ArrayBuffer>>>;
}
