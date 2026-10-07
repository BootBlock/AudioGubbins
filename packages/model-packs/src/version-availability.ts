/**
 * Whether the files of one kept pack version can be read for a model to run,
 * and if not, which of REQ-AUDIO-139's conditions holds (ADR-0062): what the
 * page's model library answers a thread's request for a file by.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

import type { AvailabilityContext } from './availability-context.js';
import { packKey, refOf, sameRef, type ModelPackManifest, type PackRef } from './manifest.js';
import { deviceRefusal, deviceRunsNothing, runtimeRefusal, stateFailure } from './pack-refusals.js';

/** Which of REQ-AUDIO-139's conditions holds for one kept version a model's files are read from. */
export type VersionAvailability =
  | { readonly condition: 'available'; readonly pack: ModelPackManifest }
  | {
      readonly condition: 'required-unavailable' | 'incompatible' | 'device-unavailable';
      readonly reason: DomainFailure;
    };

/**
 * Whether the files of the pack version `ref` can be read for a model to run,
 * and if not, which condition holds, by the rules {@link availabilityOf}
 * decides a need by: this device runs none of it; it is not kept, or kept but
 * not installed (arriving, paused, damaged); or installed but needs another
 * runtime than the one in use. Nothing is fetched to decide it.
 */
export function versionAvailability(
  ref: PackRef,
  context: Pick<AvailabilityContext, 'packs' | 'runtime' | 'device'>,
): VersionAvailability {
  const kept = context.packs.find((pack) => sameRef(refOf(pack.manifest), ref));
  if (kept === undefined) {
    const nothing = deviceRunsNothing(context.device, { pack: ref.id });
    if (nothing !== undefined) return { condition: 'device-unavailable', reason: nothing };
    return {
      condition: 'required-unavailable',
      reason: failure(
        'model-pack.not-installed',
        FailureKind.Conflict,
        `${packKey(ref)} is not installed.`,
        { details: { pack: ref.id, version: ref.version } },
      ),
    };
  }
  const { manifest, state } = kept;
  const device = deviceRefusal(manifest, context.device);
  if (device !== undefined) return { condition: 'device-unavailable', reason: device };
  if (state.kind !== 'installed') {
    return {
      condition: 'required-unavailable',
      reason: stateFailure(manifest, state, {
        role: 'processor',
        typeKey: manifest.serves.processors[0] ?? manifest.id,
        required: true,
      }),
    };
  }
  const runtime = runtimeRefusal(manifest, context.runtime);
  return runtime === undefined
    ? { condition: 'available', pack: manifest }
    : { condition: 'incompatible', reason: runtime };
}
