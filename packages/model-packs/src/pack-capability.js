/**
 * The capabilities of the device a pack's model may need beyond the runtime's
 * own (ADR-0062), named as the capabilities package names them: what a
 * manifest may list and a definition may state.
 *
 * Only what the runtime the application ships can use: its one build runs on
 * fixed-width WebAssembly SIMD, on one thread, so neither shared memory nor
 * WebGPU is a capability any pack can need, and a manifest naming either is
 * refused rather than read as needing something no build uses.
 *
 * JavaScript with its types in JSDoc, which the package's compiler checks, so
 * the pack build tool holds a definition to this one list in Node, which runs
 * no compiler. It imports nothing.
 */

/** The capabilities a pack may need. */
export const PackCapability = /** @type {const} */ ({
  /** Fixed-width WebAssembly SIMD, which every build of the runtime needs. */
  WebAssemblySimd: 'webassembly-simd',
});

/** @typedef {(typeof PackCapability)[keyof typeof PackCapability]} PackCapability */

/** Every capability, in the order of {@link PackCapability}. */
export const PACK_CAPABILITIES = /** @type {readonly PackCapability[]} */ (
  Object.values(PackCapability)
);
