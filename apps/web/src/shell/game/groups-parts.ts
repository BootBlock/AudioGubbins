/**
 * What the Asset groups panel and its parts read (ADR-0101): the project, the
 * group chosen, the loudness readings of the session, the assets as the
 * editor opens them, the audio settings, whose final render quality a reading
 * is of, and the codecs as this browser serves them, which a group's export
 * is planned against. Each is read alone: a part changes them only through
 * the commands it runs.
 */

import type { CodecEnvironment } from '@audiogubbins/codecs';

import type { AssetCatalogue } from '../../state/asset-catalogue.js';
import type { AudioSettings } from '../../state/audio-settings-store.js';
import type { GroupChoice } from '../../state/group-focus.js';
import type { LoudnessReadings } from '../../state/loudness-store.js';
import type { Observable } from '../../state/observable.js';
import type { ProjectStores } from '../../state/project-stores.js';

/** What the panel reads. */
export interface GroupsParts {
  readonly projects: ProjectStores | undefined;
  readonly groups: Observable<GroupChoice | undefined>;
  readonly loudness: Observable<LoudnessReadings>;
  readonly assets: Pick<AssetCatalogue, 'find' | 'get' | 'subscribe'>;
  readonly audioSettings: Observable<AudioSettings>;
  readonly codecs: Observable<CodecEnvironment>;
}
