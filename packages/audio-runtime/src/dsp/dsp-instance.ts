/**
 * The canonical DSP for one global scope: the WebAssembly module where it
 * runs, the reference path where it does not.
 *
 * The main thread compiles the module once and posts it to the AudioWorklet
 * and to each render worker, which instantiate it here. ADR-0031 makes the
 * reference path the documented fallback, and ADR-0032 makes it give the same
 * bits, so a scope that cannot run the module still runs the engine, and says
 * why, for the person reading the Audio engine panel.
 */

import { REFERENCE_DSP, wasmDsp, type CanonicalDsp } from '@audiogubbins/audio-engine';

/** The DSP a scope runs, and why it is the reference path when it is. */
export interface ScopeDsp {
  readonly dsp: CanonicalDsp;
  readonly fallbackReason: string | undefined;
}

/**
 * The canonical DSP from a compiled module, or the reference path with the
 * reason: `unavailable` where the main thread had no module to send, or what
 * went wrong instantiating or checking the one it sent.
 */
export function scopeDsp(
  module: WebAssembly.Module | undefined,
  unavailable: string | undefined,
): ScopeDsp {
  if (module === undefined) {
    return {
      dsp: REFERENCE_DSP,
      fallbackReason: unavailable ?? 'No compiled DSP module was provided.',
    };
  }
  let exports: unknown;
  try {
    exports = new WebAssembly.Instance(module, {}).exports;
  } catch (error) {
    // Instantiation fails on a module this scope's engine refuses, or when
    // memory cannot be reserved; either leaves the reference path to run.
    if (!(error instanceof Error)) throw error;
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
