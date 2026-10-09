/**
 * The inference runtime's WebAssembly file, as the build ships it (ADR-0062):
 * its CPU build's, the one build a session runs on.
 *
 * `RUNTIME_WEBASSEMBLY_FILE` in `packages/ml-runtime` names it for the page,
 * and a test holds this name to it. The build keeps its own because Vite's
 * configuration, which ships it, loads in Node without a compiler, and the
 * runtime package's entry is TypeScript source.
 */

export const RUNTIME_FILE = 'ort-wasm-simd-threaded.wasm';
