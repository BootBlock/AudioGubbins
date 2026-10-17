/**
 * The Asset Browser's import controls (ADR-0090, REQ-STOR-025): the button
 * that imports audio files or calls the import off, the one that imports a
 * folder's, the one that clears the list once the import has ended, and the
 * list of files being imported.
 *
 * Importing files and calling the import off are one button, which the import
 * turns from one into the other and back, so the focus stays on it either way.
 * Every button runs its command, so it refuses for the reason the palette
 * gives, opened on hover or focus and tied to it. The button that clears the
 * list is there only while an ended import is listed; pressed, it leaves, and
 * the focus it held goes to the import button rather than to the page.
 *
 * The panel's state when it lists nothing (no project, or a project with no
 * audio) is drawn here, between the import's list and its buttons, so that in
 * a project with no audio the two buttons are that state's calls to action
 * and are still the same two elements once audio arrives: moving them to
 * another part of the tree would mount them again and drop the focus.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';

import { ButtonTone } from '@audiogubbins/design-system';

import { ImportCommand } from '../../commands/import-export-ids.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';
import { ClearImportsButton, ImportButton } from './import-buttons.js';
import { FOLDER_CALL } from './import-words.js';
import { ImportList } from './import-list.js';

/**
 * The element holding the import buttons, whose first takes the focus the
 * clearing button held once the list it cleared, and the button, leave.
 */
function useFocusKeptOnClearing(listed: boolean): RefObject<HTMLDivElement | null> {
  const actions = useRef<HTMLDivElement>(null);
  const wasListed = useRef(listed);
  useEffect(() => {
    // A button that leaves the page drops its focus to the body.
    if (wasListed.current && !listed && document.activeElement === document.body) {
      actions.current?.querySelector('button')?.focus();
    }
    wasListed.current = listed;
  }, [listed]);
  return actions;
}

/** The import controls and the list of files being imported, over the open project. */
export function ImportControl({
  projects,
  commands,
  labelFor,
  state,
  calling = false,
}: {
  readonly projects: ProjectStores;
  readonly commands: PanelCommands;
  readonly labelFor: (id: string) => string;

  /** What the panel shows in place of its list, where it lists nothing. */
  readonly state?: ReactNode;

  /** Whether the import buttons are drawn as the calls to action of `state`. */
  readonly calling?: boolean;
}): ReactNode {
  const imports = useSyncExternalStore(projects.imports.subscribe, projects.imports.get);
  // Followed for the import commands' availability, which the open project
  // decides: the dock mounts a panel once, so nothing above redraws it.
  useSyncExternalStore(projects.project.subscribe, projects.project.get);
  const files = imports.kind === 'importing' ? 'file.cancel-import' : ImportCommand.Files;
  const listed = imports.kind === 'ended';
  const actions = useFocusKeptOnClearing(listed);
  return (
    <div className="ag-assets-import" data-ag-calling={calling ? '' : undefined}>
      <ImportList
        job={
          imports.kind === 'idle'
            ? undefined
            : imports.kind === 'ended'
              ? imports.batch.job
              : imports.job
        }
        ended={imports.kind === 'ended'}
        actions={
          listed ? (
            <ClearImportsButton label={labelFor('file.clear-imports')} commands={commands} />
          ) : null
        }
      />
      {state}
      <div className="ag-assets-import-actions" ref={actions}>
        <ImportButton
          id={files}
          icon={imports.kind === 'importing' ? 'cancel' : 'import-audio'}
          label={labelFor(files)}
          call={labelFor(files)}
          callTone={ButtonTone.Primary}
          calling={calling}
          commands={commands}
        />
        <ImportButton
          id={ImportCommand.Folder}
          icon="import-folder"
          label={labelFor(ImportCommand.Folder)}
          call={FOLDER_CALL}
          callTone={ButtonTone.Neutral}
          calling={calling}
          commands={commands}
        />
      </div>
    </div>
  );
}
