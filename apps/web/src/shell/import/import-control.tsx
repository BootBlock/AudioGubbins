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

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { Button, ButtonTone, Icon, IconButton } from '@audiogubbins/design-system';

import { ImportCommand } from '../../commands/import-export-ids.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { PanelCommands } from '../command-button.js';
import { FOLDER_CALL } from './import-words.js';
import { ImportList } from './import-list.js';

/** A button's reason, given only while it has one. */
function unavailable(reason: string | undefined): { readonly unavailableReason?: string } {
  return reason === undefined ? {} : { unavailableReason: reason };
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
  const actions = useRef<HTMLDivElement>(null);
  const listed = imports.kind === 'ended';
  const wasListed = useRef(listed);
  useEffect(() => {
    // A button that leaves the page drops its focus to the body.
    if (wasListed.current && !listed && document.activeElement === document.body) {
      actions.current?.querySelector('button')?.focus();
    }
    wasListed.current = listed;
  }, [listed]);
  const filesReason = commands.unavailableReason(files);
  const folderReason = commands.unavailableReason(ImportCommand.Folder);
  const clearReason = commands.unavailableReason('file.clear-imports');
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
            <IconButton
              icon="clear"
              label={labelFor('file.clear-imports')}
              hint={labelFor('file.clear-imports')}
              compact
              {...unavailable(clearReason)}
              onClick={() => {
                commands.run('file.clear-imports');
              }}
            />
          ) : null
        }
      />
      {state}
      <div className="ag-assets-import-actions" ref={actions}>
        {/* One element whether it is drawn as a call to action or a glyph, so
            the focus stays on it as the panel's state changes. Each says it
            can be used as well as when it cannot, as the menus' entries do. */}
        <Button
          tone={calling ? ButtonTone.Primary : ButtonTone.Quiet}
          compact
          {...(calling ? { label: labelFor(files) } : { iconOnly: true, label: labelFor(files) })}
          {...(calling ? {} : { hint: labelFor(files) })}
          aria-disabled={filesReason !== undefined}
          {...unavailable(filesReason)}
          onClick={() => {
            commands.run(files);
          }}
        >
          <Icon name={imports.kind === 'importing' ? 'cancel' : 'import-audio'} />
          {calling && labelFor(files)}
        </Button>
        <Button
          tone={calling ? ButtonTone.Neutral : ButtonTone.Quiet}
          compact
          {...(calling
            ? { label: labelFor(ImportCommand.Folder) }
            : { iconOnly: true, label: labelFor(ImportCommand.Folder) })}
          {...(calling ? {} : { hint: labelFor(ImportCommand.Folder) })}
          aria-disabled={folderReason !== undefined}
          {...unavailable(folderReason)}
          onClick={() => {
            commands.run(ImportCommand.Folder);
          }}
        >
          <Icon name="import-folder" />
          {calling && FOLDER_CALL}
        </Button>
      </div>
    </div>
  );
}
