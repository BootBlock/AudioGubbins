/**
 * The projects this browser keeps, to open one to change or to read, and the
 * ones deleted, to restore or purge (REQ-STOR-026, REQ-STOR-098).
 *
 * A project whose header cannot be read is listed as such rather than left out,
 * since a project that vanished from the list would look lost.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import type { ProjectId } from '@audiogubbins/domain';
import type { ProjectHeader } from '@audiogubbins/storage';

import type { Observable } from '../../state/observable.js';
import type { LibraryState } from '../../state/project-library-store.js';
import { day, quoted } from '../../wording.js';
import type { RunCommand } from '../settings/section.js';
import { DeletedProjects } from './deleted-projects.js';

/** One project and the ways to open it. */
function ProjectRow({
  header,
  isOpen,
  run,
}: {
  readonly header: ProjectHeader;
  readonly isOpen: boolean;
  readonly run: RunCommand;
}): ReactNode {
  const name = quoted(header.name);
  return (
    <li className="ag-project-row" aria-current={isOpen ? 'true' : undefined}>
      <span className="ag-project-row-name">{header.name}</span>
      <span className="ag-project-row-note">
        {isOpen ? 'Open now' : `Made ${day(header.created)}`}
      </span>
      <span className="ag-project-row-actions">
        <Button
          compact
          label={`Open ${name}`}
          onClick={() => run('file.open', { project: header.id })}
        >
          Open
        </Button>
        <Button
          compact
          label={`Open ${name} to read`}
          onClick={() => run('file.open', { project: header.id, access: 'read' })}
        >
          Open to read
        </Button>
      </span>
    </li>
  );
}

/** The Open section. */
export function ProjectList({
  library,
  open,
  run,
}: {
  readonly library: Observable<LibraryState>;

  /** The project open here, where one is. */
  readonly open: ProjectId | undefined;
  readonly run: RunCommand;
}): ReactNode {
  const state = useSyncExternalStore(library.subscribe, library.get);
  const headers = state.entries.flatMap((entry) =>
    entry.kind === 'project' ? [entry.header] : [],
  );
  const kept = headers.filter((header) => header.deleted === undefined);
  const unreadable = state.entries.length - headers.length;

  return (
    <div className="ag-settings-section">
      {state.problem !== undefined && <p data-ag-status="unavailable">{state.problem}</p>}
      {state.working !== undefined && <p role="status">{`${state.working}…`}</p>}
      {state.loaded && kept.length === 0 && <p>No project is kept in this browser yet.</p>}
      {kept.length > 0 && (
        <ul className="ag-project-list" aria-label="Projects">
          {kept.map((header) => (
            <ProjectRow key={header.id} header={header} isOpen={header.id === open} run={run} />
          ))}
        </ul>
      )}
      {unreadable > 0 && (
        <p className="ag-settings-note" data-ag-status="reduced">
          {unreadable === 1
            ? 'One stored project cannot be read, so it cannot be opened. Nothing of it was changed.'
            : `${String(unreadable)} stored projects cannot be read, so they cannot be opened. Nothing of them was changed.`}
        </p>
      )}
      <DeletedProjects headers={headers} run={run} />
    </div>
  );
}
