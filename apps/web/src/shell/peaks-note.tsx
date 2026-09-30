/**
 * What an editor view's waveform is waiting for, beside the canvas, which
 * shows only the fill it waits with until the peaks arrive.
 */

import type { ReactNode } from 'react';

import type { PeakStatus } from '@audiogubbins/waveform';

/** What the view's peaks are waiting for, in words, or nothing once they are whole or failed. */
function peaksProgress(status: PeakStatus | undefined): string | undefined {
  switch (status?.kind) {
    case 'reading-cache':
      return 'Reading the kept waveform…';
    case 'generating':
      return `Making the waveform: ${String(Math.floor(status.progress * 100))}%`;
    default:
      return undefined;
  }
}

/**
 * Where the view's waveform has got to, said as well as shown: its progress
 * in a status region, which is there before anything is written into it so a
 * screen reader hears what is, and its failure as an alert, since the canvas
 * then shows only the fill it waits with and nothing else says why.
 */
export function PeaksNote({ status }: { readonly status: PeakStatus | undefined }): ReactNode {
  const progress = peaksProgress(status);
  return (
    <>
      <div role="status">
        {progress !== undefined && <p className="ag-panel-note">{progress}</p>}
      </div>
      {status?.kind === 'failed' && (
        <p className="ag-panel-note" role="alert">
          {`The waveform could not be made: ${status.reason}`}
        </p>
      )}
    </>
  );
}
