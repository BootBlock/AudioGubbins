/**
 * The canonical DSP for the AudioWorklet, compiled there from the module's
 * bytes.
 *
 * Chromium drops a message to an AudioWorklet that carries a compiled
 * `WebAssembly.Module`, silently, while it delivers one carrying bytes, so the
 * main thread sends the bytes and the processor compiles them itself. The
 * synchronous `new WebAssembly.Module` is refused only on a page's main thread,
 * and the worklet's scope is not one. It compiles at every `load` rather than
 * caching: a load is the person's act, rare beside the quanta it sits between,
 * it halts playback while it runs, and the module is about 36 KB, which
 * compiles in a few milliseconds. A cache keyed by the bytes would have to hash
 * them at each load, which costs most of what it saves.
 */

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';

import { scopeDsp, type ScopeDsp } from '../dsp/dsp-instance.js';

/**
 * The DSP from the module's bytes, or the reference path with the reason:
 * `unavailable` where the main thread sent no bytes, or why they would not
 * compile.
 */
export function workletDsp(
  bytes: Uint8Array<ArrayBuffer> | undefined,
  unavailable: string | undefined,
): ScopeDsp {
  if (bytes === undefined) return scopeDsp(undefined, unavailable);
  let module: WebAssembly.Module;
  try {
    module = new WebAssembly.Module(bytes);
  } catch (error) {
    // A CompileError is bytes this engine refuses, damaged or truncated on
    // their way; a RangeError is an engine out of memory. Either leaves the
    // reference path to run, which gives the same bits more slowly.
    if (!(error instanceof Error)) throw error;
    return {
      dsp: REFERENCE_DSP,
      fallbackReason: `The DSP module could not be compiled in the audio thread: ${error.message}`,
    };
  }
  return scopeDsp(module, undefined);
}
