/**
 * Bringing a project in: from a bundle, or from a folder holding a project
 * taken out unpacked, as a repository keeps one (REQ-STOR-099, REQ-STOR-103).
 *
 * Each button runs the command that asks for the file or folder itself. What
 * happens to a project this browser keeps already is said before it is chosen:
 * it comes in as a copy, and the one kept is left as it was.
 */

import type { ReactNode } from 'react';

import { Spinner } from '@audiogubbins/design-system';

import { CommandButton } from '../command-button.js';
import type { RunCommand } from '../settings/section.js';

/** The two ways in, each a command and its button's words. */
const IMPORTS = [
  ['file.import-bundle', 'Import a bundle…'],
  ['file.import-folder', 'Import a folder…'],
] as const;

/** The Import section. */
export function ImportProjects({
  run,
  unavailableReason,
  working,
}: {
  readonly run: RunCommand;
  readonly unavailableReason: (id: string) => string | undefined;

  /** Whether a project is being brought in now. */
  readonly working: boolean;
}): ReactNode {
  return (
    <div className="ag-dialogue-stack ag-projects-section">
      <p className="ag-dialogue-note">
        A project comes in with its history, its snapshots and the audio it holds. One this browser
        keeps already comes in as a copy, and the one kept here is left as it was.
      </p>
      {working && (
        <p className="ag-dialogue-note ag-dialogue-working" role="status">
          <Spinner />
          Bringing a project in…
        </p>
      )}
      <div className="ag-dialogue-row">
        {IMPORTS.map(([id, label]) => (
          <CommandButton key={id} id={id} label={label} commands={{ run, unavailableReason }} />
        ))}
      </div>
    </div>
  );
}
