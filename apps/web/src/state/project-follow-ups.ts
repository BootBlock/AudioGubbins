/**
 * What the project stores do as the open project changes: look at the files a
 * project links to as it is opened to write (REQ-STOR-053), and read the list
 * of projects again once a name the list shows has changed and been saved
 * (REQ-STOR-026).
 *
 * Each follows the open project's store, the one place that knows it changed,
 * rather than having every command that could change it remember to.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { ProjectSession } from '@audiogubbins/storage';

import type { OpenProjectStore } from './open-project-store.js';
import type { ProjectLibraryStore } from './project-library-store.js';
import type { SourceChangeStore } from './source-change-store.js';

/** Looks at the linked files once for each session opened to write. */
export function checkSourcesOnOpening(
  project: OpenProjectStore,
  sources: SourceChangeStore,
  logger: Logger,
): () => void {
  let checked: ProjectSession | undefined;
  return project.subscribe(() => {
    const session = project.session();
    if (session === undefined || session === checked) return;
    checked = session;
    sources.check().catch((error: unknown) => {
      logger.error('The files a project links to could not be looked at.', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    });
  });
}

/**
 * Reads the list again when the open project's name is not the one the list
 * shows, once the change is saved, since the header the list reads is written
 * with it. One reading at a time.
 */
export function keepListInStep(
  project: OpenProjectStore,
  library: ProjectLibraryStore,
  logger: Logger,
): () => void {
  let reading = false;
  return project.subscribe(() => {
    const open = project.get();
    if (reading || open.kind !== 'open' || open.snapshot.save.kind !== 'saved') return;
    const name = open.snapshot.model.state.project.displayName;
    const listed = library.headerOf(open.snapshot.project);
    if (listed === undefined || listed.name === name) return;
    reading = true;
    library
      .refresh()
      .catch((error: unknown) => {
        logger.error('The list of projects could not be read again.', {
          reason: error instanceof Error ? error.message : 'unknown',
        });
      })
      .finally(() => {
        reading = false;
      });
  });
}
