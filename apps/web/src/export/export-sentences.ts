/**
 * What the person is told of an export once its batch has settled (ADR-0092):
 * the files exported, failed and cancelled, or the files that wait after a
 * refused delivery and what may be done with them. Only a whole delivered
 * file is said to be exported.
 */

import {
  safeFileName,
  type ExportBatch,
  type ExportJob,
  type PlannedFile,
} from '@audiogubbins/import-export';
import { counted, quoted } from '@audiogubbins/text';

/**
 * What came of a batch every job of which has ended, naming a single file by
 * the name it was written under, from `names`, which a rename may have
 * changed from the one wanted.
 */
export function endedSentence(batch: ExportBatch, names: ReadonlyMap<string, string>): string {
  const delivered = batch.jobs.filter((job) => job.state.kind === 'delivered');
  const failed = batch.jobs.filter(
    (job): job is ExportJob & { state: { kind: 'failed' } } => job.state.kind === 'failed',
  );
  const cancelled = batch.jobs.filter((job) => job.state.kind === 'cancelled').length;
  const parts: string[] = [];
  const [only] = delivered;
  const name = only === undefined ? undefined : names.get(only.id);
  if (delivered.length === 1 && name !== undefined) {
    parts.push(`${quoted(name)} is exported.`);
  } else if (delivered.length > 1) {
    parts.push(`${counted(delivered.length, 'file is', 'files are')} exported.`);
  }
  const [firstFailure] = failed;
  if (firstFailure !== undefined) {
    parts.push(
      `${counted(failed.length, 'file', 'files')} could not be exported: ${firstFailure.state.failure.summary}`,
    );
  }
  if (cancelled > 0) {
    parts.push(
      `${counted(cancelled, 'file was', 'files were')} cancelled, and nothing of ${cancelled === 1 ? 'it' : 'them'} was kept.`,
    );
  }
  return parts.length === 0 ? 'Nothing was exported.' : parts.join(' ');
}

/** What is said of a held batch: the files that wait, and why the first was refused. */
export function heldSentence(batch: ExportBatch, files: ReadonlyMap<string, PlannedFile>): string {
  const waiting = batch.jobs.filter((job) => job.state.kind === 'staged');
  const [first] = waiting;
  const reason = first?.state.kind === 'staged' ? first.state.refused?.summary : undefined;
  const name = first === undefined ? undefined : files.get(first.id)?.name;
  const which =
    waiting.length === 1 && name !== undefined
      ? quoted(safeFileName(name))
      : counted(waiting.length, 'file', 'files');
  return `${which} could not be delivered${reason === undefined ? '' : `: ${reason}`} It is kept, so you can retry, choose another destination, or cancel the export, with no new render.`;
}
