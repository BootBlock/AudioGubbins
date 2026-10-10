/**
 * An import as the list of files being imported words it (ADR-0090,
 * REQ-UX-005): each file's format, its stage and how far it has got, or what
 * it came to and why, and the batch as a whole as it begins and once it ends.
 *
 * How far a file has got is measured by the stage it is in: the bytes copied
 * while it is copied, the frames decoded while it is decoded, against the
 * length its stream states where it states one. No stage before or after has
 * a measure, and none is made up for it.
 */

import { formatName } from '@audiogubbins/codecs';
import {
  importProgress,
  type ImportEntry,
  type ImportFileState,
  type ImportJob,
} from '@audiogubbins/import-export';
import { counted } from '@audiogubbins/text';

import { describeBytes } from '../../wording.js';

/** How far a file has got through the stage it is in, where that stage has a measure. */
export type StageMeasure =
  | {
      readonly kind: 'measured';
      readonly done: number;
      readonly total: number;
      readonly words: string;
    }
  | { readonly kind: 'unmeasured'; readonly words: string };

/** The frames decoded, grouped as British English groups them. */
const FRAMES = new Intl.NumberFormat('en-GB');

/** The format the file was recognised as, or that it is not known yet. */
export function formatWords(entry: ImportEntry): string {
  if (entry.format !== undefined) return formatName(entry.format);
  return entry.state.kind === 'queued' || entry.state.kind === 'analysing'
    ? 'Not known yet'
    : 'Not recognised';
}

/** The stage a file is at, or what it came to, in a phrase. */
export function stageWords(state: ImportFileState): string {
  switch (state.kind) {
    case 'queued':
      return 'Waiting its turn';
    case 'analysing':
      return 'Reading what it is';
    case 'copying':
      return 'Copying into the project';
    case 'decoding':
      return 'Decoding';
    case 'adding':
      return 'Adding to the project';
    case 'imported':
      return 'Imported';
    case 'refused':
      return `Refused: ${state.failure.summary}`;
    case 'cancelled':
      return 'Cancelled, and nothing of it kept';
  }
}

/** How far a file has got through its stage, where the stage is measured. */
export function stageMeasure(state: ImportFileState): StageMeasure | undefined {
  switch (state.kind) {
    case 'copying':
      return {
        kind: 'measured',
        done: state.bytesCopied,
        total: state.bytesTotal,
        words: `${describeBytes(state.bytesCopied)} of ${describeBytes(state.bytesTotal)} copied`,
      };
    case 'decoding': {
      const decoded = `${FRAMES.format(state.framesDecoded)} frames decoded`;
      // A decode may pass the length its stream states, so the bar is held full.
      return state.framesTotal === undefined
        ? { kind: 'unmeasured', words: decoded }
        : {
            kind: 'measured',
            done: Math.min(state.framesDecoded, state.framesTotal),
            total: state.framesTotal,
            words: `${decoded} of ${FRAMES.format(state.framesTotal)}`,
          };
    }
    default:
      return undefined;
  }
}

/** What the batch is doing, or what it came to, in a sentence. */
export function batchWords(job: ImportJob, ended: boolean): string {
  const { imported, refused, ended: finished, total } = importProgress(job);
  if (!ended) return `Importing ${counted(total, 'file', 'files')}.`;
  const said = [
    `The import ended: ${String(imported)} of ${counted(total, 'file', 'files')} imported`,
  ];
  const cancelled = finished - imported - refused;
  if (refused > 0) said.push(`${String(refused)} refused`);
  if (cancelled > 0) said.push(`${String(cancelled)} cancelled`);
  return `${said.join(', ')}.`;
}
