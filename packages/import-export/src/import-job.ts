/**
 * A batch import as a state machine (ADR-0090, REQ-ARCH-153).
 *
 * Each file goes `queued → analysing → copying → decoding → adding →
 * imported`, skipping a stage it does not need, a file linked rather than
 * copied, or one read in place rather than decoded to a rendition, but never
 * going back; or it is `refused` with the reason, or `cancelled`. One file's
 * refusal stops nothing else.
 *
 * Files run one at a time, with the codec worker decoding ahead by at most
 * one: a file leaves the queue only once every file before it has ended,
 * save the one just before it, which may be adding to the project while this
 * one begins. Cancelling stops the file in progress and every file after it;
 * what was imported before stays.
 */

import { fail, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';

import { conflict } from './refusal.js';

/** A file chosen for import, as the person sees it listed. */
export interface ImportFile {
  readonly name: string;
  readonly bytes: number;
}

/** A stage a file is in before it ends, in the order they come. */
export type ImportStage = 'queued' | 'analysing' | 'copying' | 'decoding' | 'adding';

const ORDER: readonly ImportStage[] = ['queued', 'analysing', 'copying', 'decoding', 'adding'];

/** Where one file is. */
export type ImportFileState =
  | { readonly kind: 'queued' | 'analysing' | 'adding' }
  | { readonly kind: 'copying'; readonly bytesCopied: number; readonly bytesTotal: number }
  | { readonly kind: 'decoding'; readonly framesDecoded: number; readonly framesTotal: number }
  | { readonly kind: 'imported' }
  | { readonly kind: 'refused'; readonly stage: ImportStage; readonly failure: DomainFailure }
  | { readonly kind: 'cancelled'; readonly stage: ImportStage };

/** One file of an import, and where it is. */
export interface ImportEntry {
  readonly file: ImportFile;
  readonly state: ImportFileState;
}

/** An import of a list of files, in the order they run. */
export interface ImportJob {
  readonly entries: readonly ImportEntry[];
}

/** What the workers report of one file. */
export type ImportFileEvent =
  | { readonly kind: 'analyse' }
  | { readonly kind: 'copy'; readonly bytesTotal: number }
  | { readonly kind: 'copy-progress'; readonly bytesCopied: number }
  | { readonly kind: 'decode'; readonly framesTotal: number }
  | { readonly kind: 'decode-progress'; readonly framesDecoded: number }
  | { readonly kind: 'add' }
  | { readonly kind: 'imported' }
  | { readonly kind: 'refused'; readonly failure: DomainFailure };

/** How far an import has got. */
export interface ImportProgress {
  readonly ended: number;
  readonly imported: number;
  readonly refused: number;
  readonly total: number;
}

/** An import of `files`, every one queued. */
export function importJob(files: readonly ImportFile[]): ImportJob {
  return { entries: files.map((file) => ({ file, state: { kind: 'queued' } })) };
}

function isEnded(
  state: ImportFileState,
): state is Extract<ImportFileState, { kind: 'imported' | 'refused' | 'cancelled' }> {
  return state.kind === 'imported' || state.kind === 'refused' || state.kind === 'cancelled';
}

function refused(state: ImportFileState, event: ImportFileEvent, why: string): DomainResult<never> {
  return fail(
    conflict(
      'import-step-refused',
      `A file that is ${state.kind} cannot take "${event.kind}": ${why}`,
    ),
  );
}

/** Whether a file may move from `from` to the stage `to`: forward only. */
function forward(from: ImportFileState, to: ImportStage): boolean {
  return !isEnded(from) && ORDER.indexOf(from.kind) < ORDER.indexOf(to);
}

/** The file's next state after a step that moves it forward or reports its progress. */
function stepped(state: ImportFileState, event: ImportFileEvent): DomainResult<ImportFileState> {
  switch (event.kind) {
    case 'analyse':
      return forward(state, 'analysing')
        ? succeed({ kind: 'analysing' })
        : refused(state, event, 'a file is analysed once, first.');
    case 'copy':
      return forward(state, 'copying') && state.kind !== 'queued'
        ? succeed({ kind: 'copying', bytesCopied: 0, bytesTotal: event.bytesTotal })
        : refused(state, event, 'a file is copied once it is analysed, before it is decoded.');
    case 'copy-progress':
      return state.kind === 'copying' &&
        event.bytesCopied >= state.bytesCopied &&
        event.bytesCopied <= state.bytesTotal
        ? succeed({ ...state, bytesCopied: event.bytesCopied })
        : refused(state, event, "copied bytes grow, up to the file's size, while copying.");
    case 'decode':
      return forward(state, 'decoding') && state.kind !== 'queued'
        ? succeed({ kind: 'decoding', framesDecoded: 0, framesTotal: event.framesTotal })
        : refused(state, event, 'a file is decoded once it is analysed, before it is added.');
    case 'decode-progress':
      return state.kind === 'decoding' &&
        event.framesDecoded >= state.framesDecoded &&
        event.framesDecoded <= state.framesTotal
        ? succeed({ ...state, framesDecoded: event.framesDecoded })
        : refused(state, event, "decoded frames grow, up to the stream's length, while decoding.");
    default:
      return ended(state, event);
  }
}

function ended(state: ImportFileState, event: ImportFileEvent): DomainResult<ImportFileState> {
  if (isEnded(state)) return refused(state, event, 'the file has already ended.');
  switch (event.kind) {
    case 'add':
      return forward(state, 'adding') && state.kind !== 'queued'
        ? succeed({ kind: 'adding' })
        : refused(state, event, 'a file is added once it is analysed, and once.');
    case 'imported':
      return state.kind === 'adding'
        ? succeed({ kind: 'imported' })
        : refused(state, event, 'a file is imported once it is added.');
    case 'refused':
      return succeed({ kind: 'refused', stage: state.kind, failure: event.failure });
    default:
      return refused(state, event, 'it is not a step of an import.');
  }
}

/** Why the file at `index` may not leave the queue yet, or nothing. */
function waiting(job: ImportJob, index: number): string | undefined {
  const before = job.entries.slice(0, index);
  const unended = before.filter((entry) => !isEnded(entry.state));
  const previous = before.at(-1);
  if (unended.length === 0) return undefined;
  if (unended.length === 1 && previous?.state.kind === 'adding') return undefined;
  return 'files are imported one at a time, the next beginning only as the one before it is added.';
}

/** The import after the file at `index` takes `event`, or why it cannot. */
export function nextImportJob(
  job: ImportJob,
  index: number,
  event: ImportFileEvent,
): DomainResult<ImportJob> {
  const entry = job.entries[index];
  if (entry === undefined) {
    return fail(conflict('import-file-unknown', `The import has no file ${String(index + 1)}.`));
  }
  const reason =
    entry.state.kind === 'queued' && event.kind === 'analyse' ? waiting(job, index) : undefined;
  if (reason !== undefined) return refused(entry.state, event, reason);
  if (event.kind === 'add' && job.entries.slice(0, index).some((one) => !isEnded(one.state))) {
    return refused(entry.state, event, 'files are added in order, one at a time.');
  }
  const next = stepped(entry.state, event);
  if (!next.ok) return next;
  return succeed({ entries: job.entries.with(index, { ...entry, state: next.value }) });
}

/** The import with the file in progress and every file after it cancelled. */
export function cancelImport(job: ImportJob): ImportJob {
  return {
    entries: job.entries.map((entry) =>
      isEnded(entry.state)
        ? entry
        : { ...entry, state: { kind: 'cancelled', stage: entry.state.kind } },
    ),
  };
}

/** How far the import has got. */
export function importProgress(job: ImportJob): ImportProgress {
  const count = (kind: ImportFileState['kind']): number =>
    job.entries.filter((entry) => entry.state.kind === kind).length;
  return {
    ended: job.entries.filter((entry) => isEnded(entry.state)).length,
    imported: count('imported'),
    refused: count('refused'),
    total: job.entries.length,
  };
}
