/**
 * The canonical DSP module, compiled once on the main thread.
 *
 * Compiling is the expensive half of loading WebAssembly, and a dedicated
 * worker accepts a compiled module posted to it, so the page compiles the
 * module here once and posts the result to the feeder worker and to each render
 * worker, which instantiate it with `scopeDsp` (`dsp-instance.ts`). The
 * AudioWorklet is sent the bytes instead and compiles them itself
 * (`processor/worklet-dsp.ts`), since Chromium drops a message to a worklet
 * that carries a compiled module; so the result keeps both. Where the module
 * cannot be compiled, every scope is told why and runs the reference path,
 * which ADR-0031 makes the documented fallback and ADR-0032 makes give the same
 * bits.
 */

import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';

import { DspDeliveryKind, type DspDelivery } from '@audiogubbins/audio-engine';

import type { CompiledDspModule } from './dsp-delivery.js';

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
): Promise<DspDelivery<CompiledDspModule>> {
  if (!capabilities.webAssembly) {
    return {
      kind: DspDeliveryKind.Unavailable,
      reason: `This page cannot compile WebAssembly. ${SAME_RESULT_MORE_SLOWLY}`,
    };
  }
  try {
    const module = await WebAssembly.compile(bytes);
    return { kind: DspDeliveryKind.Available, module: { bytes, module } };
  } catch (error) {
    // A CompileError is bytes the engine refuses, a damaged or truncated
    // download; a RangeError is an engine out of memory. Either leaves the
    // reference path to run. Anything else is a fault, and surfaces as one.
    if (!(error instanceof WebAssembly.CompileError || error instanceof RangeError)) throw error;
    return {
      kind: DspDeliveryKind.Unavailable,
      reason: `The DSP module could not be compiled: ${error.message} ${SAME_RESULT_MORE_SLOWLY}`,
    };
  }
}
