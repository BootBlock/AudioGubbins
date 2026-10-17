/**
 * The projects this browser keeps, to open one to change or to read, and the
 * ones deleted, to restore or purge (REQ-STOR-026, REQ-STOR-098).
 *
 * A project whose header cannot be read is listed as such rather than left out,
 * since a project that vanished from the list would look lost.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { Banner, BannerTone, Button, Icon, List, ListRow } from '@audiogubbins/design-system';
import type { ProjectId } from '@audiogubbins/domain';
import type { ProjectHeader } from '@audiogubbins/storage';

import type { Observable } from '../../state/observable.js';
import type { LibraryState } from '../../state/project-library-store.js';
import { day } from '../../wording.js';
import type { RunCommand } from '../settings/section.js';
import { DeletedProjects } from './deleted-projects.js';
import { quoted } from '@audiogubbins/text';

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
    <ListRow
      name={header.name}
      detail={isOpen ? 'Open now' : `Made ${day(header.created)}`}
      leading={<Icon name={isOpen ? 'open-project' : 'project'} />}
      chosen={isOpen}
      actions={
        <>
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
        </>
      }
    />
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
    <div className="ag-dialogue-stack ag-projects-section">
      {state.problem !== undefined && (
        <Banner tone={BannerTone.Error} icon="error">
          {state.problem}
        </Banner>
      )}
      {state.working !== undefined && (
        <p className="ag-dialogue-note" role="status">{`${state.working}…`}</p>
      )}
      {state.loaded && kept.length === 0 && (
        <p className="ag-dialogue-note">No project is kept in this browser yet.</p>
      )}
      {kept.length > 0 && (
        <List label="Projects">
          {kept.map((header) => (
            <ProjectRow key={header.id} header={header} isOpen={header.id === open} run={run} />
          ))}
        </List>
      )}
      {unreadable > 0 && (
        <Banner tone={BannerTone.Warning} icon="unreadable-project">
          {unreadable === 1
            ? 'One stored project cannot be read, so it cannot be opened. Nothing of it was changed.'
            : `${String(unreadable)} stored projects cannot be read, so they cannot be opened. Nothing of them was changed.`}
        </Banner>
      )}
      <DeletedProjects headers={headers} run={run} />
    </div>
  );
}
