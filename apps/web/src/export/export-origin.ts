/**
 * What an export is made from and with, as its record names it once it is
 * delivered (REQ-STOR-197, REQ-AUDIO-145, REQ-ARCH-049): the settings, whether
 * its codec gives the same bytes on every machine, the state rendered and the
 * history node it is at, and the versions of what renders it.
 *
 * Taken when the export starts, before anything renders, from the project as
 * it then stands: an edit made while the export runs is not in what it
 * renders, so the record names the state that is. The encoder's own identity
 * is the codec worker's to give once it has encoded the file, and each
 * delivery is given it.
 */

import { ENGINE_VERSIONS } from '@audiogubbins/audio-engine';
import { codecDescriptor } from '@audiogubbins/codecs';
import { fail, failure, FailureKind, succeed, type DomainResult } from '@audiogubbins/domain';
import type { ExportSettings, ExportTarget } from '@audiogubbins/import-export';
import type { ExportOrigin, ProjectSnapshot } from '@audiogubbins/storage';
import { PRODUCT_VERSION } from '@audiogubbins/version';

/** The versions of what renders an export, by name, the same for every export of this build. */
const ENGINE_VERSION_NAMES: ReadonlyMap<string, string> = new Map([
  ['audiogubbins', PRODUCT_VERSION],
  ['resampler', String(ENGINE_VERSIONS.resampler)],
  ['stretch', String(ENGINE_VERSIONS.stretch)],
]);

/**
 * The origin of an export of `target` as `settings` set it, from the project
 * `snapshot` holds, or why it has none: a state the history has not yet named,
 * which a change still being written leaves for a moment.
 */
export function exportOrigin(
  snapshot: ProjectSnapshot,
  settings: ExportSettings,
  target: ExportTarget,
): DomainResult<ExportOrigin> {
  const { history } = snapshot.model;
  const fingerprint = history.nodes.get(history.cursor)?.stateFingerprint;
  if (fingerprint === undefined) {
    return fail(
      failure(
        'export.state-unnamed',
        FailureKind.Retryable,
        'The project is still saving its last change, so the export cannot yet name the state it renders. Try again in a moment.',
      ),
    );
  }
  return succeed({
    settings,
    reproducible: codecDescriptor(target.codec).write?.reproducible ?? false,
    stateFingerprint: fingerprint,
    historyNodeId: history.cursor,
    engineVersions: ENGINE_VERSION_NAMES,
  });
}
