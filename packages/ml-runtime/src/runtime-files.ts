/**
 * The runtime's WebAssembly file, and the port the adapter reads it through
 * (ADR-0062).
 *
 * The adapter is handed the file as bytes, checks them against the digest the
 * application's setup states, and gives the runtime those bytes, so the
 * runtime fetches nothing of its own and the digest a pinned render records is
 * that of the code that ran. Where the bytes come from is the port's: the
 * worker reads them from the application's own origin, and a test from
 * wherever it keeps them.
 */

import type { DomainResult } from '@audiogubbins/domain';

/**
 * The WebAssembly file of the runtime's CPU build, by the name the runtime
 * gives it, which the application serves under its files base.
 */
export const RUNTIME_WEBASSEMBLY_FILE = 'ort-wasm-simd-threaded.wasm';

/** Reads the runtime's WebAssembly file. */
export interface RuntimeFiles {
  /**
   * The bytes of the runtime's WebAssembly file, unchecked, or why they could
   * not be read, as a failure whose code begins `inference.`. It takes no
   * signal: the runtime is started once for every session that waits on it,
   * so no one caller's cancelling may stop the read the others need.
   */
  read(): Promise<DomainResult<Uint8Array<ArrayBuffer>>>;
}
