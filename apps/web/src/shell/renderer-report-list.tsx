/**
 * What each editor view draws with, for the Capabilities panel
 * (REQ-AUDIO-152's renderer capability diagnostics): the backend in use, each
 * one tried and why it was or was not taken, and how many times the device
 * was lost and recovered. WebGPU is never required (REQ-AUDIO-082), so a view
 * drawing with WebGL 2 or Canvas 2D says why, rather than reading as broken.
 */

import { useSyncExternalStore, type ReactNode } from 'react';

import { RendererKind, RendererState, type RendererReport } from '@audiogubbins/renderer';

import type { RendererReports } from '../state/renderer-reports.js';

/** What each backend is called. */
const RENDERER_NAMES: Readonly<Record<RendererKind, string>> = {
  [RendererKind.WebGpu]: 'WebGPU',
  [RendererKind.WebGl2]: 'WebGL 2',
  [RendererKind.Canvas2d]: 'Canvas 2D',
};

const OUTCOMES = {
  active: 'in use',
  refused: 'not available',
  lost: 'lost its device',
  failed: 'stopped',
} as const;

/** A report in a sentence: what the view draws with now. */
function rendererSentence(report: RendererReport): string {
  switch (report.state) {
    case RendererState.Starting:
      return 'Starting the renderer.';
    case RendererState.Recovering:
      return 'The graphics device was lost; the view is being drawn again.';
    case RendererState.Unavailable:
      return 'No renderer could be made in this browser.';
    case RendererState.Drawing:
      return report.active === undefined
        ? 'Drawing.'
        : `Drawn with ${RENDERER_NAMES[report.active]}.`;
  }
}

/** Each editor view's renderer report. */
export function RendererReportList({ reports }: { readonly reports: RendererReports }): ReactNode {
  const all = useSyncExternalStore(reports.subscribe, reports.get);
  if (all.size === 0) return null;
  return (
    <>
      <h3 className="ag-capability-heading">Editor drawing</h3>
      <ul className="ag-capability-list">
        {[...all].map(([panel, report]) => (
          <li key={panel} className="ag-capability" data-ag-renderer={report.active ?? 'none'}>
            <span className="ag-capability-name">{rendererSentence(report)}</span>
            <ul className="ag-renderer-attempts">
              {report.attempts.map((attempt, index) => (
                <li key={`${attempt.kind}-${String(index)}`}>
                  {`${RENDERER_NAMES[attempt.kind]}: ${OUTCOMES[attempt.outcome]}`}
                  {attempt.reason === undefined ? '' : ` (${attempt.reason})`}
                </li>
              ))}
            </ul>
            {report.losses > 0 && (
              <p className="ag-capability-explanation">
                {`Lost ${String(report.losses)} times, recovered ${String(report.recoveries)}.`}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
