/**
 * The model library: the port a machine-learning processor reads its model's
 * files through (ADR-0062).
 *
 * The application implements it on the packs a person has installed, whose
 * files the model packs' integrity check reads and hashes as it reads them,
 * so a file reaches a processor with the SHA-256 of exactly the bytes handed
 * over and no file is hashed twice; a test implements it on memory. Where a
 * file cannot be had, the answer says which of REQ-AUDIO-139's conditions
 * holds, so the processor that needs it is unavailable for a reason a person
 * can act on, and never renders silence or its input in its place.
 */

import {
  FailureKind,
  fail,
  failure,
  type CancellationSignal,
  type DomainFailure,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';
import type { ModelBytes } from '@audiogubbins/ml-runtime';

/** A file of a model pack, read whole, as the runtime loads a model from one buffer. */
export interface ModelFile {
  readonly bytes: ModelBytes;
  /** The SHA-256 of `bytes`, in lower-case hexadecimal, taken as they were read. */
  readonly sha256: string;
}

/**
 * Which of REQ-AUDIO-139's conditions keeps a required model from a
 * processor, as the model packs' availability names them: no installed pack
 * holds it (missing, damaged or still being installed), the installed pack
 * needs another runtime, or this device cannot run it.
 */
export const ModelUnavailability = {
  RequiredUnavailable: 'required-unavailable',
  Incompatible: 'incompatible',
  DeviceUnavailable: 'device-unavailable',
} as const;

/** Which of REQ-AUDIO-139's conditions keeps a required model from a processor. */
export type ModelUnavailability = (typeof ModelUnavailability)[keyof typeof ModelUnavailability];

/** Reads the files of installed model packs. */
export interface ModelLibrary {
  /**
   * The file at `path` within version `version` of the pack `pack`, or why it
   * cannot be had, as a failure {@link modelUnavailable} makes.
   */
  file(
    pack: string,
    version: string,
    path: string,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ModelFile>>;
}

/**
 * The library's answer for a file it cannot give: `model.unavailable`, the
 * condition in its details, and `reason`, the pack's own account of why, as
 * its cause where there is one.
 */
export function modelUnavailable(
  condition: ModelUnavailability,
  summary: string,
  where: { readonly pack: string; readonly version: string; readonly path: string },
  reason?: DomainFailure,
): DomainFailureResult {
  return fail(
    failure('model.unavailable', FailureKind.Unrecoverable, summary, {
      details: { condition, ...where },
      ...(reason === undefined ? {} : { cause: reason }),
    }),
  );
}
