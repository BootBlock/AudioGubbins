/**
 * The Projects dialogue: making a project, opening one, what can be done with
 * the one open, and bringing one in (REQ-STOR-026, REQ-STOR-103, REQ-STOR-199,
 * REQ-UX-005).
 *
 * The File menu opens it at the section each entry names, and each section is a
 * tab, so everything is present and only what was asked for is on screen.
 * Opening, switching sections and closing are commands, like every control
 * inside it (REQ-EDIT-073).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { ModalDialog, TabSet, type TabDescriptor } from '@audiogubbins/design-system';
import type { ProjectSnapshot } from '@audiogubbins/storage';

import { ProjectsSection } from '../state/interaction-store.js';
import type { Observable } from '../state/observable.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import type { LibraryState } from '../state/project-library-store.js';
import type { TransferState } from '../state/project-transfer-store.js';
import { CurrentProject } from './projects/current-project.js';
import { ImportProjects } from './projects/import-projects.js';
import { NewProject } from './projects/new-project.js';
import { ProjectList } from './projects/project-list.js';
import type { RunCommand } from './settings/section.js';

/** What the dialogue needs. */
export interface ProjectsDialogProps {
  /** The section showing, while the dialogue is open. */
  readonly section: ProjectsSection | undefined;
  readonly projects: {
    readonly project: Observable<OpenProjectState>;
    readonly transfer: Observable<TransferState>;
    readonly library: Observable<LibraryState>;
  };
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;
}

/** The dialogue's sections, each a tab. */
function sectionsOf(
  { projects, run, unavailableReason }: ProjectsDialogProps,
  open: ProjectSnapshot | undefined,
  importing: boolean,
): readonly TabDescriptor[] {
  return [
    {
      value: ProjectsSection.Open,
      label: 'Open',
      content: <ProjectList library={projects.library} open={open?.project} run={run} />,
    },
    {
      value: ProjectsSection.New,
      label: 'New',
      content: <NewProject run={run} unavailable={unavailableReason('file.create-project')} />,
    },
    {
      value: ProjectsSection.Current,
      label: 'This project',
      content: (
        <CurrentProject
          // Made afresh for another project, so its fields start from that
          // project's name rather than keep the last one's.
          key={open?.project}
          name={open?.model.state.project.displayName}
          run={run}
          unavailableReason={unavailableReason}
        />
      ),
    },
    {
      value: ProjectsSection.Import,
      label: 'Import',
      content: (
        <ImportProjects run={run} unavailableReason={unavailableReason} working={importing} />
      ),
    },
  ];
}

/** The dialogue (see the module comment). */
export function ProjectsDialog(props: ProjectsDialogProps): ReactNode {
  const { section, projects, run } = props;
  const open = useSyncExternalStore(projects.project.subscribe, projects.project.get);
  const transfer = useSyncExternalStore(projects.transfer.subscribe, projects.transfer.get);
  const openNow = open.kind === 'open' ? open.snapshot : undefined;

  return (
    <ModalDialog
      open={section !== undefined}
      onOpenChange={(opened) => {
        if (!opened) run('file.close-projects');
      }}
      title="Projects"
      description="Make, open and bring in projects, and look after the one open."
    >
      <TabSet
        label="Projects sections"
        value={section ?? ProjectsSection.Open}
        onValueChange={(chosen) => run('file.projects', { section: chosen })}
        tabs={sectionsOf(props, openNow, transfer.working === 'importing')}
      />
    </ModalDialog>
  );
}
