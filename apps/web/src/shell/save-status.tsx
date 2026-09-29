/**
 * Whether the open project's changes are saved, as the status bar says it
 * (REQ-STOR-021, REQ-EXEC-136.15).
 *
 * Every change is written as it is made, so there is no Save: the status bar
 * says the project is saved, is being saved, or is not being saved and why,
 * with the action that tries again. Changes that stop being saved are said
 * aloud as well, once, since the person is still working and would otherwise
 * lose them unawares.
 */

import { useEffect, useRef, type ReactNode } from 'react';

import type { Announce } from '../commands/voiced-execution.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import { QuickAction } from './panels.js';
import type { RunCommand } from './settings/section.js';

/** The status, where a project is open to change here. */
export function SaveStatus({
  open,
  run,
  announce,
}: {
  readonly open: OpenProjectState | undefined;
  readonly run: RunCommand;
  readonly announce: Announce;
}): ReactNode {
  const writable = open?.kind === 'open' && open.snapshot.access.kind === 'writable';
  const save = writable ? open.snapshot.save : undefined;
  const refused = save?.kind === 'not-saved' ? save.cause.summary : undefined;
  const said = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (refused !== undefined && said.current !== refused) {
      announce(`Your changes are not being saved. ${refused}`, true);
    }
    said.current = refused;
  }, [refused, announce]);

  if (save === undefined) return null;
  switch (save.kind) {
    case 'saved':
      return <span className="ag-status-item">Saved</span>;
    case 'saving':
      return <span className="ag-status-item">Saving…</span>;
    case 'stopped':
      return (
        <span className="ag-status-item" data-ag-status="unavailable">
          Changes are no longer saved here.
        </span>
      );
    case 'not-saved':
      return (
        <span className="ag-status-notice">
          <span className="ag-status-item" data-ag-status="unavailable">
            {`Not saved. ${save.cause.summary}`}
          </span>
          <QuickAction
            label="Try saving again"
            shown="Try again"
            onPress={() => run('project.retry-save')}
          />
        </span>
      );
  }
}
