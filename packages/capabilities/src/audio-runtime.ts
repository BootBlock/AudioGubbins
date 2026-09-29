/**
 * What the audio engine may use on this device, as one answer.
 *
 * The audio runtime and the engine never probe the browser (REQ-EXEC-136.4):
 * they are given this, derived from the registry's probes, and choose their
 * paths from it. Each accelerator here is optional (ADR-0003): shared memory
 * and WebAssembly change how fast the engine runs and how deep its buffers
 * are, never what it can do, and a GPU is reported for the processors that
 * can use one without any of them depending on it.
 *
 * Which path the engine takes with these is the engine's decision, so this
 * states facts and names no path.
 *
 * What a device measures once its audio context runs, its rate, its latency
 * and its channel count, is the runtime's to report, because nothing can be
 * measured before a context exists.
 */

import { CapabilityKey } from './capability.js';
import type { CapabilityRegistry } from './registry.js';

/** What the audio engine may use on this device. */
export interface AudioRuntimeCapabilities {
  /** Whether audio can be processed on the audio thread, which playback needs. */
  readonly playback: boolean;

  /** Whether offline renders can run on background threads, which they need. */
  readonly offlineRendering: boolean;

  /**
   * Whether WebAssembly can be compiled, so the canonical DSP can run as the
   * Rust module rather than the slower reference path (ADR-0031).
   */
  readonly webAssembly: boolean;

  /**
   * Whether memory can be shared with the audio thread, so playback reads a
   * ring rather than a message for every block.
   */
  readonly sharedMemory: boolean;

  /** Whether playback can be sent to a device the user chooses. */
  readonly outputSelection: boolean;

  /** Whether a GPU is offered to a processor that can use one. */
  readonly gpu: boolean;
}

/** What the audio engine may use, read from the registry's answers. */
export function audioRuntimeCapabilities(registry: CapabilityRegistry): AudioRuntimeCapabilities {
  return {
    playback: registry.has(CapabilityKey.AudioWorklet),
    offlineRendering: registry.has(CapabilityKey.WebWorkers),
    webAssembly: registry.has(CapabilityKey.WebAssembly),
    // The registry answers shared memory only where the page is also
    // cross-origin isolated, since a buffer cannot be shared otherwise.
    sharedMemory: registry.has(CapabilityKey.SharedArrayBuffer),
    outputSelection: registry.has(CapabilityKey.AudioOutputSelection),
    gpu: registry.has(CapabilityKey.WebGpu),
  };
}
