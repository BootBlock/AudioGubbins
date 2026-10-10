/**
 * The Asset Browser's import controls (ADR-0090, REQ-STOR-025): the button
 * that imports audio files or calls the import off, the one that imports a
 * folder's, the one that clears the list once the import has ended, and the
 * list of files being imported.
 *
 * Importing files and calling the import off are one button, which the import
 * turns from one into the other and back, so the focus stays on it either way.
 * Every button runs its command, so it refuses for the reason the palette
 * gives and says it beside itself. The button that clears the list is there
 * only while an ended import is listed; pressed, it leaves, and the focus it
 * held goes to the import button rather than to the page.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { ImportCommand } from '../../commands/import-export-ids.js';
import type { ProjectStores } from '../../state/project-stores.js';
import { CommandButton, type PanelCommands } from '../command-button.js';
import { ImportList } from './import-list.js';

/** The import controls and the list of files being imported, over the open project. */
export function ImportControl({
  projects,
  commands,
  labelFor,
}: {
  readonly projects: ProjectStores;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;
}): ReactNode {
  const state = useSyncExternalStore(projects.imports.subscribe, projects.imports.get);
  // Followed for the import commands' availability, which the open project
  // decides: the dock mounts a panel once, so nothing above redraws it.
  useSyncExternalStore(projects.project.subscribe, projects.project.get);
  const files = state.kind === 'importing' ? 'file.cancel-import' : ImportCommand.Files;
  const actions = useRef<HTMLDivElement>(null);
  const listed = state.kind === 'ended';
  const wasListed = useRef(listed);
  useEffect(() => {
    // A button that leaves the page drops its focus to the body.
    if (wasListed.current && !listed && document.activeElement === document.body) {
      actions.current?.querySelector('button')?.focus();
    }
    wasListed.current = listed;
  }, [listed]);
  return (
    <div className="ag-asset-import">
      <div className="ag-asset-import-actions" ref={actions}>
        <CommandButton id={files} label={labelFor(files)} commands={commands} compact />
        <CommandButton
          id={ImportCommand.Folder}
          label={labelFor(ImportCommand.Folder)}
          commands={commands}
          compact
        />
        {listed ? (
          <CommandButton
            id="file.clear-imports"
            label={labelFor('file.clear-imports')}
            commands={commands}
            compact
          />
        ) : null}
      </div>
      <ImportList
        job={
          state.kind === 'idle' ? undefined : state.kind === 'ended' ? state.batch.job : state.job
        }
        ended={state.kind === 'ended'}
      />
    </div>
  );
}
