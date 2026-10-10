/**
 * The project system's dialogues, mounted together while they are shut as well
 * as open, as every dialogue of the shell is, so each has somewhere to put
 * focus back when it closes: the Projects dialogue, the blocking screen for
 * stored data of another version (REQ-STOR-052), the question about linked
 * files that changed (REQ-STOR-053), and the Export dialog (ADR-0092).
 */

import type { ReactNode } from 'react';

import type { ProjectsSection } from '../state/interaction-store.js';
import type { ProjectStores } from '../state/project-stores.js';
import type { StorageRootStore } from '../state/storage-root-store.js';
import type { ExportServices } from '../export/export-types.js';
import type { OwnExportPreset } from '../state/stored-export-presets.js';
import { CompatibilityScreen } from './compatibility-screen.js';
import { ExportDialog } from './export/export-dialog.js';
import { ProjectsDialog } from './projects-dialog.js';
import type { RunCommand } from './settings/section.js';
import { SourceChangePrompt } from './source-change-prompt.js';

/** The dialogues (see the module comment). */
export function ProjectSurfaces({
  root,
  projects,
  exports,
  presets,
  section,
  run,
  unavailableReason,
}: {
  readonly root: StorageRootStore;
  readonly projects: ProjectStores | undefined;

  /** The page's export, absent where none is offered. */
  readonly exports: ExportServices | undefined;

  /** The person's own export presets. */
  readonly presets: readonly OwnExportPreset[];

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
      <SourceChangePrompt sources={projects.sources} project={projects.project} run={run} />
      {exports !== undefined && (
        <ExportDialog
          dialog={projects.exportDialog}
          exports={exports}
          presets={presets}
          run={run}
          unavailableReason={unavailableReason}
        />
      )}
    </>
  );
}
