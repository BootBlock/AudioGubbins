/**
 * The canonical DSP for one global scope: the WebAssembly module where it
 * runs, the reference path where it does not.
 *
 * The main thread compiles the module once and posts it to the feeder worker
 * and to each render worker, which instantiate it here; the AudioWorklet
 * compiles the bytes it is sent and instantiates the result here too
 * (`processor/worklet-dsp.ts`). ADR-0031 makes the reference path the
 * documented fallback, and ADR-0032 makes it give the same bits, so a scope
 * that cannot run the module still runs the engine, and says why, for the
 * person reading the Audio engine panel.
 */

import { REFERENCE_DSP, wasmDsp, type CanonicalDsp } from '@audiogubbins/audio-engine';

import { DspDeliveryKind, type DspDelivery } from './dsp-delivery.js';

/** The DSP a scope runs, and why it is the reference path when it is. */
export interface ScopeDsp {
  readonly dsp: CanonicalDsp;
  readonly fallbackReason: string | undefined;
}

/**
 * Chooses a scope's DSP from what the main thread sent: `scopeDsp` in a worker,
 * and in a test one that counts what its DSP makes, which is how a test sees
 * every object it made released.
 */
export type DspChooser = (delivery: DspDelivery<WebAssembly.Module>) => ScopeDsp;

/** Whether instantiation threw because it refuses the module here, not from a fault. */
function isRefusal(error: unknown): error is Error {
  return (
    error instanceof WebAssembly.LinkError ||
    error instanceof WebAssembly.RuntimeError ||
    error instanceof RangeError
  );
}

/**
 * The canonical DSP from a compiled module, or the reference path with the
 * reason: the main thread's, where it had no module to send, or what went
 * wrong instantiating or checking the one it sent.
 */
export function scopeDsp(delivery: DspDelivery<WebAssembly.Module>): ScopeDsp {
  if (delivery.kind === DspDeliveryKind.Unavailable) {
    return { dsp: REFERENCE_DSP, fallbackReason: delivery.reason };
  }
  let exports: unknown;
  try {
    exports = new WebAssembly.Instance(delivery.module, {}).exports;
  } catch (error) {
    // Instantiation refuses a module whose imports this scope cannot link
    // (LinkError), whose start traps (RuntimeError), or whose memory cannot be
    // reserved (RangeError); each leaves the reference path to run. Anything
    // else, such as a TypeError from a malformed import object, is a fault.
    if (!isRefusal(error)) throw error;
    return {
      dsp: REFERENCE_DSP,
      fallbackReason: `The DSP module could not start: ${error.message}`,
    };
  }
  const checked = wasmDsp(exports);
  return checked.ok
    ? { dsp: checked.value, fallbackReason: undefined }
    : { dsp: REFERENCE_DSP, fallbackReason: checked.failures[0].summary };
}
