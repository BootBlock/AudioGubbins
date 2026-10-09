/**
 * Whether a processor or detector a project names can run, and if not, which of
 * REQ-AUDIO-139's conditions holds (ADR-0062).
 *
 * The answer is one of: available; available with an update published; a
 * required model unavailable; an optional enhancement unavailable; a model
 * incompatible with the runtime this build carries; or a model this device
 * cannot run. It is a value, never a failure: a pack that is missing, damaged
 * or incompatible makes the processor that needs it unavailable, saying why,
 * and never makes a project invalid, whose instances keep their settings and
 * render nothing in their place until the pack is present.
 *
 * Opening a project fetches nothing: a pack is installed only when the person
 * asks for it.
 */

import {
  modelHashOf,
  type DomainFailure,
  type ModelIdentity,
  type TextSha256,
} from '@audiogubbins/domain';

import type {
  AvailabilityContext,
  KnownPack,
  PackAvailability,
  PackNeed,
} from './availability-context.js';
import type { ModelPackManifest } from './manifest.js';
import {
  deviceRefusal,
  deviceRunsNothing,
  needFailure,
  runtimePinRefusal,
  runtimeRefusal,
  stateFailure,
} from './pack-refusals.js';
import { compareVersions } from './pack-version.js';

/** Whether a manifest serves a need's processor or detector, and its model where it names one. */
function serves(manifest: ModelPackManifest, need: PackNeed): boolean {
  const keys = need.role === 'processor' ? manifest.serves.processors : manifest.serves.detectors;
  if (!keys.includes(need.typeKey)) return false;
  return need.model === undefined || need.model.pack === manifest.id;
}

/** The highest version first. */
function byVersionDescending(one: ModelPackManifest, other: ModelPackManifest): number {
  return compareVersions(other.version, one.version) ?? 0;
}

/**
 * Whether a kept version is the model an instance names: its manifest's
 * listing of every file it holds hashes to the instance's model hash.
 */
function holdsModel(
  manifest: ModelPackManifest,
  model: ModelIdentity | undefined,
  sha256: TextSha256,
): boolean {
  return model === undefined || modelHashOf(manifest.files, sha256) === model.modelHash;
}

function unavailable(
  need: PackNeed,
  reason: DomainFailure,
  offered: ModelPackManifest | undefined,
): PackAvailability {
  return {
    condition: need.required ? 'required-unavailable' : 'optional-unavailable',
    reason,
    ...(offered === undefined ? {} : { offered }),
  };
}

/**
 * Which condition holds for `need` (see the module comment), decided in this
 * order: the device runs no pack at all; no pack serves it; the device runs
 * none that does; its instance is pinned to another build of the runtime; an
 * installed version serves it, with or without an update; the versions
 * installed all need another runtime, or are not the model the instance was
 * made with; a version is kept but not installed; none is kept, and the
 * catalogue offers one that runs here, offers only ones that do not, or offers
 * none.
 */
export function availabilityOf(need: PackNeed, context: AvailabilityContext): PackAvailability {
  // Asked before any pack is looked for: on a device that runs none, a pack
  // installed is no remedy, and a person told the model is missing would look
  // for one to install.
  const nothing = deviceRunsNothing(context.device, { typeKey: need.typeKey });
  if (nothing !== undefined) return { condition: 'device-unavailable', reason: nothing };
  const servingKept = context.packs.filter((pack) => serves(pack.manifest, need));
  const servingOffered = context.catalogue.filter((manifest) => serves(manifest, need));
  const candidates = [...servingKept.map((pack) => pack.manifest), ...servingOffered];
  const first = candidates[0];
  if (first === undefined) {
    return unavailable(
      need,
      needFailure(
        'model-pack.none-serves',
        `No pack this device keeps or the catalogue offers serves ${need.typeKey}.`,
        need,
      ),
      undefined,
    );
  }

  // The device decides first: a pack it cannot run is no use installed or not.
  const runsOnDevice = (manifest: ModelPackManifest): boolean =>
    deviceRefusal(manifest, context.device) === undefined;
  const firstRefusal = deviceRefusal(first, context.device);
  if (firstRefusal !== undefined && !candidates.some(runsOnDevice)) {
    return { condition: 'device-unavailable', reason: firstRefusal };
  }
  const pinned = runtimePinRefusal(need, context.runtime);
  if (pinned !== undefined) return { condition: 'incompatible', pack: first, reason: pinned };

  const kept = servingKept.filter(
    (pack) => runsOnDevice(pack.manifest) && isNeededVersion(pack.manifest, need),
  );
  const offered = servingOffered.filter(runsOnDevice).sort(byVersionDescending);
  const found: Found = {
    kept,
    installed: kept
      .filter((pack) => pack.state.kind === 'installed')
      .map((pack) => pack.manifest)
      .sort(byVersionDescending),
    offered,
    install: offered.find(
      (manifest) => runsOn(manifest, context) && isNeededVersion(manifest, need),
    ),
  };
  const [newest] = found.installed;
  return newest === undefined
    ? uninstalledAvailability(need, found, context)
    : installedAvailability(need, newest, found, context);
}

