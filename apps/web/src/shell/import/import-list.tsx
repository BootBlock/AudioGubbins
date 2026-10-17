/**
 * The files being imported (ADR-0090, REQ-UX-005): each file of the batch in
 * the order it runs, with its name, its size, its format once recognised, the
 * storage it needs, stated before any of it is stored, the stage it is at, a
 * bar of how far it has got through a stage that is measured, and once it ends,
 * what it came to and why it was refused where it was.
 *
 * A measured stage's words are shown beside its bar as well as said by it, so
 * a stage with no measure to draw, whose bar runs unmeasured, still says how
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

import { Icon, IconSize, ProgressBar, ProgressPlace } from '@audiogubbins/design-system';
import type { ImportEntry, ImportJob } from '@audiogubbins/import-export';

import { IMPORT_LIST_LABEL } from '../../import-export-words.js';
import { describeBytes } from '../../wording.js';
import { batchWords, formatWords, roomWords, stageMeasure, stageWords } from './import-words.js';

/** One file of the batch, and how far it has got. */
function ImportRow({ entry }: { readonly entry: ImportEntry }): ReactNode {
  const { file, state } = entry;
  const measure = stageMeasure(state);
  return (
    <li className="ag-import-row" data-stage={state.kind}>
      <Icon
        name={state.kind === 'refused' ? 'refused' : 'audio-file'}
        size={IconSize.Inline}
        className="ag-import-mark"
      />
      <span className="ag-import-name">{file.name}</span>
      <dl className="ag-import-facts">
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
        <div>
          <dt>Stage</dt>
          <dd>{stageWords(state)}</dd>
        </div>
      </dl>
      {measure === undefined ? null : (
        <div className="ag-import-progress">
          <ProgressBar
            label={`Import of ${file.name}`}
            place={ProgressPlace.Row}
            value={measure.kind === 'measured' ? measure.done / Math.max(1, measure.total) : null}
            valueText={() => measure.words}
          />
          <span className="ag-import-measure">{measure.words}</span>
        </div>
      )}
    </li>
  );
}

/** The batch's files, and what it is doing or came to (see the module comment). */
export function ImportList({
  job,
  ended,
}: {
  readonly job: ImportJob | undefined;
  readonly ended: boolean;
}): ReactNode {
  return (
    <>
      <p className="ag-import-summary" role="status">
        {job === undefined ? '' : batchWords(job, ended)}
      </p>
      {job === undefined ? null : (
        <ul className="ag-import-list" aria-label={IMPORT_LIST_LABEL}>
          {job.entries.map((entry, index) => (
            // A file's place in the batch is its identity: names may repeat.
            <ImportRow key={index} entry={entry} />
          ))}
        </ul>
      )}
    </>
  );
}
