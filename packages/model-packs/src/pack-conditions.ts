/**
 * Which of REQ-AUDIO-139's conditions holds for one pack version itself, as the
 * pack manager lists it beside the others (ADR-0062): this browser or device
 * cannot run it, it needs another runtime than the one this build carries, a
 * later version that runs here is offered, or none of these.
 *
 * Decided by the very rules a processor's need is (`pack-refusals.ts`), in the
 * order `availabilityOf` asks them, so the manager and an unavailable processor
 * never say different things of one version. A required model unavailable and
 * an optional enhancement unavailable are conditions of a need, not of a
 * version, and are `availabilityOf`'s to decide.
 */

import type { DomainFailure } from '@audiogubbins/domain';

import type { AvailabilityContext } from './availability-context.js';
import { refOf, sameRef, type ModelPackManifest } from './manifest.js';
import { deviceRefusal, runtimeRefusal } from './pack-refusals.js';
import { compareVersions } from './pack-version.js';

/** Which condition holds for one pack version (see the module comment). */
export type PackVersionCondition =
  | { readonly condition: 'device-unavailable'; readonly reason: DomainFailure }
  | { readonly condition: 'incompatible'; readonly reason: DomainFailure }
  | { readonly condition: 'update-available'; readonly update: ModelPackManifest }
  | { readonly condition: 'runs' };

/** Whether this device and this build's runtime run `manifest`. */
function runsHere(
  manifest: ModelPackManifest,
  context: Pick<AvailabilityContext, 'runtime' | 'device'>,
): boolean {
  return (
    deviceRefusal(manifest, context.device) === undefined &&
    runtimeRefusal(manifest, context.runtime) === undefined
  );
}

/**
 * The condition of `manifest`'s version: an update is a later version of the
 * same pack the catalogue offers that runs here and is not installed already,
 * so a version whose update was installed beside it is not offered it again.
 */
export function packVersionCondition(
  manifest: ModelPackManifest,
  context: Pick<AvailabilityContext, 'packs' | 'catalogue' | 'runtime' | 'device'>,
): PackVersionCondition {
  const device = deviceRefusal(manifest, context.device);
  if (device !== undefined) return { condition: 'device-unavailable', reason: device };
  const runtime = runtimeRefusal(manifest, context.runtime);
  if (runtime !== undefined) return { condition: 'incompatible', reason: runtime };
  const installed = (offered: ModelPackManifest): boolean =>
    context.packs.some(
      (pack) => pack.state.kind === 'installed' && sameRef(refOf(pack.manifest), refOf(offered)),
    );
  const update = context.catalogue
    .filter(
      (offered) =>
        offered.id === manifest.id &&
        (compareVersions(offered.version, manifest.version) ?? 0) > 0 &&
        runsHere(offered, context) &&
        !installed(offered),
    )
    .sort((one, other) => compareVersions(other.version, one.version) ?? 0)[0];
  return update === undefined ? { condition: 'runs' } : { condition: 'update-available', update };
}
