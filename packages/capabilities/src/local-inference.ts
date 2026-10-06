/**
 * What the inference runtime may use on this device, as one answer (ADR-0062).
 *
 * The runtime and its adapter never probe the browser (ADR-0030): the
 * application starts the inference worker with this, derived from the
 * registry's probes and the processor count the browser reports, and the
 * worker refuses a session the device cannot run from it. Its shape is the
 * inference package's `InferenceCapabilities`, which this package knows
 * nothing of, as `audioRuntimeCapabilities` serves the audio engine. Whether
 * local inference runs here at all, and why not, is the `LOCAL_INFERENCE`
 * feature's availability, which the registry answers.
 */

import { CapabilityKey } from './capability.js';
import type { CapabilityRegistry } from './registry.js';

/** What the inference runtime may use on this device. */
export interface LocalInferenceCapabilities {
  /**
   * Whether WebAssembly with fixed-width SIMD can run, which every build of
   * the runtime needs and a pinned final render is defined on.
   */
  readonly fixedWidthSimd: boolean;

  /**
   * The most threads a preview may run on: the processors the browser reports
   * where memory can be shared between threads, and one where it cannot.
   */
  readonly threads: number;

  /** Whether the browser offers a WebGPU adapter, which a preview may run on. */
  readonly webGpu: boolean;
}

/** The part of the page's or a worker's `navigator` read here. */
export interface ProcessorCount {
  readonly hardwareConcurrency?: number;
}

/**
 * What the inference runtime may use, read from the registry's answers and
 * from `navigatorLike`, given rather than read from the global as
 * `readLayoutMap` is given it.
 */
export function localInferenceCapabilities(
  registry: CapabilityRegistry,
  navigatorLike: ProcessorCount,
): LocalInferenceCapabilities {
  // The instructions being known says nothing of whether the page may compile
  // them, which its security policy decides, so both are asked.
  const fixedWidthSimd =
    registry.has(CapabilityKey.WebAssembly) && registry.has(CapabilityKey.WebAssemblySimd);
  // The registry answers shared memory only where the page is also
  // cross-origin isolated, which the runtime's threads need as much.
  const processors = navigatorLike.hardwareConcurrency;
  const threads =
    registry.has(CapabilityKey.SharedArrayBuffer) &&
    processors !== undefined &&
    Number.isSafeInteger(processors) &&
    processors > 1
      ? processors
      : 1;
  return { fixedWidthSimd, threads, webGpu: registry.has(CapabilityKey.WebGpu) };
}