/** The packs that serve a need and run on this device, as availability sorts them. */
interface Found {
  /** Versions kept, of the version a need names where it names one. */
  readonly kept: readonly KnownPack[];
  /** Those installed, the highest version first. */
  readonly installed: readonly ModelPackManifest[];
  /** Versions the catalogue offers, the highest first. */
  readonly offered: readonly ModelPackManifest[];
  /** The highest offered that runs on this runtime and is the version needed. */
  readonly install: ModelPackManifest | undefined;
}

function isNeededVersion(manifest: ModelPackManifest, need: PackNeed): boolean {
  return need.model === undefined || manifest.version === need.model.version;
}

function runsOn(manifest: ModelPackManifest, context: AvailabilityContext): boolean {
  return runtimeRefusal(manifest, context.runtime) === undefined;
}

/**
 * Where a version that serves the need is installed: available, with or without
 * an update; incompatible where every one needs another runtime; or unavailable
 * where none is the model the instance was made with.
 */
function installedAvailability(
  need: PackNeed,
  newest: ModelPackManifest,
  found: Found,
  context: AvailabilityContext,
): PackAvailability {
  const usable = found.installed.find(
    (manifest) => runsOn(manifest, context) && holdsModel(manifest, need.model, context.sha256),
  );
  if (usable !== undefined) {
    const update = found.offered.find(
      (manifest) =>
        manifest.id === usable.id &&
        (compareVersions(manifest.version, usable.version) ?? 0) > 0 &&
        runsOn(manifest, context),
    );
    return update === undefined
      ? { condition: 'available', pack: usable }
      : { condition: 'update-available', pack: usable, update };
  }
  const refusal = found.installed.some((manifest) => runsOn(manifest, context))
    ? undefined
    : runtimeRefusal(newest, context.runtime);
  if (refusal !== undefined) {
    return {
      condition: 'incompatible',
      pack: newest,
      reason: refusal,
      ...(found.install === undefined ? {} : { offered: found.install }),
    };
  }
  return unavailable(
    need,
    needFailure(
      'model-pack.model-differs',
      `The installed ${newest.name} ${newest.version} is not the model this instance was made with.`,
      need,
    ),
    found.install,
  );
}

/**
 * Where no version that serves the need is installed: unavailable because one
 * is kept but not installed, or none is, with a version to install where the
 * catalogue offers one that runs here; incompatible where it offers only ones
 * that need another runtime; or unavailable where it offers none.
 */
function uninstalledAvailability(
  need: PackNeed,
  found: Found,
  context: AvailabilityContext,
): PackAvailability {
  const [notReady] = found.kept;
  if (notReady !== undefined) {
    return unavailable(need, stateFailure(notReady.manifest, notReady.state, need), found.install);
  }
  if (found.install !== undefined) {
    return unavailable(
      need,
      needFailure(
        'model-pack.not-installed',
        `No pack that serves ${need.typeKey} is installed.`,
        need,
      ),
      found.install,
    );
  }
  for (const manifest of found.offered.filter((one) => isNeededVersion(one, need))) {
    const refusal = runtimeRefusal(manifest, context.runtime);
    if (refusal !== undefined)
      return { condition: 'incompatible', pack: manifest, reason: refusal };
  }
  return unavailable(
    need,
    needFailure(
      'model-pack.version-not-offered',
      `No version of a pack that serves ${need.typeKey} that this instance can use is kept or offered.`,
      need,
    ),
    undefined,
  );
}
