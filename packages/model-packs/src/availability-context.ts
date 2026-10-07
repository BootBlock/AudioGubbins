/**
 * What deciding which of REQ-AUDIO-139's conditions holds for a processor or
 * detector reads (ADR-0062): the need, the packs kept, the catalogue's offer,
 * the runtime in use, the device, and the conditions themselves.
 */

import type { DomainFailure, ModelIdentity, TextSha256 } from '@audiogubbins/domain';
import type { RuntimeIdentity } from '@audiogubbins/ml-runtime';

import type { InstallState } from './install-state.js';
import type { ModelPackManifest } from './manifest.js';

/** A processor or detector a project names, and how much it needs its pack. */
export interface PackNeed {
  readonly role: 'processor' | 'detector';
  readonly typeKey: string;
  /**
   * Whether the processor cannot run without a pack (an ML processor) or a pack
   * only enhances it (a canonical detector a pack's detector joins).
   */
  readonly required: boolean;
  /** The model an instance was made with, which it needs exactly. */
  readonly model?: ModelIdentity;
}

/**
 * How this device runs local inference, as the capabilities package states its
 * local-inference feature: the shape of its `FeatureAvailability`, which this
 * package takes as given rather than probing anything itself.
 */
export interface LocalInferenceSupport {
  readonly status: 'full' | 'reduced' | 'unavailable';
  readonly explanation: string;
  readonly missingRequired: readonly { readonly key: string; readonly reason: string }[];
  readonly missingPreferred: readonly { readonly key: string; readonly reason: string }[];
}

/** A pack the device keeps or knows of, and its installation's state. */
export interface KnownPack {
  readonly manifest: ModelPackManifest;
  readonly state: InstallState;
}

/** What availability is decided from. */
export interface AvailabilityContext {
  /** The versions kept or being kept, with their states. */
  readonly packs: readonly KnownPack[];
  /** What the catalogue offers; empty where it has not been asked. */
  readonly catalogue: readonly ModelPackManifest[];
  /**
   * The runtime this build carries, by the SHA-256 of the WebAssembly a pinned
   * render runs too, which an instance's model identity is pinned to.
   */
  readonly runtime: RuntimeIdentity;
  readonly device: LocalInferenceSupport;
  /** The SHA-256 a pack's model hash is taken with, the platform's. */
  readonly sha256: TextSha256;
}

/** Which of REQ-AUDIO-139's conditions holds for a need (see the module comment). */
export type PackAvailability =
  | { readonly condition: 'available'; readonly pack: ModelPackManifest }
  | {
      readonly condition: 'update-available';
      readonly pack: ModelPackManifest;
      readonly update: ModelPackManifest;
    }
  | {
      readonly condition: 'required-unavailable' | 'optional-unavailable';
      readonly reason: DomainFailure;
      /** A version the catalogue offers that runs here, to install. */
      readonly offered?: ModelPackManifest;
    }
  | {
      readonly condition: 'incompatible';
      readonly pack: ModelPackManifest;
      readonly reason: DomainFailure;
      /** A version the catalogue offers that runs here, to install instead. */
      readonly offered?: ModelPackManifest;
    }
  | { readonly condition: 'device-unavailable'; readonly reason: DomainFailure };

/** Whether a person has chosen to fetch the packs a project requires when it opens. */
export type AutomaticDownload = 'never' | 'required';
