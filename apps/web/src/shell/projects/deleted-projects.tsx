/**
 * The projects deleted and not yet purged: restoring one, and purging one for
 * good once the person has read what that removes (REQ-STOR-026, REQ-STOR-102).
 *
 * Deleting only hides a project, so everything it held is kept until it is
 * purged. Purging asks a second time, beside the sentence saying the project
 * and its backups go for good, and confirms the deletion the person was shown,
 * which the storage checks. A purge that was cut short has removed part of the
 * project already, so it cannot be restored: the person, who confirmed it
 * once, can only finish it.
 */

import { useState, type ReactNode } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';
import type { ProjectHeader } from '@audiogubbins/storage';

import { quoted } from '../../wording.js';
import type { RunCommand } from '../settings/section.js';

/** How a date is written in the list. */
const WHEN = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** A deleted project, as the list holds it. */
type Deleted = ProjectHeader & { readonly deleted: number };

/** Purging a deleted project, once the person has read that it goes for good. */
function PurgeConfirmation({
  header,
  onKeep,
  run,
}: {
  readonly header: Deleted;
  readonly onKeep: () => void;
  readonly run: RunCommand;
}): ReactNode {
  const name = quoted(header.name);
  return (
    <span className="ag-project-row-actions" role="group" aria-label={`Purge ${name}`}>
      <span data-ag-status="unavailable">{`Purging removes ${name} and its backups for good.`}</span>
      <Button
        compact
        tone={ButtonTone.Destructive}
        onClick={() => run('file.purge-project', { project: header.id, deletedAt: header.deleted })}
      >
        Purge for good
      </Button>
      <Button compact onClick={onKeep}>
        Keep it
      </Button>
    </span>
  );
}

/** A deleted project whose purge was cut short, which can only be finished. */
function CutShort({
  header,
  run,
}: {
  readonly header: Deleted;
  readonly run: RunCommand;
}): ReactNode {
  const name = quoted(header.name);
  return (
    <li className="ag-project-row">
      <span className="ag-project-row-name">{header.name}</span>
      <span className="ag-project-row-note">
        Purging was cut short, so it can no longer be restored.
      </span>
      <span className="ag-project-row-actions">
        <Button
          compact
          tone={ButtonTone.Destructive}
          label={`Finish purging ${name}`}
          onClick={() =>
            run('file.purge-project', { project: header.id, deletedAt: header.deleted })
          }
        >
          Finish purging
        </Button>
      </span>
    </li>
  );
}

/** One deleted project and what can be done with it. */
function DeletedProject({
  header,
  run,
}: {
  readonly header: Deleted;
  readonly run: RunCommand;
}): ReactNode {
  const [confirming, setConfirming] = useState(false);
  const name = quoted(header.name);
  return (
    <li className="ag-project-row">
      <span className="ag-project-row-name">{header.name}</span>
      <span className="ag-project-row-note">{`Deleted ${WHEN.format(header.deleted)}`}</span>
      {confirming ? (
        <PurgeConfirmation
          header={header}
          onKeep={() => {
            setConfirming(false);
          }}
          run={run}
        />
      ) : (
        <span className="ag-project-row-actions">
          <Button
            compact
            label={`Restore ${name}`}
            onClick={() => run('file.restore-project', { project: header.id })}
          >
            Restore
          </Button>
          <Button
            compact
            label={`Purge ${name}…`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Purge…
          </Button>
        </span>
      )}
    </li>
  );
}

/** Every deleted project, or nothing where none is. */
export function DeletedProjects({
  headers,
  run,
}: {
  readonly headers: readonly ProjectHeader[];
  readonly run: RunCommand;
}): ReactNode {
  const deleted = headers.flatMap((header) =>
    header.deleted === undefined ? [] : [{ ...header, deleted: header.deleted }],
  );
  if (deleted.length === 0) return null;
  return (
    <div role="group" aria-label="Deleted projects">
      <h3 className="ag-section-heading">Deleted projects</h3>
      <ul className="ag-project-list">
        {deleted.map((header) =>
          header.purging === undefined ? (
            <DeletedProject key={header.id} header={header} run={run} />
          ) : (
            <CutShort key={header.id} header={header} run={run} />
          ),
        )}
      </ul>
    </div>
  );
}
