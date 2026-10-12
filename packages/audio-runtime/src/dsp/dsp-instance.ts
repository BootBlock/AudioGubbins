/**
 * The canonical DSP for one global scope: the WebAssembly module where it
 * runs, the reference path where it does not.
 *
 * The main thread compiles the module once and posts it to the feeder worker
 * and to each render worker, which instantiate it here; the AudioWorklet
 * compiles the bytes it is sent and instantiates the result here too
 * (`processor/worklet-dsp.ts`). The engine's `deliveredDsp` decides between
 * the module and the reference path, and why, for the person reading the
 * Audio engine panel; this scope only makes the instance.
 */

import { deliveredDsp, type DspDelivery, type ScopeDsp } from '@audiogubbins/audio-engine';

/**
 * Chooses a scope's DSP from what the main thread sent: `scopeDsp` in a worker,
 * and in a test one that counts what its DSP makes, which is how a test sees
 * every object it made released.
 */
export type DspChooser = (delivery: DspDelivery<WebAssembly.Module>) => ScopeDsp;

/**
 * The canonical DSP from a compiled module, or the reference path with the
 * reason: the main thread's, where it had no module to send, or what went
 * wrong instantiating or checking the one it sent.
 */
export function scopeDsp(delivery: DspDelivery<WebAssembly.Module>): ScopeDsp {
  return deliveredDsp(delivery, (module) => new WebAssembly.Instance(module, {}).exports);
}
