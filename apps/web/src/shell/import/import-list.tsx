/**
 * The files being imported (ADR-0090, REQ-UX-005): each file of the batch in
 * the order it runs, with its name, the stage it is at and how far it has got
 * through a stage that is measured, its size, its format once recognised and
 * the storage it needs, stated before any of it is stored, and once it ends,
 * what it came to and why it was refused where it was.
 *
 * A measured stage's words are written in its row as well as said by its bar,
 * so a stage with no measure to draw, whose bar runs unmeasured, still says how
 * far it has got.
 *
 * Each row is keyed by its place in the batch, which never changes while the
 * batch runs, so a report redraws the rows it changed and leaves the rest, and
 * the focus, where they were. A bar names its file, so a screen reader knows
 * which file's progress it hears. The batch's beginning and end are said in a
 * status, there before anything is said in it; each report is not, since a
 * live region spoken at every block decoded would drown everything else.
 */

import type { ReactNode } from 'react';

import {
  Icon,
  IconSize,
  type IconName,
  ProgressBar,
  ProgressPlace,
  Spinner,
} from '@audiogubbins/design-system';
import type { ImportEntry, ImportFileState, ImportJob } from '@audiogubbins/import-export';

import { IMPORT_LIST_LABEL } from '../../import-export-words.js';
import { describeBytes } from '../../wording.js';
import { batchWords, formatWords, roomWords, stageMeasure, stageWords } from './import-words.js';

/** The glyph a file's row leads with, by where it has got. */
function stageGlyph(state: ImportFileState): IconName {
  switch (state.kind) {
    case 'queued':
      return 'waiting';
    case 'imported':
      return 'checked';
    case 'refused':
      return 'refused';
    case 'cancelled':
      return 'cancel';
    default:
      return 'audio-file';
  }
}

/** One file of the batch, and how far it has got. */
function ImportRow({ entry }: { readonly entry: ImportEntry }): ReactNode {
  const { file, state } = entry;
  const measure = stageMeasure(state);
  const stage = stageWords(state);
  return (
    <li
      className="ag-imports-row"
      data-stage={state.kind}
      data-ag-refused={state.kind === 'refused' ? '' : undefined}
    >
      <Icon name={stageGlyph(state)} size={IconSize.Inline} className="ag-imports-glyph" />
      <span className="ag-imports-name">{file.name}</span>
      <span className="ag-imports-stage">
        {measure === undefined ? stage : `${stage} · ${measure.words}`}
      </span>
      <dl className="ag-imports-facts">
        <div>
          <dt>Size</dt>
          <dd>{describeBytes(file.bytes)}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{formatWords(entry)}</dd>
        </div>
        <div>
          <dt>Storage needed</dt>
          <dd>{roomWords(entry)}</dd>
        </div>
      </dl>
      {measure === undefined ? null : (
        <span className="ag-imports-bar">
          <ProgressBar
            label={`Import of ${file.name}`}
            // An empty file's total is zero, and a bar given zero over zero has no value.
            value={measure.kind === 'measured' ? measure.done / Math.max(1, measure.total) : null}
            valueText={() => measure.words}
            place={ProgressPlace.Row}
          />
        </span>
      )}
    </li>
  );
}

/**
 * The batch's files, and what it is doing or came to (see the module comment),
 * with `actions` at the trailing end of its summary.
 */
export function ImportList({
  job,
  ended,
  actions,
}: {
  readonly job: ImportJob | undefined;
  readonly ended: boolean;
  readonly actions?: ReactNode;
}): ReactNode {
  return (
    <div className="ag-imports-strip" data-ag-shown={job === undefined ? undefined : ''}>
      <div className="ag-imports-head">
        {job !== undefined && !ended && <Spinner size={IconSize.Inline} />}
        <p className="ag-imports-summary" role="status">
          {job === undefined ? '' : batchWords(job, ended)}
        </p>
        {actions}
      </div>
      {job === undefined ? null : (
        <ul className="ag-imports-list" aria-label={IMPORT_LIST_LABEL}>
          {job.entries.map((entry, index) => (
            // A file's place in the batch is its identity: names may repeat.
            <ImportRow key={index} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
