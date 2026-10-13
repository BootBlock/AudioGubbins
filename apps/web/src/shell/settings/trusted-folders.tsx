/**
 * The folders kept trusted for exports, in the export settings (ADR-0092,
 * REQ-ARCH-054): what trusting one does, said before the person chooses one,
 * each folder with the button that lets it go, and why there are none where
 * this browser keeps none. Every control runs a command.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import { quoted } from '@audiogubbins/text';

import { ExportCommand } from '../../commands/import-export-ids.js';
import type { TrustedFoldersStore } from '../../state/trusted-folders-store.js';
import type { RunCommand } from './section.js';

/** What trusting a folder does, said wherever one can be trusted. */
const WHAT_IT_DOES =
  'In a trusted folder, an export replaces a file AudioGubbins exported there before without asking, as long as that file is unchanged since. Any other file of the same name is dealt with as the export says: asked about, kept beside, skipped or replaced. Trusted folders belong to this browser on this computer, not to a project.';

/** The trusted folders (see the module comment). */
export function TrustedFoldersSection({
  store,
  run,
}: {
  readonly store: TrustedFoldersStore;
  readonly run: RunCommand;
}): ReactNode {
  const state = useSyncExternalStore(store.subscribe, store.get);
  useEffect(() => {
    // Read as the section opens, since another window may have changed the list.
    void store.refresh();
  }, [store]);
  if (state.kind === 'unavailable') {
    return (
      <section className="ag-settings-section" aria-label="Trusted folders">
        <p className="ag-settings-note">{state.reason}</p>
      </section>
    );
  }
  return (
    <section className="ag-settings-section" aria-label="Trusted folders">
      <p className="ag-settings-note">{WHAT_IT_DOES}</p>
      {state.kind === 'reading' && <p role="status">Reading the trusted folders…</p>}
      {state.kind === 'failed' && <p role="status">{state.reason}</p>}
      {state.kind === 'read' &&
        (state.folders.length === 0 ? (
          <p role="status">No folder is trusted.</p>
        ) : (
          <ul aria-label="Trusted folders" className="ag-trusted-folders">
            {state.folders.map((folder) => (
              <li key={folder.key} className="ag-settings-row">
                <span>{folder.name}</span>
                <Button
                  label={`Stop trusting ${quoted(folder.name)}`}
                  onClick={() => run(ExportCommand.ForgetFolder, { key: folder.key })}
                >
                  Stop trusting
                </Button>
              </li>
            ))}
          </ul>
        ))}
      <div className="ag-settings-row">
        <Button onClick={() => run(ExportCommand.TrustFolder)}>Trust a folder…</Button>
      </div>
    </section>
  );
}
