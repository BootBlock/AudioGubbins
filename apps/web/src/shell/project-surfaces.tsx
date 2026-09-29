/**
 * The project system's dialogues, mounted together while they are shut as well
 * as open, as every dialogue of the shell is, so each has somewhere to put
 * focus back when it closes: the Projects dialogue, the blocking screen for
 * stored data of another version (REQ-STOR-052), and the question about linked
 * files that changed (REQ-STOR-053).
 */

import type { ReactNode } from 'react';

import type { ProjectsSection } from '../state/interaction-store.js';
import type { ProjectStores } from '../state/project-stores.js';
import type { StorageRootStore } from '../state/storage-root-store.js';
import { CompatibilityScreen } from './compatibility-screen.js';
import { ProjectsDialog } from './projects-dialog.js';
import type { RunCommand } from './settings/section.js';
import { SourceChangePrompt } from './source-change-prompt.js';

/** The dialogues (see the module comment). */
export function ProjectSurfaces({
  root,
  projects,
  section,
  run,
  unavailableReason,
}: {
  readonly root: StorageRootStore;
  readonly projects: ProjectStores | undefined;

  /** The section of the Projects dialogue showing, while it is open. */
  readonly section: ProjectsSection | undefined;
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}): ReactNode {
  if (projects === undefined) return null;
  return (
    <>
      <CompatibilityScreen root={root} run={run} />
      <ProjectsDialog
        section={section}
        projects={projects}
        run={run}
        unavailableReason={unavailableReason}
      />
      <SourceChangePrompt sources={projects.sources} run={run} />
    </>
  );
}
