/**
 * The inference runtime's WebAssembly files, by the runtime build each serves,
 * as the build ships them (ADR-0062).
 *
 * `RUNTIME_WEBASSEMBLY_FILES` in `packages/ml-runtime` names them for the
 * page, and a test holds this list to it. The build keeps its own because
 * Vite's configuration, which ships them, loads in Node without a compiler,
 * and the runtime package's entry is TypeScript source.
 */

/**
 * One build's file.
 *
 * @typedef {object} RuntimeFile
 * @property {'cpu' | 'webgpu'} build
 * @property {string} name
 */

/** @type {readonly RuntimeFile[]} */
export const RUNTIME_FILES = Object.freeze([
  Object.freeze({ build: 'cpu', name: 'ort-wasm-simd-threaded.wasm' }),
  Object.freeze({ build: 'webgpu', name: 'ort-wasm-simd-threaded.asyncify.wasm' }),
]);
