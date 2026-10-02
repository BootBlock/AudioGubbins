/**
 * Keeps the catalogue's project entries in step with the open project and the
 * files the page holds for it, so every view of an asset or region shows the
 * project as it stands (REQ-EDIT-061): a marker added in one view is in all of
 * them, and an undo moves every one back.
 *
 * A subscription the composition root makes once, beside the catalogue and the
 * project stores, so no command remembers to tell the editor what changed.
 */

import type { MadeEntry } from '../assets/project-assets.js';
import { projectEntries } from '../assets/project-assets.js';
import type { AssetCatalogue } from './asset-catalogue.js';
import type { ProjectStores } from './project-stores.js';

/** Follows the open project into `catalogue` from now on, and gives back the function that stops. */
export function followProjectAssets(
  projects: Pick<ProjectStores, 'project' | 'media'>,
  catalogue: AssetCatalogue,
): () => void {
  let made: ReadonlyMap<string, MadeEntry> = new Map();
  const follow = (): void => {
    const open = projects.project.get();
    if (open.kind !== 'open') {
      made = new Map();
      catalogue.showProject(new Map());
      return;
    }
    const shown = projectEntries(open.snapshot.model.state, projects.media.of, made);
    made = shown.made;
    catalogue.showProject(shown.entries);
  };
  follow();
  const stopProject = projects.project.subscribe(follow);
  const stopMedia = projects.media.subscribe(follow);
  return () => {
    stopProject();
    stopMedia();
  };
}
