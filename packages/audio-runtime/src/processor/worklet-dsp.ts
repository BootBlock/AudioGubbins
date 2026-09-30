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

import { DspDeliveryKind, type DspDelivery } from '../dsp/dsp-delivery.js';
import { scopeDsp, type ScopeDsp } from '../dsp/dsp-instance.js';

/**
 * The DSP from the module's bytes, or the reference path with the reason: the
 * main thread's, where it sent no bytes, or why they would not compile.
 */
export function workletDsp(delivery: DspDelivery<Uint8Array<ArrayBuffer>>): ScopeDsp {
  if (delivery.kind === DspDeliveryKind.Unavailable) return scopeDsp(delivery);
  let module: WebAssembly.Module;
  try {
    module = new WebAssembly.Module(delivery.module);
  } catch (error) {
    // A CompileError is bytes this engine refuses, damaged or truncated on
    // their way; a RangeError is an engine out of memory. Either leaves the
    // reference path to run, which gives the same bits more slowly. Anything
    // else is a fault, and surfaces as one.
    if (!(error instanceof WebAssembly.CompileError || error instanceof RangeError)) throw error;
    return {
      dsp: REFERENCE_DSP,
      fallbackReason: `The DSP module could not be compiled in the audio thread: ${error.message}`,
    };
  }
  return scopeDsp({ kind: DspDeliveryKind.Available, module });
}
