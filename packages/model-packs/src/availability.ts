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
 * Opening a project fetches nothing, unless a pack is required, the catalogue
 * offers one that runs here, and the caller's automatic-download policy, the
 * person's choice, allows it (`packsToFetch`).
 */

import { FailureKind, failure, type DomainFailure, type ModelIdentity } from '@audiogubbins/domain';
import type { RuntimeIdentity } from '@audiogubbins/ml-runtime';

import type { InstallState } from './install-state.js';
import { packKey, refOf, type ModelPackManifest, type PackCapability } from './manifest.js';
import { compareVersions, versionWithin } from './pack-version.js';

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
  /** The runtime this build carries. */
  readonly runtime: Pick<RuntimeIdentity, 'name' | 'version'>;
  readonly device: LocalInferenceSupport;
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

/** Whether a manifest serves a need's processor or detector, and its model where it names one. */
function serves(manifest: ModelPackManifest, need: PackNeed): boolean {
  const keys = need.role === 'processor' ? manifest.serves.processors : manifest.serves.detectors;
  if (!keys.includes(need.typeKey)) return false;
  return need.model === undefined || need.model.pack === manifest.id;
}

/** Why a pack does not run on this build's runtime, or `undefined` where it does. */
function runtimeRefusal(
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

/** Why this device cannot run a pack, or `undefined` where it can. */
function deviceRefusal(
  manifest: ModelPackManifest,
  device: LocalInferenceSupport,
): DomainFailure | undefined {
  if (device.status === 'unavailable') {
    return failure('model-pack.device-unsupported', FailureKind.Unrecoverable, device.explanation, {
      details: { pack: manifest.id },
    });
  }
  const missing = [...device.missingRequired, ...device.missingPreferred].find((absent) =>
    manifest.runtime.capabilities.some((needed: PackCapability) => needed === absent.key),
  );
  return missing === undefined
    ? undefined
    : failure('model-pack.device-unsupported', FailureKind.Unrecoverable, missing.reason, {
        details: { pack: manifest.id, capability: missing.key },
      });
}

/** The highest version first. */
function byVersionDescending(one: ModelPackManifest, other: ModelPackManifest): number {
  return compareVersions(other.version, one.version) ?? 0;
}

/** Whether a kept file is the model an instance names, by its hash. */
function holdsModel(manifest: ModelPackManifest, model: ModelIdentity | undefined): boolean {
  return model === undefined || manifest.files.some((file) => file.sha256 === model.modelHash);
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

function needFailure(code: string, summary: string, need: PackNeed): DomainFailure {
  return failure(code, FailureKind.Conflict, summary, {
    details: { role: need.role, typeKey: need.typeKey },
  });
}

/** Why a version kept but not installed cannot serve. */
function stateFailure(
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

/**
 * Which condition holds for `need` (see the module comment), decided in this
 * order: no pack serves it; the device runs none that does; an installed
 * version serves it, with or without an update; the versions installed all need
 * another runtime, or are not the model the instance was made with; a version
 * is kept but not installed; none is kept, and the catalogue offers one that
 * runs here, offers only ones that do not, or offers none.
 */
export function availabilityOf(need: PackNeed, context: AvailabilityContext): PackAvailability {
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
    (manifest) => runsOn(manifest, context) && holdsModel(manifest, need.model),
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

/**
 * The packs to fetch as a project opens: for each need that is required and
 * unavailable for want of an install alone, the version the catalogue offers
 * that runs here, and only where the person's policy fetches required packs.
 * Each version once.
 */
export function packsToFetch(
  needs: readonly PackNeed[],
  context: AvailabilityContext,
  policy: AutomaticDownload,
): readonly ModelPackManifest[] {
  if (policy === 'never') return [];
  const fetching = new Map<string, ModelPackManifest>();
  for (const need of needs) {
    if (!need.required) continue;
    const availability = availabilityOf(need, context);
    if (
      availability.condition === 'required-unavailable' &&
      availability.reason.code === 'model-pack.not-installed' &&
      availability.offered !== undefined
    ) {
      fetching.set(packKey(refOf(availability.offered)), availability.offered);
    }
  }
  return [...fetching.values()];
}
