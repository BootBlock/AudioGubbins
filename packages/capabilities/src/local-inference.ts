/**
 * What the inference runtime may use on this device, as one answer (ADR-0062).
 *
 * The runtime and its adapter never probe the browser (ADR-0030): the
 * application starts the inference worker with this, derived from the
 * registry's probes, and the worker refuses a session the device cannot run
 * from it. Its shape is the inference package's `InferenceCapabilities`,
 * which this package knows nothing of, as `audioRuntimeCapabilities` serves
 * the audio engine. Whether local inference runs here at all, and why not, is
 * the `LOCAL_INFERENCE` feature's availability, which the registry answers.
 */

import { CapabilityKey } from './capability.js';
import type { CapabilityRegistry } from './registry.js';

/** What the inference runtime may use on this device. */
export interface LocalInferenceCapabilities {
  /**
   * Whether WebAssembly with fixed-width SIMD can run, which the runtime
   * needs and a pinned render is defined on.
   */
  readonly fixedWidthSimd: boolean;
}

/** What the inference runtime may use, read from the registry's answers. */
export function localInferenceCapabilities(
  registry: CapabilityRegistry,
): LocalInferenceCapabilities {
  // The instructions being known says nothing of whether the page may compile
  // them, which its security policy decides, so both are asked.
  return {
    fixedWidthSimd:
      registry.has(CapabilityKey.WebAssembly) && registry.has(CapabilityKey.WebAssemblySimd),
  };
}
