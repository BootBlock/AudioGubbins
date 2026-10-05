/**
 * The panels of the project system, the History panel and the Storage panel, or
 * what is said in their place where this browser keeps no projects
 * (REQ-STOR-196, REQ-STOR-200).
 */

import type { ReactNode } from 'react';

import type { PanelKind } from '@audiogubbins/workspace';

import { ProjectPanelKinds } from '../panel-kinds.js';
import type { ProjectStores } from '../state/project-stores.js';
import { HistoryPanel } from './history/history-panel.js';
import type { RunCommand } from './settings/section.js';
import { StoragePanel } from './storage/storage-panel.js';

/** What a panel of the project system needs, which every panel is given. */
export interface ProjectPanelContext {
  /** The project system's stores, absent where this browser keeps no projects. */
  readonly projects: ProjectStores | undefined;

  /** Why projects cannot be reached now, or `undefined` where they can. */
  readonly projectsUnavailable: string | undefined;

  /** Runs a command a panel's control names. */
  readonly run: RunCommand;

  /** Why a command cannot run now, or `undefined` where it can. */
  readonly unavailableReason: (id: string) => string | undefined;

  /** What a command is called, as the menus and the palette call it. */
  readonly labelFor: (id: string) => string;
}

/** One panel of the project system. */
export function ProjectPanel({
  kind,
  title,
  context,
}: {
  readonly kind: PanelKind;
  readonly title: string;
  readonly context: ProjectPanelContext;
}): ReactNode {
  const { projects, projectsUnavailable, run, unavailableReason, labelFor } = context;
  if (projects === undefined) {
    return (
      <section className="ag-panel">
        <h2 className="ag-panel-title">{title}</h2>
        <p>{projectsUnavailable ?? 'This browser cannot keep projects.'}</p>
      </section>
    );
  }
  return kind === ProjectPanelKinds.History ? (
    <HistoryPanel
      title={title}
      project={projects.project}
      review={projects.review}
      rowOrders={projects.rowOrders}
      run={run}
      unavailableReason={unavailableReason}
      labelFor={labelFor}
    />
  ) : (
    <StoragePanel
      title={title}
      usage={projects.usage}
      library={projects.library}
      run={run}
      unavailable={unavailableReason('storage.measure')}
    />
  );
}
