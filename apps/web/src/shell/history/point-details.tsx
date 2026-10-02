/**
 * What the History panel says in full of the point chosen: every entity the
 * change affected, each offering to show only the changes to it, and the notes
 * of each snapshot kept there (REQ-STOR-196, REQ-STOR-194).
 *
 * A row says what a change affected in a phrase and a note in a line; here
 * both are whole. Which changes the list shows is the panel's view state, so
 * choosing an entity changes no project.
 */

import type { ReactNode } from 'react';

import { Button } from '@audiogubbins/design-system';
import { affectedEntities, type EntityReference, type HistoryRow } from '@audiogubbins/history';

import { quoted } from '../../wording.js';
import { ReasonedButton } from '../settings/reasoned-button.js';
import { describeEntity, type EntityNames } from './entity-names.js';

/** What the details read and do. */
export interface PointDetailsProps {
  readonly row: HistoryRow;
  readonly names: EntityNames;

  /** The entity the list shows the changes to, where it shows only those. */
  readonly affecting: EntityReference | undefined;
  readonly onAffecting: (entity: EntityReference | undefined) => void;
}

/** Whether two references name one entity. */
function sameEntity(one: EntityReference | undefined, other: EntityReference): boolean {
  return one?.kind === other.kind && one.id === other.id;
}

/** The entities the change affected, each with the filter to its changes. */
function Affected({ row, names, affecting, onAffecting }: PointDetailsProps): ReactNode {
  const entities = [...affectedEntities(row.node)];
  const project = row.node.kind === 'change' && row.node.affects.project;
  if (entities.length === 0 && !project) return null;
  return (
    <ul className="ag-history-affected" aria-label="What the change affected">
      {project && <li>The project itself</li>}
      {entities.map((entity) => {
        const said = describeEntity(entity, names);
        return (
          <li key={`${entity.kind}:${entity.id}`}>
            <span>{said}</span>{' '}
            <ReasonedButton
              reason={
                sameEntity(affecting, entity) ? 'The list shows only these changes now.' : undefined
              }
              onPress={() => {
                onAffecting(entity);
              }}
            >
              {`Show only the changes to ${said}`}
            </ReasonedButton>
          </li>
        );
      })}
    </ul>
  );
}

/** The details (see the module comment). */
export function PointDetails(props: PointDetailsProps): ReactNode {
  const { row } = props;
  return (
    <div className="ag-history-details">
      <Affected {...props} />
      {row.snapshots.map((snapshot) =>
        snapshot.notes === undefined ? null : (
          <p key={snapshot.id}>
            <span className="ag-history-row-mark">{`Notes of ${quoted(snapshot.name)}: `}</span>
            {snapshot.notes}
          </p>
        ),
      )}
    </div>
  );
}

/** Which changes the list shows, and the way back to every change. */
export function AffectingFilter({
  affecting,
  names,
  onAffecting,
}: Pick<PointDetailsProps, 'affecting' | 'names' | 'onAffecting'>): ReactNode {
  if (affecting === undefined) return null;
  return (
    <p className="ag-panel-note">
      {`Showing only the changes to ${describeEntity(affecting, names)}.`}{' '}
      <Button
        compact
        tone="quiet"
        onClick={() => {
          onAffecting(undefined);
        }}
      >
        Show every change
      </Button>
    </p>
  );
}
