/**
 * The composition root's pack-manager part (REQ-AUDIO-139, ADR-0062): the
 * manager over the storage worker's installer, the catalogue this build
 * configures on the page's own origin, the person's folders, and availability
 * as the model services read it.
 *
 * Its own module beside `application.ts`, as the analysis part is. Nothing is
 * read here: the catalogue's facts are loaded, and the catalogue fetched, only
 * when the person first asks (`pack-catalogue-facts.ts`), and what is kept is
 * read when the manager is first looked at.
 */

import type { StorageClient } from '@audiogubbins/storage-runtime';

import { abandonment } from '../state/abandoning.js';
import type { ProjectStores } from '../state/project-stores.js';
import type { ModelServices } from './model-services.js';
import { PackManager } from './pack-manager.js';

/** The catalogue this build configures, for a page on `origin`. */
async function builtCatalogue(origin: string): Promise<string> {
  const facts = await import('./pack-catalogue-facts.js');
  return facts.catalogueOn(origin);
}

/** Builds the manager over what the project system and the model services hold. */
export function startPackManager(
  system: {
    readonly storage: StorageClient | undefined;
    readonly projects: ProjectStores | undefined;
  },
  models: Pick<ModelServices, 'availability'>,
): { readonly manager: PackManager; readonly dispose: () => void } {
  const lifetime = new AbortController();
  const manager = new PackManager({
    packs: system.storage?.packs,
    catalogueUrl: () => builtCatalogue(location.origin),
    chooseFolder: () => system.projects?.files.chooseFolderToRead() ?? Promise.resolve(undefined),
    availability: models.availability,
    lifetime: lifetime.signal,
  });
  return {
    manager,
    dispose: () => {
      lifetime.abort(abandonment('The page took the model packs down.'));
    },
  };
}
