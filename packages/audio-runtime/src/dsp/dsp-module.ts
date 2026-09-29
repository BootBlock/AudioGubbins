/**
 * The canonical DSP module, compiled once on the main thread.
 *
 * Compiling is the expensive half of loading WebAssembly, and a compiled module
 * can be posted to another scope unchanged, so the main thread compiles it here
 * and posts the result to the AudioWorklet and to each render worker, which
 * instantiate it with `scopeDsp` (`dsp-instance.ts`). Where it cannot be
 * compiled, every scope is told why and runs the reference path, which ADR-0031
 * makes the documented fallback and ADR-0032 makes give the same bits.
 */

import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';

/** Whether the main thread has a compiled DSP module to send. */
export const DspModuleAvailabilityKind = {
  Compiled: 'compiled',
  Unavailable: 'unavailable',
} as const;

/** Whether the main thread has a compiled DSP module to send. */
export type DspModuleAvailabilityKind =
  (typeof DspModuleAvailabilityKind)[keyof typeof DspModuleAvailabilityKind];

/** The compiled module, or why there is none, which each scope reports as its fallback reason. */
export type DspModuleAvailability =
  | {
      readonly kind: typeof DspModuleAvailabilityKind.Compiled;
      readonly module: WebAssembly.Module;
    }
  | { readonly kind: typeof DspModuleAvailabilityKind.Unavailable; readonly reason: string };

/** What the reference path means for the person, said after each reason. */
const SAME_RESULT_MORE_SLOWLY =
  'Processing runs on the reference path, which gives the same result more slowly.';

/**
 * Compiles the canonical DSP module from its bytes, or says why it cannot.
 *
 * Never tried where the capabilities say WebAssembly cannot be compiled: the
 * page's content security policy or the browser refuses it there, and the
 * attempt would only fail more obscurely.
 */
export async function compileDspModule(
  bytes: Uint8Array<ArrayBuffer>,
  capabilities: AudioRuntimeCapabilities,
): Promise<DspModuleAvailability> {
  if (!capabilities.webAssembly) {
    return {
      kind: DspModuleAvailabilityKind.Unavailable,
      reason: `This page cannot compile WebAssembly. ${SAME_RESULT_MORE_SLOWLY}`,
    };
  }
  try {
    const module = await WebAssembly.compile(bytes);
    return { kind: DspModuleAvailabilityKind.Compiled, module };
  } catch (error) {
    // A CompileError is bytes the engine refuses, a damaged or truncated
    // download; a RangeError is an engine out of memory. Either leaves the
    // reference path to run. Anything else is a fault, and surfaces as one.
    if (!(error instanceof WebAssembly.CompileError || error instanceof RangeError)) throw error;
    return {
      kind: DspModuleAvailabilityKind.Unavailable,
      reason: `The DSP module could not be compiled: ${error.message} ${SAME_RESULT_MORE_SLOWLY}`,
    };
  }
}
