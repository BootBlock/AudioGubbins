/**
 * The model library on the packs a person has installed (ADR-0062): how the
 * page answers a thread's request for a model's file, read through the
 * storage worker's installer, which checks every byte against the pack's
 * manifest as it reads and hands the file over with the SHA-256 it took.
 *
 * A file that cannot be had is answered with which of REQ-AUDIO-139's
 * conditions holds, decided by the model packs' rule for the version
 * (`versionAvailability`) from what the installer keeps now: not installed,
 * arriving or damaged is a required model unavailable; installed but for
 * another runtime, incompatible; a device that cannot run the runtime,
 * unavailable for the device. A read the installer refuses part way, a file
 * that no longer matches its manifest among them, is a required model
 * unavailable with the installer's reason as its cause. A browser that keeps
 * no packs is unavailable for the device, as availability says of it
 * (`NO_PACK_STORAGE`): nothing can be installed there, so no pack is missing
 * that installing would bring. Nothing is fetched: a missing pack stays
 * missing until the person installs it.
 */

import { FailureKind, failure, type CancellationSignal } from '@audiogubbins/domain';
import {
  versionAvailability,
  type AvailabilityContext,
  type KeptFile,
  type PackRef,
} from '@audiogubbins/model-packs';
import type { DomainResult } from '@audiogubbins/domain';
import type { ModelFileReader } from '@audiogubbins/ml-runtime';
import { ModelUnavailability, modelUnavailable } from '@audiogubbins/processors';

import { NO_PACK_STORAGE } from './model-availability.js';

/** The installer's reads, as the storage client answers them. */
export interface PackFiles {
  read(ref: PackRef, path: string, signal?: AbortSignal): Promise<DomainResult<KeptFile>>;
}

/** The parts the library reads through. */
export interface InstalledModelParts {
  /** The installer's files, absent where this browser keeps no packs. */
  readonly files: PackFiles | undefined;
  /** What the installer keeps now, with the runtime in use and the device. */
  readonly context: (signal?: AbortSignal) => Promise<DomainResult<AvailabilityContext>>;
}

/** An `AbortSignal` that aborts as `signal` is cancelled, for the storage client. */
function abortSignalOf(signal: CancellationSignal): AbortSignal {
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else {
    signal.addEventListener(
      'abort',
      () => {
        controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

/** Why no pack can be read where this browser keeps none, in availability's words. */
const NO_PACKS = failure(
  'model-pack.device-unsupported',
  FailureKind.Unrecoverable,
  NO_PACK_STORAGE.explanation,
);

/** The page's reader of installed packs' files (see the module comment). */
export function installedModelFiles(parts: InstalledModelParts): ModelFileReader {
  return async (pack, version, path, cancellation) => {
    const where = { pack, version, path };
    const signal = abortSignalOf(cancellation);
    if (parts.files === undefined) {
      return modelUnavailable(
        ModelUnavailability.DeviceUnavailable,
        NO_PACKS.summary,
        where,
        NO_PACKS,
      );
    }
    const context = await parts.context(signal);
    if (!context.ok) {
      return modelUnavailable(
        ModelUnavailability.RequiredUnavailable,
        `What is installed of ${pack} ${version} could not be read.`,
        where,
        context.failures[0],
      );
    }
    const ref = { id: pack, version };
    const decided = versionAvailability(ref, context.value);
    if (decided.condition !== 'available') {
      return modelUnavailable(decided.condition, decided.reason.summary, where, decided.reason);
    }
    const read = await parts.files.read(ref, path, signal);
    if (read.ok) return read;
    return modelUnavailable(
      ModelUnavailability.RequiredUnavailable,
      `The file ${path} of ${decided.pack.name} ${version} could not be read, so the model is not run.`,
      where,
      read.failures[0],
    );
  };
}
