/**
 * Updating a pack (REQ-AUDIO-139): a later version is installed beside the one
 * in use, which is then removed, unless a project needs it, in which case it is
 * kept until the person removes it knowingly.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

import type { InstallState } from './install-state.js';
import { packKey, type ModelPackManifest, type PackRef } from './manifest.js';
import type { PackInstaller, Retention } from './pack-installer.js';
import type { PackSource } from './pack-source.js';
import { compareVersions } from './pack-version.js';

/** What an update did: the new version's state, and whether the old one was kept. */
export interface UpdateOutcome {
  readonly state: InstallState;
  readonly previousRetained: boolean;
}

/**
 * Installs `next`, a later version of the installed `previous`, from `source`,
 * through `installer`, and then removes `previous` unless `retention` pins it.
 * The previous version is used until the next is installed, and is kept where
 * the next one does not install.
 */
export async function updatePack(
  installer: PackInstaller,
  previous: PackRef,
  next: ModelPackManifest,
  source: PackSource,
  retention: Retention,
  signal?: AbortSignal,
): Promise<DomainResult<UpdateOutcome>> {
  const later = compareVersions(next.version, previous.version);
  if (next.id !== previous.id || later === undefined || later <= 0) {
    return fail(
      failure(
        'model-pack.not-an-update',
        FailureKind.Rejected,
        'An update is a later version of the same pack.',
        { details: { pack: previous.id, version: previous.version } },
      ),
    );
  }
  if (installer.stateOf(previous).kind !== 'installed') {
    return fail(
      failure(
        'model-pack.not-installed',
        FailureKind.Conflict,
        `${packKey(previous)} is not installed, so there is nothing to update.`,
        { details: { pack: previous.id, version: previous.version } },
      ),
    );
  }
  const installed = await installer.download(next, source, signal);
  if (!installed.ok) return installed;
  if (installed.value.kind !== 'installed') {
    return succeed({ state: installed.value, previousRetained: true });
  }
  // Removed as any version is, so the pins keep it by the one rule removal
  // holds them to; an update is never the person removing it knowingly.
  const removed = await installer.remove(previous, { pinned: retention.pinned });
  return succeed({
    state: installed.value,
    previousRetained: !removed.ok || removed.value.kind !== 'available',
  });
}
