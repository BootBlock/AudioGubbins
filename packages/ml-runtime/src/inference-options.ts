/**
 * How a session runs, and what it says it ran on (ADR-0062).
 *
 * Every session is pinned: the final render's path, the one whose arithmetic
 * is the same on every machine, the runtime's WebAssembly backend with
 * fixed-width SIMD, on one thread, at full precision (float32 in, out and
 * between, which no option of the runtime's lowers), at a graph optimisation
 * level the caller states and persists with the instance. Relaxed SIMD,
 * thread scheduling and GPU drivers are not the same everywhere, so none is
 * used. A preview that ran faster on more threads or the GPU would need a
 * processor to choose it through its quality mode, which none does, so no
 * such path is built. A session that cannot run is refused with the reason,
 * never run on another backend.
 *
 * The device's offer is given, as the capabilities package probes it
 * (ADR-0030): this module asks nothing of the host.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

/** The runtime's graph optimisation levels, which change the arithmetic a graph runs. */
export const GraphOptimisation = {
  Disabled: 'disabled',
  Basic: 'basic',
  Extended: 'extended',
  Layout: 'layout',
  All: 'all',
} as const;

export type GraphOptimisation = (typeof GraphOptimisation)[keyof typeof GraphOptimisation];

/** How a session runs: on WebAssembly, fixed-width SIMD, one thread, full precision. */
export interface InferenceOptions {
  readonly graphOptimisation: GraphOptimisation;
}

/**
 * The options as text, the same for options that open the same session and
 * different for any that would not: every member of {@link InferenceOptions}.
 */
export function optionsKey(options: InferenceOptions): string {
  return options.graphOptimisation;
}

/** What the device offers the runtime, as the capabilities package found it. */
export interface InferenceCapabilities {
  /** Fixed-width WebAssembly SIMD, which the runtime needs. */
  readonly fixedWidthSimd: boolean;
}

/**
 * The runtime build an ML processor instance persists with its model's hash
 * (REQ-AUDIO-145): its name, its version, and the SHA-256 of its WebAssembly
 * file, in lowercase hexadecimal.
 */
export interface RuntimeIdentity {
  readonly name: string;
  readonly version: string;
  readonly webAssemblySha256: string;
}

/** What a session ran on: its options as honoured, never another backend, and the runtime. */
export interface InferenceExecution {
  readonly options: InferenceOptions;
  readonly runtime: RuntimeIdentity;
}

/** What the application starts the runtime with. */
export interface RuntimeSetup {
  /**
   * The absolute URL, ending in a slash, the application serves the runtime's
   * WebAssembly file from: its own origin, never a CDN.
   */
  readonly filesBase: string;
  /**
   * The SHA-256 of the runtime's WebAssembly file, in lowercase hexadecimal,
   * as the build that serves the file states it: the runtime's identity,
   * which the file is checked against before the runtime is given it.
   */
  readonly webAssemblySha256: string;
  readonly capabilities: InferenceCapabilities;
}

/**
 * Why no session can run on a device that offers `capabilities`, or
 * `undefined` where one can: the runtime needs fixed-width SIMD.
 */
export function capabilityRefusal(capabilities: InferenceCapabilities): DomainFailure | undefined {
  return capabilities.fixedWidthSimd
    ? undefined
    : failure(
        'inference.capability-missing',
        FailureKind.Unrecoverable,
        'A session runs on WebAssembly with fixed-width SIMD alone, which this device does not offer, so it is refused rather than run another way.',
        { details: { capability: 'webassembly-simd' } },
      );
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Whether text is a SHA-256 digest in lowercase hexadecimal. */
export function isSha256Hex(text: string): boolean {
  return SHA256_HEX.test(text);
}
