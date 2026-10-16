/**
 * What an export is made from and with, as its record names it once it is
 * delivered (REQ-STOR-197, REQ-AUDIO-145, REQ-ARCH-049): the settings, whether
 * its codec gives the same bytes on every machine, the state rendered and the
 * history node it is at, and the versions of what renders it.
 *
 * Taken when the export starts, before anything renders, from the project as
 * it then stands: an edit made while the export runs is not in what it
 * renders, so the record names the state that is. The state is named by its
 * fingerprint, worked out here from the state itself, since the history names
 * a node's state only once a checkpoint has written it. The encoder's own
 * identity is the codec worker's to give once it has encoded the file, and
 * each delivery is given it.
 */

import { ENGINE_VERSIONS } from '@audiogubbins/audio-engine';
import { codecDescriptor } from '@audiogubbins/codecs';
import type { ExportSettings, ExportTarget } from '@audiogubbins/import-export';
import { stateFingerprintOf, type Digest } from '@audiogubbins/project-format';
import type { ExportOrigin, ProjectSnapshot } from '@audiogubbins/storage';
import { PRODUCT_VERSION } from '@audiogubbins/version';

/** The versions of what renders an export, by name, the same for every export of this build. */
const ENGINE_VERSION_NAMES: ReadonlyMap<string, string> = new Map([
  ['audiogubbins', PRODUCT_VERSION],
  ['resampler', String(ENGINE_VERSIONS.resampler)],
  ['stretch', String(ENGINE_VERSIONS.stretch)],
]);

/**
 * The origin of each file of an export from the project `snapshot` holds, as
 * its settings and target make it: the state is fingerprinted once, here, and
 * every file of the batch is of that state, whatever settings each has.
 */
export async function exportOrigins(
  snapshot: ProjectSnapshot,
  digest: Digest,
): Promise<(settings: ExportSettings, target: ExportTarget) => ExportOrigin> {
  const { state, history } = snapshot.model;
  const stateFingerprint = await stateFingerprintOf(state, digest);
  return (settings, target) => ({
    settings,
    reproducible: codecDescriptor(target.codec).write?.reproducible ?? false,
    stateFingerprint,
    historyNodeId: history.cursor,
    engineVersions: ENGINE_VERSION_NAMES,
  });
}
