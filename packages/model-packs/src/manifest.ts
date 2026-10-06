/**
 * What a model pack is: its manifest, `ModelPackManifest` (ADR-0062,
 * REQ-AUDIO-139).
 *
 * A pack is a manifest and the files it names. The manifest says what the pack
 * is for and who may redistribute it, how large it is to download and to keep,
 * the size and SHA-256 of every file, the runtime and the device capabilities
 * it needs, the quality tiers it serves and the processors and detectors it
 * serves, by type key. A manifest is read only through `manifest-reading.ts`,
 * which refuses anything it does not hold to, so every value here has been
 * checked.
 */

import type { NamedQualityLevel } from '@audiogubbins/domain';

/** A pack and one version of it: what the store keeps and the installer tracks. */
export interface PackRef {
  /** The pack's stable name, for example `deepfilternet-3`. */
  readonly id: string;
  /** Its version, `major.minor.patch`. */
  readonly version: string;
}

/** One file of a pack. */
export interface PackFile {
  /**
   * Where the file is, relative to the pack: segments of letters, digits, `.`,
   * `_` and `-` joined by `/`, never `..`, never absolute, never a backslash.
   */
  readonly path: string;
  /** Its length in bytes. */
  readonly bytes: number;
  /** The SHA-256 of its bytes, 64 lower-case hexadecimal digits. */
  readonly sha256: string;
}

/**
 * Who may redistribute the pack, as SPDX licence expressions: the code that
 * made or runs the model, and the weights. ADR-0062 admits a pack only when
 * both are licensed for redistribution, so both are always stated.
 */
export interface PackLicence {
  readonly code: string;
  readonly weights: string;
}

/**
 * A capability of the device a pack's model needs beyond the runtime's own,
 * named as the capabilities package names it.
 */
export const PackCapability = {
  WebAssemblySimd: 'webassembly-simd',
  SharedArrayBuffer: 'shared-array-buffer',
  WebGpu: 'webgpu',
} as const;

export type PackCapability = (typeof PackCapability)[keyof typeof PackCapability];

/**
 * The runtime a pack's models run on: its name, the versions it was checked
 * against, from `minimum` up to but not including `below`, and the device
 * capabilities it needs.
 */
export interface PackRuntime {
  readonly name: string;
  readonly minimum: string;
  readonly below: string;
  readonly capabilities: readonly PackCapability[];
}

/** The processors and detectors a pack serves, by type key. */
export interface PackServes {
  readonly processors: readonly string[];
  readonly detectors: readonly string[];
}

/** A model pack's manifest (see the module comment). */
export interface ModelPackManifest {
  readonly id: string;
  /** Its name, as a person is shown it. */
  readonly name: string;
  /** What it does, in a sentence or two. */
  readonly purpose: string;
  readonly version: string;
  /** The bytes a download transfers: the sum of the files' lengths. */
  readonly downloadBytes: number;
  /** The bytes the pack takes once installed, at least its download. */
  readonly installedBytes: number;
  readonly files: readonly PackFile[];
  readonly licence: PackLicence;
  readonly runtime: PackRuntime;
  /** The quality tiers it serves, as `QualityMode` names them. */
  readonly tiers: readonly NamedQualityLevel[];
  readonly serves: PackServes;
}

/** The ref of a manifest's pack. */
export function refOf(manifest: ModelPackManifest): PackRef {
  return { id: manifest.id, version: manifest.version };
}

/** One text for a ref, to key a map by. `@` appears in neither part. */
export function packKey(ref: PackRef): string {
  return `${ref.id}@${ref.version}`;
}

/** Whether two refs name the same pack version. */
export function sameRef(one: PackRef, other: PackRef): boolean {
  return one.id === other.id && one.version === other.version;
}
