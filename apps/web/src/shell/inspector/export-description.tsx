/**
 * An export in the Inspector (REQ-EDIT-072, ADR-0092): the page's export as
 * it runs, waits or last ended, a file each with where it has got and where
 * it goes, or an export the open project's history records, with everything
 * the record keeps (`export-facts.ts`). It follows each store it reads, so a
 * file's stage, a delivery elsewhere and a folder no longer trusted are shown
 * as they change; it changes nothing itself.
 */

import { useId, useSyncExternalStore, type ReactNode } from 'react';

import { unsafeBrandId, type RegionId } from '@audiogubbins/domain';
import type { ProjectModel } from '@audiogubbins/storage';
import { quoted } from '@audiogubbins/text';

import { keptFolders } from '../../export/export-blockers.js';
import type { ExportSubject } from '../../export/export-focus.js';
import type { ExportRunState } from '../../export/export-types.js';
import type { Observable } from '../../state/observable.js';
import type { ProjectStores } from '../../state/project-stores.js';
import type { TrustedFoldersState } from '../../state/trusted-folders-store.js';
import { describeNode } from '../history/history-words.js';
import {
  batchFacts,
  describedJobs,
  recordFacts,
  type ExportWording,
  type ShownExport,
} from './export-facts.js';
import { Facts } from './facts.js';

/** A store that never changes, standing in for one this browser keeps none of. */
function unchanging<T>(value: T): Observable<T> {
  return { get: () => value, subscribe: () => () => undefined };
}

const NO_EXPORT = unchanging<ExportRunState>({ kind: 'idle' });
const NO_PROJECT = unchanging(undefined);
const NO_FOLDERS = unchanging<TrustedFoldersState | undefined>(undefined);

/** What the description reads. */
export interface ExportDescriptionParts {
  /** The page's export, absent where this browser keeps no projects. */
  readonly exports: Observable<ExportRunState> | undefined;
  readonly projects: ProjectStores | undefined;
}

/** The names the facts are worded with, from the open project's model and the folders kept trusted. */
function wordingOf(
  model: ProjectModel | undefined,
  trusted: TrustedFoldersState | undefined,
): ExportWording {
  const folders = trusted === undefined ? [] : keptFolders(trusted);
  return {
    regionName: (region: RegionId) => model?.state.project.regions.get(region)?.displayName,
    trustedName: (key) => folders.find((folder) => folder.key === key)?.name,
    pointName: (node) => {
      const found = model?.history.nodes.get(unsafeBrandId<'HistoryNodeId'>(node));
      return found === undefined ? undefined : describeNode(found);
    },
  };
}

/** What the page's export is called, by where it is. */
function batchHeading(state: ShownExport): string {
  switch (state.kind) {
    case 'running':
      return 'The export under way';
    case 'held':
      return 'The export waiting';
    case 'ended':
      return 'The last export';
  }
}

/** The page's export, and each of its files. */
function BatchDescription({
  state,
  wording,
}: {
  readonly state: ShownExport;
  readonly wording: ExportWording;
}): ReactNode {
  const heading = useId();
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {batchHeading(state)}
      </h3>
      <Facts facts={batchFacts(state, wording)} />
      <ul className="ag-inspector-files" aria-label="Files of the export">
        {describedJobs(state, wording).map((job) => (
          <li key={job.id}>
            <h4 className="ag-inspector-heading">{job.name}</h4>
            <Facts facts={job.facts} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An export the open project's history records, or why it cannot be shown. */
function RecordDescription({
  record: id,
  model,
  wording,
}: {
  readonly record: Extract<ExportSubject, { readonly kind: 'record' }>['record'];
  readonly model: ProjectModel | undefined;
  readonly wording: ExportWording;
}): ReactNode {
  const heading = useId();
  const record = model?.exports.find((one) => one.id === id);
  const name = record?.file?.fileName;
  return (
    <section className="ag-inspector-section" aria-labelledby={heading}>
      <h3 className="ag-inspector-heading" id={heading}>
        {name === undefined ? 'An export' : `Export: ${quoted(name)}`}
      </h3>
      {record === undefined ? (
        <p>That export is not in the history of the project open now.</p>
      ) : (
        <Facts facts={recordFacts(record, wording)} />
      )}
    </section>
  );
}

/** The export `subject` names, as the Inspector describes it (see the module comment). */
export function ExportDescription({
  subject,
  parts,
}: {
  readonly subject: ExportSubject;
  readonly parts: ExportDescriptionParts;
}): ReactNode {
  const exports = parts.exports ?? NO_EXPORT;
  const state = useSyncExternalStore(exports.subscribe, exports.get);
  const project = parts.projects?.project ?? NO_PROJECT;
  const open = useSyncExternalStore(project.subscribe, project.get);
  const folders = parts.projects?.trustedFolders ?? NO_FOLDERS;
  const trusted = useSyncExternalStore(folders.subscribe, folders.get);
  const model = open?.kind === 'open' ? open.snapshot.model : undefined;
  const wording = wordingOf(model, trusted);
  if (subject.kind === 'record') {
    return <RecordDescription record={subject.record} model={model} wording={wording} />;
  }
  return state.kind === 'idle' ? (
    <p>No export has run since the page opened.</p>
  ) : (
    <BatchDescription state={state} wording={wording} />
  );
}
