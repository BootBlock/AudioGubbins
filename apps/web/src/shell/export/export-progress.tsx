/**
 * The export under way, and a file it could not deliver (ADR-0092, REQ-UX-005):
 * how far the batch has got, each file with where it is, and what the person
 * may do.
 *
 * Open while an export runs, except while the collision prompt asks about a
 * taken name, and while it is held. Running, it offers to cancel. Held, each
 * file that waits says why its delivery was refused and offers to retry it,
 * save it as a file or deliver it into another folder, none of which renders
 * it again, and the export may be cancelled, which gives the waiting files up.
 * It does not close by itself on Escape: the export goes on, or waits, until
 * it ends or the person cancels it, and an ended export is said aloud.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import {
  Button,
  ButtonTone,
  Icon,
  IconSize,
  ModalDialog,
  ProgressBar,
  ProgressPlace,
  Spinner,
} from '@audiogubbins/design-system';
import {
  batchProgress,
  safeFileName,
  type ExportJob,
  type PlannedFile,
} from '@audiogubbins/import-export';
import { counted } from '@audiogubbins/text';

import { ExportCommand } from '../../commands/import-export-ids.js';
import type { ExportRunState } from '../../export/export-types.js';
import type { Observable } from '../../state/observable.js';
import type { RunCommand } from '../settings/section.js';
import { stageWords } from './export-job-words.js';

/** The mark before a file: done, refused, under way, or waiting its turn. */
function StageMark({ job }: { readonly job: ExportJob }): ReactNode {
  switch (job.state.kind) {
    case 'delivered':
      return <Icon name="success" size={IconSize.Inline} className="ag-export-job-done" />;
    case 'failed':
      return <Icon name="error" size={IconSize.Inline} className="ag-export-job-failed" />;
    case 'staged':
      return job.state.refused === undefined ? (
        <Icon name="waiting" size={IconSize.Inline} />
      ) : (
        <Icon name="warning" size={IconSize.Inline} className="ag-export-job-held" />
      );
    case 'cancelled':
      return <Icon name="skipped" size={IconSize.Inline} />;
    case 'planned':
      return <Icon name="waiting" size={IconSize.Inline} />;
    case 'rendering':
    case 'encoding':
    case 'delivering':
      return <Spinner size={IconSize.Inline} />;
  }
}

/** Whether a file is the one being worked on now. */
function underWay(job: ExportJob): boolean {
  const { kind } = job.state;
  return kind === 'rendering' || kind === 'encoding' || kind === 'delivering';
}

/** One file of the batch, and, where it waits, what may be done with it. */
function JobRow({
  job,
  file,
  held,
  run,
}: {
  readonly job: ExportJob;
  readonly file: PlannedFile | undefined;
  readonly held: boolean;
  readonly run: RunCommand;
}): ReactNode {
  const name = file === undefined ? job.id : safeFileName(file.name);
  const waiting = held && job.state.kind === 'staged';
  return (
    <li className="ag-export-job" {...(underWay(job) ? { 'data-ag-active': '' } : {})}>
      <StageMark job={job} />
      <span className="ag-export-job-name">{name}</span>{' '}
      <span className="ag-export-job-stage">{stageWords(job)}</span>
      {waiting && (
        <div
          className="ag-dialogue-row ag-export-job-actions"
          role="group"
          aria-label={`What to do with ${name}`}
        >
          <Button onClick={() => run(ExportCommand.Retry, { job: job.id })}>Retry</Button>
          <Button onClick={() => run(ExportCommand.DeliverElsewhere, { job: job.id, to: 'file' })}>
            Save as a file…
          </Button>
          <Button
            onClick={() => run(ExportCommand.DeliverElsewhere, { job: job.id, to: 'folder' })}
          >
            Deliver into a folder…
          </Button>
        </div>
      )}
    </li>
  );
}

/** The export's progress (see the module comment). */
export function ExportProgress({
  exports,
  run,
}: {
  readonly exports: Observable<ExportRunState>;
  readonly run: RunCommand;
}): ReactNode {
  const state = useSyncExternalStore(exports.subscribe, exports.get);
  const open = (state.kind === 'running' && state.asking === undefined) || state.kind === 'held';
  const held = state.kind === 'held';
  const shown = state.kind === 'running' || state.kind === 'held' ? state : undefined;
  const progress = shown === undefined ? undefined : batchProgress(shown.batch);
  return (
    <ModalDialog
      open={open}
      // Neither Escape nor a click outside ends an export: it runs, or waits,
      // until it ends or the person cancels it.
      onOpenChange={() => undefined}
      title={held ? 'The export is waiting' : 'Exporting'}
      icon={held ? 'warning' : 'export'}
      description={
        held
          ? 'A file could not be delivered. It is kept, so it needs no new render: retry it, deliver it elsewhere, or cancel the export.'
          : `Exporting ${counted(progress?.jobsTotal ?? 0, 'file', 'files')}: ${String(progress?.jobsSettled ?? 0)} done.`
      }
      actions={
        <Button tone={ButtonTone.Destructive} onClick={() => run(ExportCommand.Cancel)}>
          Cancel the export
        </Button>
      }
    >
      {shown !== undefined && progress !== undefined && (
        <div className="ag-dialogue-stack">
          <ProgressBar
            label="Export progress"
            place={ProgressPlace.Dialogue}
            value={progress.framesRendered / Math.max(1, progress.framesTotal)}
          />
          <ul aria-label="Files being exported" className="ag-export-jobs">
            {shown.batch.jobs.map((job) => (
              <JobRow key={job.id} job={job} file={shown.files.get(job.id)} held={held} run={run} />
            ))}
          </ul>
        </div>
      )}
    </ModalDialog>
  );
}
