/**
 * Why a pack cannot serve a need, each the one rule both kinds of
 * availability decide by (`availability.ts`, `version-availability.ts`): the
 * runtime in use cannot run it, its instance is pinned to another build of
 * the runtime, the device lacks what it needs, or it is kept but not
 * installed.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

import type {
  AvailabilityContext,
  LocalInferenceSupport,
  PackNeed,
} from './availability-context.js';
import type { InstallState } from './install-state.js';
import type { ModelPackManifest, PackCapability } from './manifest.js';
import { versionWithin } from './pack-version.js';

/** Why a pack does not run on this build's runtime, or `undefined` where it does. */
export function runtimeRefusal(
  manifest: ModelPackManifest,
  runtime: AvailabilityContext['runtime'],
): DomainFailure | undefined {
  const needs = manifest.runtime;
  if (needs.name === runtime.name && versionWithin(runtime.version, needs.minimum, needs.below)) {
    return undefined;
  }
  return failure(
    'model-pack.runtime-incompatible',
    FailureKind.Unrecoverable,
    `${manifest.name} ${manifest.version} runs on ${needs.name} from ${needs.minimum} below ${needs.below}, not on ${runtime.name} ${runtime.version}.`,
    { details: { pack: manifest.id, version: manifest.version } },
  );
}

/**
 * Why a need's model cannot render as its instance says on the runtime in use,
 * or `undefined` where it can: an instance is pinned to the runtime build its
 * render ran on, and another build may give other bits whatever pack is
 * installed (REQ-AUDIO-145).
 */
export function runtimePinRefusal(
  need: PackNeed,
  runtime: AvailabilityContext['runtime'],
): DomainFailure | undefined {
  const pinned = need.model?.runtimeHash;
  if (pinned === undefined || pinned === runtime.webAssemblySha256) return undefined;
  return failure(
    'model-pack.runtime-differs',
    FailureKind.Unrecoverable,
    `${need.typeKey} was made with another build of ${runtime.name} than ${runtime.version}, so its render would not be the one its settings name.`,
    {
      details: {
        typeKey: need.typeKey,
        pinnedSha256: pinned,
        runtimeSha256: runtime.webAssemblySha256,
      },
    },
  );
}

/**
 * Why this device runs no pack at all, or `undefined` where it may run some:
 * then no pack is any use, whichever serves a need and whether or not one is
 * kept. `details` names what was asked for.
 */
export function deviceRunsNothing(
  device: LocalInferenceSupport,
  details: Readonly<Record<string, string>>,
): DomainFailure | undefined {
  return device.status === 'unavailable'
    ? failure('model-pack.device-unsupported', FailureKind.Unrecoverable, device.explanation, {
        details,
      })
    : undefined;
}

/** Why this device cannot run a pack, or `undefined` where it can. */
export function deviceRefusal(
  manifest: ModelPackManifest,
  device: LocalInferenceSupport,
): DomainFailure | undefined {
  const nothing = deviceRunsNothing(device, { pack: manifest.id });
  if (nothing !== undefined) return nothing;
  const missing = [...device.missingRequired, ...device.missingPreferred].find((absent) =>
    manifest.runtime.capabilities.some((needed: PackCapability) => needed === absent.key),
  );
  return missing === undefined
    ? undefined
    : failure('model-pack.device-unsupported', FailureKind.Unrecoverable, missing.reason, {
        details: { pack: manifest.id, capability: missing.key },
      });
}

export function needFailure(code: string, summary: string, need: PackNeed): DomainFailure {
  return failure(code, FailureKind.Conflict, summary, {
    details: { role: need.role, typeKey: need.typeKey },
  });
}

/** Why a version kept but not installed cannot serve. */
export function stateFailure(
  manifest: ModelPackManifest,
  state: InstallState,
  need: PackNeed,
): DomainFailure {
  if (state.kind === 'failed') {
    return failure(
      'model-pack.damaged',
      FailureKind.IntegrityViolation,
      `${manifest.name} ${manifest.version} is not whole and is not used.`,
      { details: { pack: manifest.id, version: manifest.version }, cause: state.reason },
    );
  }
  return needFailure(
    'model-pack.not-ready',
    `${manifest.name} ${manifest.version} is ${state.kind}, not installed.`,
    need,
  );
}
