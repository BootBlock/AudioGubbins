/**
 * What an editor view's waveform is waiting for, over the display's bottom
 * trailing corner, while the canvas shows only the fill it waits with until
 * the peaks arrive (design language, section 9, "Loading"); and, where the
 * peaks could not be made, the display's error state.
 */

import type { ReactNode } from 'react';

import {
  EmptyState,
  IconSize,
  PanelStateTone,
  ProgressBar,
  Spinner,
} from '@audiogubbins/design-system';
import type { PeakStatus } from '@audiogubbins/waveform';

/** What the view's peaks are waiting for, or nothing once they are whole or failed. */
interface PeaksProgress {
  readonly words: string;
  /** How far they have come, from 0 to 1, or `null` while a kept waveform is read. */
  readonly share: number | null;
}

function peaksProgress(status: PeakStatus | undefined): PeaksProgress | undefined {
  switch (status?.kind) {
    case 'reading-cache':
      return { words: 'Reading the kept waveform…', share: null };
    case 'generating':
      return { words: 'Making the waveform', share: status.progress };
    default:
      return undefined;
  }
}

/** A share in whole per cent, rounded down so the note never says 100% before the peaks are whole. */
function percent(share: number): string {
  return `${String(Math.floor(share * 100))}%`;
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
      <div role="status" className="ag-editor-note-place">
        {progress !== undefined && (
          <div className="ag-editor-note">
            <Spinner size={IconSize.Inline} />
            {/* The words and the share are one sentence to a screen reader. */}
            <p className="ag-editor-note-text">
              {progress.words}
              {progress.share !== null && (
                <>
                  {' '}
                  <span className="ag-editor-note-share">{percent(progress.share)}</span>
                </>
              )}
            </p>
            <ProgressBar label={progress.words} value={progress.share} valueText={percent} />
          </div>
        )}
      </div>
      {status?.kind === 'failed' && (
        <div className="ag-editor-display-state" role="alert">
          <EmptyState
            tone={PanelStateTone.Error}
            icon="waveform"
            title="The waveform could not be made"
            text={status.reason}
          />
        </div>
      )}
    </>
  );
}
