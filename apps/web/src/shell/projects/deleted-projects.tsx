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

import { useId, useState, type ReactNode } from 'react';

import { Button, ButtonTone, Icon, List, ListRow } from '@audiogubbins/design-system';
import type { ProjectHeader } from '@audiogubbins/storage';

import { when } from '../../wording.js';
import type { RunCommand } from '../settings/section.js';
import { quoted } from '@audiogubbins/text';

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
    <span className="ag-projects-purge" role="group" aria-label={`Purge ${name}`}>
      <span className="ag-projects-purge-warning">{`Purging removes ${name} and its backups for good.`}</span>
      <Button compact onClick={onKeep}>
        Keep it
      </Button>
      <Button
        compact
        tone={ButtonTone.Destructive}
        onClick={() => run('file.purge-project', { project: header.id, deletedAt: header.deleted })}
      >
        Purge for good
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
    <ListRow
      name={header.name}
      detail="Purging was cut short, so it can no longer be restored."
      leading={<Icon name="delete" />}
      actions={
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
      }
    />
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
    <ListRow
      name={header.name}
      detail={`Deleted ${when(header.deleted)}`}
      leading={<Icon name="delete" />}
      actions={
        confirming ? (
          <PurgeConfirmation
            header={header}
            onKeep={() => {
              setConfirming(false);
            }}
            run={run}
          />
        ) : (
          <>
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
          </>
        )
      }
    />
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
  const heading = useId();
  const deleted = headers.flatMap((header) =>
    header.deleted === undefined ? [] : [{ ...header, deleted: header.deleted }],
  );
  if (deleted.length === 0) return null;
  return (
    <div className="ag-dialogue-group" role="group" aria-labelledby={heading}>
      <h3 className="ag-dialogue-heading" id={heading}>
        Deleted projects
      </h3>
      <List>
        {deleted.map((header) =>
          header.purging === undefined ? (
            <DeletedProject key={header.id} header={header} run={run} />
          ) : (
            <CutShort key={header.id} header={header} run={run} />
          ),
        )}
      </List>
    </div>
  );
}
