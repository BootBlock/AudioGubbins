/**
 * How a session runs, and what it says it ran on (ADR-0062).
 *
 * A session is pinned or a preview. Pinned is the final render's path, the one
 * whose arithmetic is the same on every machine: the runtime's WebAssembly
 * backend with fixed-width SIMD, on one thread, at full precision (float32 in,
 * out and between, which no option of the runtime's lowers), at a graph
 * optimisation level the caller states and persists with the instance. Relaxed
 * SIMD, thread scheduling and GPU drivers are not the same everywhere, so a
 * preview may use more threads or WebGPU where the device offers them, and its
 * session says it is a preview (REQ-AUDIO-080); it never stands in for a final
 * render (REQ-AUDIO-143). A pinned session that cannot run is refused with the
 * reason, never run on another backend.
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

/** Whether a session is the final render's or a preview's. */
export const InferenceMode = {
  Pinned: 'pinned',
  Preview: 'preview',
} as const;

/** What a preview may run faster with. */
export const PreviewAcceleratorKind = {
  Threads: 'threads',
  WebGpu: 'webgpu',
} as const;

/** A preview's accelerator: more threads on the WebAssembly backend, or the GPU. */
export type PreviewAccelerator =
  | { readonly kind: typeof PreviewAcceleratorKind.Threads; readonly threads: number }
  | { readonly kind: typeof PreviewAcceleratorKind.WebGpu };

/** How a session runs. */
export type InferenceOptions =
  | {
      /** The final render's path: WebAssembly, fixed-width SIMD, one thread, full precision. */
      readonly kind: typeof InferenceMode.Pinned;
      readonly graphOptimisation: GraphOptimisation;
    }
  | {
      readonly kind: typeof InferenceMode.Preview;
      readonly graphOptimisation: GraphOptimisation;
      readonly accelerator: PreviewAccelerator;
    };

/** What the device offers the runtime, as the capabilities package found it. */
export interface InferenceCapabilities {
  /** Fixed-width WebAssembly SIMD, which every build of the runtime needs. */
  readonly fixedWidthSimd: boolean;
  /** The most threads a preview may run on: one where memory cannot be shared. */
  readonly threads: number;
  /** A WebGPU adapter. */
  readonly webGpu: boolean;
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

/** The runtime's builds: its WebAssembly CPU build, and the build with WebGPU. */
export const RuntimeBuild = {
  Cpu: 'cpu',
  WebGpu: 'webgpu',
} as const;

export type RuntimeBuild = (typeof RuntimeBuild)[keyof typeof RuntimeBuild];

/** What the application starts the runtime with. */
export interface RuntimeSetup {
  /**
   * The absolute URL, ending in a slash, the application serves the runtime's
   * WebAssembly files from: its own origin, never a CDN.
   */
  readonly filesBase: string;
  /**
   * The SHA-256 of each build's WebAssembly file, in lowercase hexadecimal, as
   * the build that serves the file states it: the runtime's identity, which
   * the file is checked against before the runtime is given it.
   */
  readonly webAssemblySha256: Readonly<Record<RuntimeBuild, string>>;
  readonly capabilities: InferenceCapabilities;
}

/**
 * The runtime a session needs started: its build and the threads it is started
 * with. A runtime is started once in its global scope and keeps its threads
 * for good, so sessions of different configurations run in different scopes.
 */
export interface RuntimeConfiguration {
  readonly build: RuntimeBuild;
  readonly threads: number;
}

/** The runtime configuration `options` run on. */
export function runtimeConfigurationOf(options: InferenceOptions): RuntimeConfiguration {
  if (options.kind === InferenceMode.Pinned) return { build: RuntimeBuild.Cpu, threads: 1 };
  return options.accelerator.kind === PreviewAcceleratorKind.Threads
    ? { build: RuntimeBuild.Cpu, threads: options.accelerator.threads }
    : { build: RuntimeBuild.WebGpu, threads: 1 };
}

/** A device that lacks what a session needs. */
function missing(summary: string, capability: string): DomainFailure {
  return failure('inference.capability-missing', FailureKind.Unrecoverable, summary, {
    details: { capability },
  });
}

/**
 * Why `options` cannot run on a device that offers `capabilities`, or
 * `undefined` where they can. Every build of the runtime needs fixed-width
 * SIMD; a preview's accelerator needs what it names.
 */
export function capabilityRefusal(
  options: InferenceOptions,
  capabilities: InferenceCapabilities,
): DomainFailure | undefined {
  if (!capabilities.fixedWidthSimd) {
    return missing(
      options.kind === InferenceMode.Pinned
        ? 'A pinned session runs on WebAssembly with fixed-width SIMD alone, which this device does not offer, so it is refused rather than run another way.'
        : 'The inference runtime needs fixed-width WebAssembly SIMD, which this device does not offer.',
      'webassembly-simd',
    );
  }
  if (options.kind === InferenceMode.Pinned) return undefined;
  const { accelerator } = options;
  if (accelerator.kind === PreviewAcceleratorKind.WebGpu) {
    return capabilities.webGpu
      ? undefined
      : missing(
          'A WebGPU preview needs a WebGPU adapter, which this device does not offer.',
          'webgpu',
        );
  }
  if (!Number.isSafeInteger(accelerator.threads) || accelerator.threads < 1) {
    return failure(
      'inference.options-invalid',
      FailureKind.Rejected,
      `A preview runs on a whole number of threads, one or more, not ${String(accelerator.threads)}.`,
    );
  }
  return accelerator.threads <= capabilities.threads
    ? undefined
    : missing(
        `A preview on ${String(accelerator.threads)} threads needs memory shared between that many, and this device offers ${String(capabilities.threads)}.`,
        'threads',
      );
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Whether text is a SHA-256 digest in lowercase hexadecimal. */
export function isSha256Hex(text: string): boolean {
  return SHA256_HEX.test(text);
}
