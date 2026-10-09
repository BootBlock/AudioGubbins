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
import type { ModelFileRead } from '@audiogubbins/ml-runtime';

/**
 * A file of a model pack, read whole, as the runtime loads a model from one
 * buffer, with the SHA-256 of its bytes, in lower-case hexadecimal, taken as
 * they were read: the shape a thread's model channel carries it in.
 */
export type ModelFile = ModelFileRead;

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

/**
 * Each condition as REQ-AUDIO-139 names it, which leads the failure's summary,
 * so a channel that carries only a failure's code and words still says which.
 */
const CONDITION_WORDS: Readonly<Record<ModelUnavailability, string>> = {
  [ModelUnavailability.RequiredUnavailable]: 'Required model unavailable',
  [ModelUnavailability.Incompatible]: 'Model incompatible with the current runtime',
  [ModelUnavailability.DeviceUnavailable]:
    'Model unavailable because of what this browser or device can do',
};

/** Reads the files of installed model packs. */
export interface ModelLibrary {
  /**
   * Whether version `version` of the pack `pack` can be read now, or why not,
   * as a failure {@link modelUnavailable} makes; decided without reading a
   * file, so a pass asks it before it opens the model and a processor whose
   * pack is missing starts no inference.
   */
  available(
    pack: string,
    version: string,
    signal?: CancellationSignal,
  ): Promise<DomainResult<void>>;

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
 * The answer for a model a processor cannot have: `model.unavailable`, its
 * summary `summary` after the condition's name, the condition in its details
 * with the pack, its version and the file where one is to blame, and
 * `reason`, the pack's or the runtime's own account of why, as its cause
 * where there is one. The library answers it for a file it cannot give, and a
 * pass for a runtime the model is not pinned to.
 */
export function modelUnavailable(
  condition: ModelUnavailability,
  summary: string,
  where: { readonly pack: string; readonly version: string; readonly path?: string },
  reason?: DomainFailure,
): DomainFailureResult {
  const { pack, version, path } = where;
  return fail(
    failure(
      'model.unavailable',
      FailureKind.Unrecoverable,
      `${CONDITION_WORDS[condition]}: ${summary}`,
      {
        details: { condition, pack, version, ...(path === undefined ? {} : { path }) },
        ...(reason === undefined ? {} : { cause: reason }),
      },
    ),
  );
}
