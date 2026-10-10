/**
 * Which DSP the spectrogram worker runs, for the Capabilities panel beside
 * what each editor view draws with: the WebAssembly module, or the reference
 * path with the reason it runs, said as the Transport panel says each audio
 * thread's (WU-03.E). Nothing is said until a view first shows a spectrogram,
 * since the worker is made then.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { dspText } from '../audio-format.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';

/** The spectrogram worker's DSP, once it has said which it runs. */
export function SpectrogramDspReading({
  dsp,
}: {
  readonly dsp: EditorPanelParts['spectrogramDsp'];
}): ReactNode {
  const choice = useSyncExternalStore(dsp.subscribe, dsp.get);
  if (choice === undefined) return null;
  return (
    <>
      <h3 className="ag-capability-heading">Editor analysis</h3>
      <ul className="ag-capability-list">
        <li className="ag-capability" data-ag-dsp={choice.implementation}>
          <span className="ag-capability-name">
            {`Spectrogram worker: ${dspText(choice.implementation)}`}
          </span>
          {choice.fallbackReason !== undefined && (
            <p className="ag-capability-explanation" data-ag-status="reduced">
              {choice.fallbackReason}
            </p>
          )}
        </li>
      </ul>
    </>
  );
}
