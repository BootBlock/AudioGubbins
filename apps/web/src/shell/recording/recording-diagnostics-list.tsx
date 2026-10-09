/**
 * The recording diagnostics (`REQ-REC-094`, `REQ-REC-097`, `REQ-PWA-077`):
 * what the browser and the hardware can do for a recording, each shortfall
 * with what it affects, why, its practical impact and what would improve it.
 *
 * Informative rather than alarmist: the list sits in the panel and the
 * Capabilities panel and never stands between the person and their work, and
 * only an entry that stops recording altogether is marked as needing them.
 */

import type { ReactNode } from 'react';

import { DiagnosticSeverity, type RecordingDiagnostic } from '@audiogubbins/recording';

/** What each severity is shown as, and the status it is drawn with. */
const SEVERITY: Readonly<
  Record<DiagnosticSeverity, { readonly label: string; readonly status: string }>
> = {
  [DiagnosticSeverity.Blocking]: { label: 'Needs you', status: 'unavailable' },
  [DiagnosticSeverity.Warning]: { label: 'Reduced', status: 'reduced' },
  [DiagnosticSeverity.Information]: { label: 'Note', status: 'available' },
};

/** The diagnostics, or what is said while they are not yet known. */
export function RecordingDiagnosticsList({
  entries,
}: {
  readonly entries: readonly RecordingDiagnostic[] | undefined;
}): ReactNode {
  if (entries === undefined) {
    return (
      <p className="ag-panel-note">
        What the input and the output can do is checked once an input is armed or something plays.
      </p>
    );
  }
  if (entries.length === 0) {
    return <p>Recording runs at full capability with this browser and hardware.</p>;
  }
  return (
    <ul className="ag-capability-list" aria-label="Recording diagnostics">
      {entries.map((entry) => {
        const severity = SEVERITY[entry.severity];
        return (
          <li key={entry.kind} className="ag-capability">
            <span className="ag-capability-name">{entry.affects}</span>
            <span className="ag-capability-status" data-ag-status={severity.status}>
              {severity.label}
            </span>
            <p className="ag-capability-explanation">{entry.why}</p>
            <p className="ag-capability-explanation">{entry.impact}</p>
            <p className="ag-capability-remedy">{entry.improve}</p>
          </li>
        );
      })}
    </ul>
  );
}
